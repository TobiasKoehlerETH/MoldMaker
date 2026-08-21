import initOpenCascade from "replicad-opencascadejs";
import openCascadeWasm from "replicad-opencascadejs/wasm?url";
import {
  basicFaceExtrusion,
  cast,
  getOC,
  importSTEP,
  makeBox,
  makeCompound,
  makeCylinder,
  setOC,
  type Shape3D,
  type SimplePoint,
  Vector
} from "replicad";
import type { CadMesh, GenerateMoldRequest, GenerateMoldResponse, GeneratedMold } from "../../shared/cad";
import { flowPorts, moldBounds, partingLevel, screwPoints } from "../../shared/mold";
import type { Vec3 } from "../../shared/vec3";

const ready = initOpenCascade({ locateFile: () => openCascadeWasm }).then(setOC);

/** OpenCascade comparisons scaled to the generated mold's envelope. */
const geometryTolerance = (min: SimplePoint, max: SimplePoint): number =>
  Math.max(...max.map((value, axis) => value - min[axis])) * 1e-6;

/** Boolean results can sit slightly inside an original bounding face. */
const wallTouchTolerance = (min: SimplePoint, max: SimplePoint): number =>
  Math.max(...max.map((value, axis) => value - min[axis])) * 1e-3;

/** Thickness used to discover enclosed regions immediately below the seam. */
const seamSampleDepth = (min: SimplePoint, max: SimplePoint): number =>
  Math.max(...max.map((value, axis) => value - min[axis])) * 1e-3;

/** Splits a shape into its disconnected solid components. */
function solidsOf(shape: Shape3D): Shape3D[] {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );
  const found: Shape3D[] = [];

  while (explorer.More()) {
    found.push(cast(explorer.Current()) as Shape3D);
    explorer.Next();
  }
  explorer.delete();
  return found;
}

/**
 * Carves the part out of a block, one solid at a time.
 *
 * A STEP assembly imports as a multi-solid compound, and OpenCascade quietly
 * drops tool solids when a boolean is handed the compound whole: cutting the
 * lower block with the sample's two-piece part removed the dish and left the
 * second piece standing as mold material inside the cavity. Cutting each solid
 * separately is the only form that reliably empties the whole cavity.
 */
const cutPart = (block: Shape3D, part: Shape3D[]): Shape3D =>
  part.reduce((result, solid) => replace(result, result.cut(solid)), block);

/** A real mold half spans the block; anything landing strictly inside is a core. */
function reachesWall(shape: Shape3D, min: SimplePoint, max: SimplePoint): boolean {
  const [low, high] = shape.boundingBox.bounds;
  const tolerance = wallTouchTolerance(min, max);
  return [0, 1].some(
    (axis) =>
      Math.abs(low[axis] - min[axis]) <= tolerance || Math.abs(high[axis] - max[axis]) <= tolerance
  );
}

/**
 * Moves free-floating components of `from` into `to`.
 *
 * Cutting the block at a flat plane leaves the fill of any upward-facing pocket
 * — the inside of a dish, say — stranded below the plane, unattached to the
 * base. That fill is the core: it has to hang off the opposite half, otherwise
 * one half ships a loose lump and the pair stops being an exact negative of the
 * part. Its top face is flush with the parting plane, so fusing it into the
 * other half yields a single connected solid.
 */
function moveCores(from: Shape3D, to: Shape3D, min: SimplePoint, max: SimplePoint): [Shape3D, Shape3D] {
  const pieces = solidsOf(from);
  const wallPieces = pieces.filter((piece) => reachesWall(piece, min, max));
  const cores = pieces.filter((piece) => !reachesWall(piece, min, max));
  if (cores.length === 0) {
    pieces.forEach((piece) => piece.delete());
    return [from, to];
  }
  if (wallPieces.length === 0) {
    pieces.forEach((piece) => piece.delete());
    throw new Error("Mold half has no component connected to its outer wall");
  }

  // Rebuild the source from the components we want to retain. Boolean-cutting
  // an exact child solid out of its parent compound can leave OpenCascade with
  // an invalid shape that later fails STL export.
  const source = wallPieces.length === 1
    ? wallPieces[0].clone()
    : makeCompound(wallPieces.map((piece) => piece.clone())).asShape3D();
  let target = to;

  for (const core of cores) {
    target = replace(target, target.fuse(core));
  }
  from.delete();
  pieces.forEach((piece) => piece.delete());
  return [source, target];
}

/**
 * Finds the lowest upward-facing part surface below an enclosed seam region.
 * That surface is the floor of the pocket and therefore the end of its core;
 * using the part's overall lower bound would manufacture a flat cap below the
 * real curved surface.
 */
function pocketFloor(
  part: Shape3D[],
  region: Shape3D,
  sampleBottom: number,
  fallback: number,
  tolerance: number
): number {
  const [regionMin, regionMax] = region.boundingBox.bounds;
  const faces = part.flatMap((solid) => solid.faces);
  const floors: number[] = [];

  for (const face of faces) {
    const [faceMin, faceMax] = face.boundingBox.bounds;
    const overlapsRegion = [0, 1].every(
      (axis) => faceMax[axis] >= regionMin[axis] - tolerance && faceMin[axis] <= regionMax[axis] + tolerance
    );
    if (!overlapsRegion || faceMin[2] >= sampleBottom - tolerance) continue;

    if (face.normalAt().z > 0.05) floors.push(faceMin[2]);
  }

  faces.forEach((face) => face.delete());
  return floors.length > 0 ? Math.min(...floors) : fallback;
}

/**
 * Gives enclosed regions at the parting line to the half they meet without a
 * gap. A cap can leave its centre connected to the lower block through open
 * space below the part, so disconnected-solid cleanup alone cannot find it.
 * Sampling the seam exposes the enclosed footprint; projecting that footprint
 * down and retaining only the volume that reaches the seam isolates the core
 * that must hang from the upper half.
 */
function moveSeamCores(
  lower: Shape3D,
  upper: Shape3D,
  part: Shape3D[],
  min: SimplePoint,
  max: SimplePoint,
  partBottom: number,
  splitZ: number
): [Shape3D, Shape3D] {
  const tolerance = geometryTolerance(min, max);
  const sampleBottom = Math.max(min[2], splitZ - seamSampleDepth(min, max));
  if (splitZ - sampleBottom <= tolerance) return [lower, upper];

  const slab = cutPart(makeBox([min[0], min[1], sampleBottom], [max[0], max[1], splitZ]), part);
  const regions = solidsOf(slab);
  const enclosed = regions.filter((region) => !reachesWall(region, min, max));
  let nextLower = lower;
  let nextUpper = upper;

  for (const region of enclosed) {
    const faces = region.faces;
    const footprint = faces.find(
      (face) => face.geomType === "PLANE" && Math.abs(face.center.z - sampleBottom) <= tolerance
    );
    if (!footprint) {
      faces.forEach((face) => face.delete());
      continue;
    }

    // Stop on the actual pocket surface. Extending to the part's overall lower
    // bound would flatten a curved pocket and can pull exterior mold material
    // through a hole in the part into the upper half.
    const coreBottom = pocketFloor(part, region, sampleBottom, partBottom, tolerance);
    const projection = basicFaceExtrusion(footprint, new Vector([0, 0, coreBottom - sampleBottom]));
    faces.forEach((face) => face.delete());
    const withinFootprint = nextLower.intersect(projection);
    const candidates = solidsOf(withinFootprint);
    const cores = candidates.filter(
      (candidate) => candidate.boundingBox.bounds[1][2] >= sampleBottom - tolerance
    );

    for (const core of cores) {
      nextLower = replace(nextLower, nextLower.cut(core));
      nextUpper = replace(nextUpper, nextUpper.fuse(core));
    }

    candidates.forEach((candidate) => candidate.delete());
    withinFootprint.delete();
    projection.delete();
  }

  regions.forEach((region) => region.delete());
  slab.delete();
  return [nextLower, nextUpper];
}

const rotateToZ = (part: Shape3D, axis: 0 | 1 | 2): Shape3D => {
  if (axis === 0) return part.rotate(-90, [0, 0, 0], [0, 1, 0]);
  if (axis === 1) return part.rotate(90, [0, 0, 0], [1, 0, 0]);
  return part;
};

const points = (vertices: number[]): SimplePoint[] =>
  Array.from({ length: vertices.length / 3 }, (_, index) => vertices.slice(index * 3, index * 3 + 3) as SimplePoint);

const replace = (previous: Shape3D, next: Shape3D): Shape3D => {
  previous.delete();
  return next;
};

function mesh(shape: Shape3D): CadMesh {
  const data = shape.mesh({ tolerance: 0.2, angularTolerance: 0.15 });
  const edges = shape.meshEdges({ tolerance: 0.2, angularTolerance: 0.15 });
  return {
    vertices: new Float32Array(data.vertices).buffer,
    normals: new Float32Array(data.normals).buffer,
    triangles: new Uint32Array(data.triangles).buffer,
    edges: new Float32Array(edges.lines).buffer
  };
}

async function generate({ step, params, splitAxis }: GenerateMoldRequest): Promise<GeneratedMold> {
  await ready;
  let part = (await importSTEP(new Blob([step]))).asShape3D();
  part = rotateToZ(part, splitAxis);

  const [partMin, partMax] = part.boundingBox.bounds;
  const wall = params.wallThickness;
  const [min, max] = moldBounds(partMin as Vec3, partMax as Vec3, params) as [SimplePoint, SimplePoint];
  const surface = points(part.mesh({ tolerance: 0.2 }).vertices) as Vec3[];
  const splitZ = partingLevel(surface, partMin as Vec3, partMax as Vec3, params.splitOffset);
  const partSolids = solidsOf(part);
  let lower = cutPart(makeBox(min, [max[0], max[1], splitZ]), partSolids);
  let upper = cutPart(makeBox([min[0], min[1], splitZ], max), partSolids);

  [lower, upper] = moveSeamCores(lower, upper, partSolids, min, max, partMin[2], splitZ);

  // Hand each half the cores it must carry so both stay exact negatives of the
  // part: first the fill of any pocket opening at the parting plane, then any
  // piece left detached from the half it landed in.
  [lower, upper] = moveCores(lower, upper, min, max);
  [upper, lower] = moveCores(upper, lower, min, max);

  // Screw clearance holes span the whole height so a bolt passes through both
  // halves. `cut` leaves its tool intact, so one cylinder serves both cuts.
  for (const [x, y] of screwPoints(min, max, wall, params.screwDiameter)) {
    const bore = makeCylinder(params.screwDiameter / 2, max[2] - min[2] + 2, [x, y, min[2] - 1]);
    lower = replace(lower, lower.cut(bore));
    upper = replace(upper, upper.cut(bore));
    bore.delete();
  }

  const { gate, vents } = flowPorts(surface, partMin as Vec3, partMax as Vec3, params.gateOffset);
  for (const [point, diameter] of [[gate, params.injectionDiameter], ...vents.map((point) => [point, params.ventDiameter] as const)] as const) {
    const channel = makeCylinder(diameter / 2, max[2] - point[2] + 0.5, [point[0], point[1], point[2] - 0.25]);
    upper = replace(upper, upper.cut(channel));
  }

  const exports = [
    ["lower-step", lower.blobSTEP()],
    ["upper-step", upper.blobSTEP()],
    ["lower-stl", lower.blobSTL({ binary: true, tolerance: 0.05 })],
    ["upper-stl", upper.blobSTL({ binary: true, tolerance: 0.05 })]
  ] as const;
  const [files, preview] = await Promise.all([
    Promise.all(exports.map(async ([kind, blob]) => ({ kind, data: await blob.arrayBuffer() }))),
    Promise.resolve({ part: mesh(part), lower: mesh(lower), upper: mesh(upper) })
  ]);
  partSolids.forEach((solid) => solid.delete());
  part.delete();
  lower.delete();
  upper.delete();
  return { files, preview };
}

self.onmessage = async ({ data }: MessageEvent<GenerateMoldRequest>) => {
  let response: GenerateMoldResponse;
  try {
    response = { id: data.id, ok: true, result: await generate(data) };
  } catch (error) {
    response = { id: data.id, ok: false, error: error instanceof Error ? error.message : "Mold generation failed" };
  }
  const transfers = response.ok
    ? [
        ...response.result.files.map((file) => file.data),
        ...Object.values(response.result.preview).flatMap((mesh) => [mesh.vertices, mesh.normals, mesh.triangles, mesh.edges])
      ]
    : [];
  self.postMessage(response, { transfer: transfers });
};
