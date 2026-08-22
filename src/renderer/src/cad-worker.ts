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
import type { CadMesh, CadPreview, CadRequest, CadResponse, GeneratedFile, GenerateMoldRequest } from "../../shared/cad";
import { flowPorts, moldBounds, partingLevel, screwPoints, type SplitAxis } from "../../shared/mold";
import type { Vec3 } from "../../shared/vec3";

const ready = initOpenCascade({ locateFile: () => openCascadeWasm }).then(setOC);

/**
 * Everything derived from the imported STEP file alone: its solids in the
 * split orientation, sampled surface points, bounds, and preview mesh.
 *
 * Re-importing and re-meshing per settings change dominated rebuild time, so
 * the worker keeps the last part alive and rebuilds only what the parameters
 * moved. The preview mesh buffers stay untransferred so they survive replies.
 */
interface LoadedPart {
  axis: SplitAxis;
  shape: Shape3D;
  solids: Shape3D[];
  surface: Vec3[];
  min: Vec3;
  max: Vec3;
  previewMesh: CadMesh;
}

let loadedPart: LoadedPart | null = null;

/**
 * The scaled solids are immutable inputs to every mold boolean. Keep them
 * alive between edits so changing padding, ports, or the seam does not clone
 * and tessellate the imported part again.
 */
interface PreparedPart {
  source: LoadedPart;
  scale: number;
  solids: Shape3D[];
  surface: Vec3[];
  min: Vec3;
  max: Vec3;
  previewMesh: CadMesh;
}

let preparedPart: PreparedPart | null = null;

/** The most recent completed halves, kept alive so Export can encode on demand. */
let halves: { lower: Shape3D; upper: Shape3D } | null = null;

function releasePreparedPart(): void {
  preparedPart?.solids.forEach((solid) => solid.delete());
  preparedPart = null;
}

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

async function meshPart(step: ArrayBuffer, axis: SplitAxis): Promise<LoadedPart> {
  const part = rotateToZ((await importSTEP(new Blob([step]))).asShape3D(), axis);
  const [partMin, partMax] = part.boundingBox.bounds;
  return {
    axis,
    shape: part,
    solids: solidsOf(part),
    surface: points(part.mesh({ tolerance: 0.2 }).vertices) as Vec3[],
    min: partMin as Vec3,
    max: partMax as Vec3,
    previewMesh: mesh(part)
  };
}

function preparePart(source: LoadedPart, shrinkageScale: number): PreparedPart {
  const factor = 1 + shrinkageScale / 100;
  if (preparedPart?.source === source && preparedPart.scale === factor) return preparedPart;

  releasePreparedPart();
  if (factor === 1) {
    preparedPart = {
      source,
      scale: factor,
      solids: source.solids.map((solid) => solid.clone()),
      surface: source.surface,
      min: source.min,
      max: source.max,
      previewMesh: source.previewMesh
    };
    return preparedPart;
  }

  const centre: SimplePoint = [
    (source.min[0] + source.max[0]) / 2,
    (source.min[1] + source.max[1]) / 2,
    (source.min[2] + source.max[2]) / 2
  ];
  const scaledShape = source.shape.clone().scale(factor, centre);
  const scaledSolids = source.solids.map((solid) => solid.clone().scale(factor, centre));
  const [scaledMin, scaledMax] = scaledShape.boundingBox.bounds;
  const scaledSurface = source.surface.map(([x, y, z]) => [
    centre[0] + (x - centre[0]) * factor,
    centre[1] + (y - centre[1]) * factor,
    centre[2] + (z - centre[2]) * factor
  ] as Vec3);
  const result: PreparedPart = {
    source,
    scale: factor,
    solids: scaledSolids,
    surface: scaledSurface,
    min: scaledMin as Vec3,
    max: scaledMax as Vec3,
    previewMesh: mesh(scaledShape)
  };
  scaledShape.delete();
  preparedPart = result;
  return result;
}

async function generate({ step, params, splitAxis }: GenerateMoldRequest): Promise<CadPreview> {
  await ready;
  // A request without STEP bytes rebuilds the part already held, so a settings
  // change pays only for what the parameters moved.
  if (step) {
    releasePreparedPart();
    if (loadedPart) {
      loadedPart.solids.forEach((solid) => solid.delete());
      loadedPart.shape.delete();
    }
    loadedPart = await meshPart(step, splitAxis);
  }
  if (!loadedPart) throw new Error("No part is open");
  const part = preparePart(loadedPart, params.shrinkageScale);

  const [min, max] = moldBounds(part.min, part.max, params) as [SimplePoint, SimplePoint];
  const splitZ = partingLevel(part.surface, part.min, part.max, params.splitOffset);
  let lower = cutPart(makeBox(min, [max[0], max[1], splitZ]), part.solids);
  let upper = cutPart(makeBox([min[0], min[1], splitZ], max), part.solids);

  [lower, upper] = moveSeamCores(lower, upper, part.solids, min, max, part.min[2], splitZ);

  // Hand each half the cores it must carry so both stay exact negatives of the
  // part: first the fill of any pocket opening at the parting plane, then any
  // piece left detached from the half it landed in.
  [lower, upper] = moveCores(lower, upper, min, max);
  [upper, lower] = moveCores(upper, lower, min, max);

  // Screw clearance holes span the whole height so a bolt passes through both
  // halves. `cut` leaves its tool intact, so one cylinder serves both cuts.
  for (const [x, y] of screwPoints(min, max, params.wallThickness, params.screwDiameter)) {
    const bore = makeCylinder(params.screwDiameter / 2, max[2] - min[2] + 2, [x, y, min[2] - 1]);
    lower = replace(lower, lower.cut(bore));
    upper = replace(upper, upper.cut(bore));
    bore.delete();
  }

  const { gate, vents } = flowPorts(part.surface, part.min, part.max, params.gateOffset);
  for (const [point, diameter] of [[gate, params.injectionDiameter], ...vents.map((point) => [point, params.ventDiameter] as const)] as const) {
    const channel = makeCylinder(diameter / 2, max[2] - point[2] + 0.5, [point[0], point[1], point[2] - 0.25]);
    upper = replace(upper, upper.cut(channel));
  }

  halves?.lower.delete();
  halves?.upper.delete();
  // Kept alive past this reply so Export encodes from the solids on screen
  // instead of every rebuild paying for four file conversions nobody asked for.
  halves = { lower, upper };
  return { part: part.previewMesh, lower: mesh(lower), upper: mesh(upper) };
}

/** Encodes the current halves into their STEP and STL files. */
async function exportHalves(): Promise<GeneratedFile[]> {
  await ready;
  if (!halves) throw new Error("Build a mold before exporting");
  const exports = [
    ["lower-step", halves.lower.blobSTEP()],
    ["upper-step", halves.upper.blobSTEP()],
    ["lower-stl", halves.lower.blobSTL({ binary: true, tolerance: 0.05 })],
    ["upper-stl", halves.upper.blobSTL({ binary: true, tolerance: 0.05 })]
  ] as const;
  return Promise.all(exports.map(async ([kind, blob]) => ({ kind, data: await blob.arrayBuffer() })));
}

/**
 * OpenCascade work is deliberately serialized. When a slider is dragged, the
 * renderer can post several builds while one is still running; only the most
 * recent queued build can affect the screen, so older queued builds are
 * discarded before they enter the kernel.
 */
const queue: CadRequest[] = [];
let processing = false;

function postSuperseded(id: number): void {
  self.postMessage({ id, ok: false, error: "Build superseded" } satisfies CadResponse);
}

async function processRequest(data: CadRequest): Promise<void> {
  try {
    if (data.kind === "export") {
      const files = await exportHalves();
      self.postMessage({ id: data.id, ok: true, files } satisfies CadResponse, {
        transfer: files.map((file) => file.data)
      });
      return;
    }
    const preview = await generate(data);
    // The part's preview mesh belongs to the cache, so only the rebuilt halves'
    // buffers travel; the part mesh is structured-cloned instead.
    const transfers = [preview.lower, preview.upper].flatMap((mesh) => [
      mesh.vertices,
      mesh.normals,
      mesh.triangles,
      mesh.edges
    ]);
    self.postMessage({ id: data.id, ok: true, preview } satisfies CadResponse, { transfer: transfers });
  } catch (error) {
    self.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : "Mold generation failed" } satisfies CadResponse);
  }
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      await processRequest(queue.shift()!);
    }
  } finally {
    processing = false;
    if (queue.length > 0) void drainQueue();
  }
}

self.onmessage = ({ data }: MessageEvent<CadRequest>) => {
  if (data.kind === "generate") {
    const queuedGenerate = queue.findIndex((request) => request.kind === "generate");
    if (queuedGenerate !== -1) {
      const superseded = queue.splice(queuedGenerate, 1)[0];
      postSuperseded(superseded.id);
    }
  }
  queue.push(data);
  void drainQueue();
};
