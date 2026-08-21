import { z } from "zod";
import type { PartModel } from "./step";
import { boundsOf, planarDistance, type Vec3 } from "./vec3";

export const moldParamsSchema = z.object({
  wallThickness: z.number().min(3).max(30),
  injectionDiameter: z.number().min(1).max(10),
  ventDiameter: z.number().min(0.2).max(2),
  // Clearance hole for the screws clamping the halves together. Defaulted so
  // projects saved before screw holes existed still load.
  screwDiameter: z.number().min(1.5).max(12).default(3.4),
  shrinkagePercent: z.number().min(0).max(5)
});

export type MoldParams = z.infer<typeof moldParamsSchema>;
export type SplitAxis = 0 | 1 | 2;

export interface Mold {
  splitAxis: SplitAxis;
  partEdges: Vec3[][];
  min: Vec3;
  max: Vec3;
  splitZ: number;
  gate: Vec3;
  vents: Vec3[];
  /** Screw hole centres. Each hole runs through both halves. */
  screws: [number, number][];
  size: Vec3;
}

export const DEFAULT_PARAMS: MoldParams = {
  wallThickness: 6,
  injectionDiameter: 3.2,
  ventDiameter: 0.8,
  screwDiameter: 3.4,
  shrinkagePercent: 0.2
};

/** Material kept between a screw hole and the outside face. */
const SCREW_EDGE = 1.2;

const orient = ([x, y, z]: Vec3, axis: SplitAxis): Vec3 =>
  axis === 0 ? [-z, y, x] : axis === 1 ? [x, -z, y] : [x, y, z];

/** Uses the thinnest part axis as the split direction to minimise print time. */
export function splitAxis(part: PartModel): SplitAxis {
  const spans = part.max.map((value, axis) => value - part.min[axis]);
  return spans.indexOf(Math.min(...spans)) as SplitAxis;
}

/**
 * Height of the parting plane: the level of the part's widest cross-section.
 *
 * Splitting anywhere else leaves an undercut — on a dish the widest point is the
 * rim, so a mid-height split traps the flare below it in the upper half and the
 * casting cannot be drawn out.
 */
export function partingHeight(points: Vec3[], min: Vec3, max: Vec3): number {
  const centre: [number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  let widest = (max[2] + min[2]) / 2;
  let reach = -1;

  for (const point of points) {
    const radius = planarDistance(point, centre);
    // A flange has the same outer radius on both of its faces. Choose its
    // lower face deterministically, leaving the flange cavity in the top half.
    if (radius > reach + 1e-6 || (Math.abs(radius - reach) <= 1e-6 && point[2] < widest)) {
      reach = radius;
      widest = point[2];
    }
  }
  return widest;
}

/** Chooses a central high point for the gate and two distant high points for air vents. */
export function flowPorts(points: Vec3[], min: Vec3, max: Vec3): { gate: Vec3; vents: Vec3[] } {
  const center: [number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const top = points.filter((point) => max[2] - point[2] <= Math.max(0.1, (max[2] - min[2]) * 0.02));
  const gate = [...top].sort((a, b) => planarDistance(a, center) - planarDistance(b, center))[0] ?? [center[0], center[1], max[2]];
  const vents: Vec3[] = [];
  for (const point of [...top].sort((a, b) => planarDistance(b, gate) - planarDistance(a, gate))) {
    if (planarDistance(point, gate) > 1 && vents.every((vent) => planarDistance(point, vent) > 1)) vents.push(point);
    if (vents.length === 2) break;
  }
  return { gate, vents };
}

/**
 * Corner positions for the clamping screws. The inset keeps `SCREW_EDGE` of
 * material outside the hole even when the wall is thinner than the screw.
 */
export const screwPoints = (
  min: Vec3,
  max: Vec3,
  wall: number,
  screwDiameter: number
): [number, number][] => {
  const inset = Math.max(wall / 2, screwDiameter / 2 + SCREW_EDGE);
  return [
    [min[0] + inset, min[1] + inset],
    [max[0] - inset, min[1] + inset],
    [max[0] - inset, max[1] - inset],
    [min[0] + inset, max[1] - inset]
  ];
};

/** A lightweight preview plan. OpenCascade builds the exact solids from the same parameters. */
export function buildMold(part: PartModel, params: MoldParams): Mold {
  const axis = splitAxis(part);
  const oriented = part.edges.map((edge) => edge.map((point) => orient(point, axis)));
  const [partMin, partMax] = boundsOf(oriented.flat());
  const factor = 1 + params.shrinkagePercent / 100;
  const center = partMin.map((value, index) => (value + partMax[index]) / 2) as Vec3;
  const partEdges = oriented.map((edge) =>
    edge.map((point) => point.map((value, index) => center[index] + (value - center[index]) * factor) as Vec3)
  );
  const [cavityMin, cavityMax] = boundsOf(partEdges.flat());
  const wall = params.wallThickness;
  const min = cavityMin.map((value) => value - wall) as Vec3;
  const max = cavityMax.map((value) => value + wall) as Vec3;
  const splitZ = partingHeight(partEdges.flat(), cavityMin, cavityMax);
  const { gate, vents } = flowPorts(partEdges.flat(), cavityMin, cavityMax);
  const screws = screwPoints(min, max, wall, params.screwDiameter);

  return {
    splitAxis: axis,
    partEdges,
    min,
    max,
    splitZ,
    gate,
    vents,
    screws,
    size: max.map((value, index) => value - min[index]) as Vec3
  };
}

const rectangle = (mold: Mold, z: number): Vec3[] => [
  [mold.min[0], mold.min[1], z],
  [mold.max[0], mold.min[1], z],
  [mold.max[0], mold.max[1], z],
  [mold.min[0], mold.max[1], z],
  [mold.min[0], mold.min[1], z]
];

/** Exact outer envelope, split seam, gate, vents, and registration locations for the preview. */
export function moldWireframe(mold: Mold): Vec3[][] {
  const corners = rectangle(mold, mold.min[2]).slice(0, 4);
  return [
    rectangle(mold, mold.min[2]),
    rectangle(mold, mold.splitZ),
    rectangle(mold, mold.max[2]),
    ...corners.map(([x, y]): Vec3[] => [[x, y, mold.min[2]], [x, y, mold.max[2]]]),
    [[mold.gate[0], mold.gate[1], mold.gate[2]], [mold.gate[0], mold.gate[1], mold.max[2]]],
    ...mold.vents.map(([x, y, z]): Vec3[] => [[x, y, z], [x, y, mold.max[2]]]),
    ...mold.screws.map(([x, y]): Vec3[] => [[x, y, mold.min[2]], [x, y, mold.max[2]]])
  ];
}
