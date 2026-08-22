import { z } from "zod";
import type { PartModel } from "./step";
import { boundsOf, planarDistance, type Vec3 } from "./vec3";

/** Block material addable beyond the wall, per axis. */
export const MAX_PADDING = 120;

const padding = z.number().min(0).max(MAX_PADDING);
const offset = z.number().min(-500).max(500);

export const moldParamsSchema = z.object({
  wallThickness: z.number().min(3).max(30),
  injectionDiameter: z.number().min(1).max(10),
  ventDiameter: z.number().min(0.2).max(2),
  // Clearance hole for the screws clamping the halves together. Defaulted so
  // projects saved before screw holes existed still load.
  screwDiameter: z.number().min(1.5).max(12).default(3.4),
  // Block size added beyond the wall, per axis, split evenly across the two
  // sides. The inspector edits it as an outer size.
  padding: z.tuple([padding, padding, padding]).default([0, 0, 0]),
  // Moves the injection port off the part's centre, in millimetres.
  gateOffset: z.tuple([offset, offset]).default([0, 0]),
  // Raises or lowers the parting line from the automatic one, in millimetres.
  splitOffset: offset.default(0),
  // Uniformly enlarges the casting model to compensate for material shrinkage.
  shrinkageScale: z.number().min(0).max(100).default(0)
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
  /** Furthest the gate can move per axis and stay fully over the part. */
  gateRange: [number, number];
  /** Lowest and highest `splitOffset` that keeps the parting line on the part. */
  splitRange: [number, number];
  size: Vec3;
  /** Size at zero padding: the smallest block the wall allows. */
  minSize: Vec3;
}

export const DEFAULT_PARAMS: MoldParams = {
  wallThickness: 6,
  injectionDiameter: 3.2,
  ventDiameter: 0.8,
  screwDiameter: 3.4,
  padding: [0, 0, 0],
  gateOffset: [0, 0],
  splitOffset: 0,
  shrinkageScale: 0
};

/** Material kept between a screw hole and the outside face. */
const SCREW_EDGE = 1.2;

const orient = ([x, y, z]: Vec3, axis: SplitAxis): Vec3 =>
  axis === 0 ? [-z, y, x] : axis === 1 ? [x, -z, y] : [x, y, z];

interface OrientedPart {
  axis: SplitAxis;
  edges: Vec3[][];
  points: Vec3[];
  min: Vec3;
  max: Vec3;
}

// buildMold runs on every inspector edit. Part geometry is immutable while a
// model is open, so avoid remapping and flattening all STEP edges for each
// parameter-only change.
const orientedParts = new WeakMap<PartModel, OrientedPart>();

/** Uses the thinnest part axis as the split direction to minimise print time. */
export function splitAxis(part: PartModel): SplitAxis {
  const spans = part.max.map((value, axis) => value - part.min[axis]);
  return spans.indexOf(Math.min(...spans)) as SplitAxis;
}

/**
 * Outer bounds of the block: the cavity plus the wall, grown by the padding.
 *
 * Each axis is then rounded up to a whole millimetre — the extra material is
 * split evenly across the two sides — so the block never carries fractional
 * sizes like 54.002 mm.
 *
 * The preview plan and the CAD kernel both size the block from this, so an
 * inspector-set outer size lands identically in the wireframe and the solids.
 */
export const moldBounds = (cavityMin: Vec3, cavityMax: Vec3, params: MoldParams): [Vec3, Vec3] => {
  const margin = (axis: number): number => params.wallThickness + params.padding[axis] / 2;
  const min = cavityMin.map((value, axis) => value - margin(axis)) as Vec3;
  const max = cavityMax.map((value, axis) => value + margin(axis)) as Vec3;
  const grown = max.map((value, axis) => {
    const extra = Math.ceil(value - min[axis] - 1e-6) - (value - min[axis]);
    return { min: min[axis] - extra / 2, max: value + extra / 2 };
  });
  return [grown.map((side) => side.min) as Vec3, grown.map((side) => side.max) as Vec3];
};

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
    const tolerance = Number.isFinite(reach) ? Math.max(radius, reach, Number.EPSILON) * 1e-6 : 0;
    // A flange has the same outer radius on both of its faces. Choose its
    // lower face deterministically, leaving the flange cavity in the top half.
    if (radius > reach + tolerance || (Math.abs(radius - reach) <= tolerance && point[2] < widest)) {
      reach = radius;
      widest = point[2];
    }
  }
  return widest;
}

/**
 * Where the halves actually meet: the automatic plane, moved by `splitOffset`.
 *
 * The offset is held inside the part, since a plane outside it would hand one
 * half a cavity and the other a plain slab.
 */
export const partingLevel = (points: Vec3[], min: Vec3, max: Vec3, splitOffset: number): number => {
  const level = partingHeight(points, min, max) + splitOffset;
  return Math.min(max[2], Math.max(min[2], level));
};

/** Travel the parting line has left in each direction, as an offset range. */
export const splitRangeOf = (points: Vec3[], min: Vec3, max: Vec3): [number, number] => {
  const automatic = partingHeight(points, min, max);
  return [min[2] - automatic, max[2] - automatic];
};

/**
 * Surface point nearest `target` in plan, taking the highest of any that share
 * that spot.
 *
 * The injection channel is drilled straight down from the top of the block, so
 * it has to meet the topmost surface at its location: stopping at a lower one
 * would leave the channel piercing the part above it.
 */
function surfacePoint(points: Vec3[], target: [number, number]): Vec3 | null {
  let best: Vec3 | null = null;
  let reach = Infinity;

  for (const point of points) {
    const distance = planarDistance(point, target);
    const tolerance = Number.isFinite(reach) ? Math.max(distance, reach) * 1e-6 : 0;
    if (distance > reach + tolerance) continue;
    if (!best || distance < reach - tolerance || point[2] > best[2]) {
      best = point;
      reach = Math.min(reach, distance);
    }
  }
  return best;
}

/**
 * Places the injection gate and the air vents.
 *
 * The gate sits over the centre of the part, or wherever `gateOffset` moves it;
 * the vents stay at the part's high points, because that is where air collects.
 */
export function flowPorts(
  points: Vec3[],
  min: Vec3,
  max: Vec3,
  gateOffset: [number, number] = [0, 0]
): { gate: Vec3; vents: Vec3[] } {
  const center: [number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const target: [number, number] = [center[0] + gateOffset[0], center[1] + gateOffset[1]];
  const top = points.filter((point) => max[2] - point[2] <= Math.max(0.1, (max[2] - min[2]) * 0.02));
  // Left centred the gate stays on the high ground, where a mold fills best. A
  // moved gate is free of that band, so it can reach a pocket floor or a rim.
  const moved = gateOffset[0] !== 0 || gateOffset[1] !== 0;
  const gate = surfacePoint(moved ? points : top, target) ?? [target[0], target[1], max[2]];
  const vents: Vec3[] = [];
  for (const point of [...top].sort((a, b) => planarDistance(b, gate) - planarDistance(a, gate))) {
    if (planarDistance(point, gate) > 1 && vents.every((vent) => planarDistance(point, vent) > 1)) vents.push(point);
    if (vents.length === 2) break;
  }
  return { gate, vents };
}

/** How far the gate can travel per axis and still bring its full bore over the part. */
export const gateRangeOf = (cavityMin: Vec3, cavityMax: Vec3, injectionDiameter: number): [number, number] => [
  Math.max(0, (cavityMax[0] - cavityMin[0] - injectionDiameter) / 2),
  Math.max(0, (cavityMax[1] - cavityMin[1] - injectionDiameter) / 2)
];

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
  let oriented = orientedParts.get(part);
  if (!oriented) {
    const axis = splitAxis(part);
    const edges = part.edges.map((edge) => edge.map((point) => orient(point, axis)));
    const points = edges.flat();
    const [min, max] = boundsOf(points);
    oriented = { axis, edges, points, min, max };
    orientedParts.set(part, oriented);
  }
  const { axis, edges: partEdges, points, min: cavityMin, max: cavityMax } = oriented;
  const wall = params.wallThickness;
  const [min, max] = moldBounds(cavityMin, cavityMax, params);
  const splitZ = partingLevel(points, cavityMin, cavityMax, params.splitOffset);
  const { gate, vents } = flowPorts(points, cavityMin, cavityMax, params.gateOffset);
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
    gateRange: gateRangeOf(cavityMin, cavityMax, params.injectionDiameter),
    splitRange: splitRangeOf(points, cavityMin, cavityMax),
    size: max.map((value, index) => value - min[index]) as Vec3,
    // Size at zero padding: the smallest block the wall allows, in whole mm.
    minSize: cavityMax.map(
      (value, index) => Math.ceil(value - cavityMin[index] + 2 * wall - 1e-6)
    ) as Vec3
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
