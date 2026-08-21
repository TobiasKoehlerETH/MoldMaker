import initOpenCascade from "replicad-opencascadejs";
import openCascadeWasm from "replicad-opencascadejs/wasm?url";
import {
  importSTEP,
  makeBox,
  makeCylinder,
  setOC,
  type Shape3D,
  type SimplePoint
} from "replicad";
import type { CadMesh, GenerateMoldRequest, GenerateMoldResponse, GeneratedMold } from "../../shared/cad";
import { flowPorts, partingHeight, screwPoints } from "../../shared/mold";
import type { Vec3 } from "../../shared/vec3";

const ready = initOpenCascade({ locateFile: () => openCascadeWasm }).then(setOC);

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
  part = part.scale(1 + params.shrinkagePercent / 100, part.boundingBox.center);

  const [partMin, partMax] = part.boundingBox.bounds;
  const wall = params.wallThickness;
  const min = partMin.map((value) => value - wall) as SimplePoint;
  const max = partMax.map((value) => value + wall) as SimplePoint;
  const surface = points(part.mesh({ tolerance: 0.2 }).vertices) as Vec3[];
  const splitZ = partingHeight(surface, partMin as Vec3, partMax as Vec3);
  let lower = makeBox(min, [max[0], max[1], splitZ]).cut(part);
  let upper = makeBox([min[0], min[1], splitZ], max).cut(part);

  // Screw clearance holes span the whole height so a bolt passes through both
  // halves. `cut` leaves its tool intact, so one cylinder serves both cuts.
  for (const [x, y] of screwPoints(min, max, wall, params.screwDiameter)) {
    const bore = makeCylinder(params.screwDiameter / 2, max[2] - min[2] + 2, [x, y, min[2] - 1]);
    lower = replace(lower, lower.cut(bore));
    upper = replace(upper, upper.cut(bore));
    bore.delete();
  }

  const { gate, vents } = flowPorts(surface, partMin as Vec3, partMax as Vec3);
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
