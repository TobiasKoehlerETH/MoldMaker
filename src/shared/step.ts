import { add, cross, dot, normalize, scale, sub, type Vec3 } from "./vec3";

/**
 * Minimal ISO 10303-21 (STEP Part 21) reader.
 *
 * It reads the entity graph and tessellates edge curves into polylines, which is
 * everything the viewport and the mold generator need. Faces, surfaces other than
 * cylinders, and assembly placement transforms are intentionally not evaluated.
 */
export interface PartModel {
  /** Tessellated edge curves, in millimetres. */
  edges: Vec3[][];
  min: Vec3;
  max: Vec3;
  /** Distinct cylindrical-surface diameters, ascending. */
  boreDiameters: number[];
}

/** Uniformly scales the casting model around its bounding-box centre. */
export function scalePartModel(part: PartModel, percentage: number): PartModel {
  const factor = 1 + percentage / 100;
  const centre: Vec3 = [
    (part.min[0] + part.max[0]) / 2,
    (part.min[1] + part.max[1]) / 2,
    (part.min[2] + part.max[2]) / 2
  ];
  const scalePoint = (point: Vec3): Vec3 => [
    centre[0] + (point[0] - centre[0]) * factor,
    centre[1] + (point[1] - centre[1]) * factor,
    centre[2] + (point[2] - centre[2]) * factor
  ];
  return {
    ...part,
    edges: part.edges.map((edge) => edge.map(scalePoint)),
    min: scalePoint(part.min),
    max: scalePoint(part.max)
  };
}

interface Entity {
  type: string;
  args: string[];
}

const ARC_SEGMENTS = 24;

/** Splits on `separator`, ignoring occurrences inside quotes or nested parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) quoted = character !== "'";
    else if (character === "'") quoted = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(text.slice(start).trim());
  return parts;
}

export function parseEntities(text: string): Map<number, Entity> {
  const dataIndex = text.indexOf("DATA;");
  const dataSection = dataIndex === -1 ? text : text.slice(dataIndex + 5);
  const entities = new Map<number, Entity>();
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let index = 0; index < dataSection.length; index += 1) {
    const character = dataSection[index];
    if (quoted) {
      if (character === "'") quoted = false;
      continue;
    }
    if (character === "'") {
      quoted = true;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === ";" && depth === 0) {
      const statement = dataSection.slice(start, index).trim();
      start = index + 1;
      if (statement.length === 0 || statement.charCodeAt(0) !== 35) continue; // '#'
      const eq = statement.indexOf("=");
      if (eq === -1) continue;
      const paren = statement.indexOf("(", eq);
      if (paren === -1) continue;
      const lastParen = statement.lastIndexOf(")");
      if (lastParen === -1 || lastParen < paren) continue;
      const id = Number(statement.slice(1, eq).trim());
      if (!Number.isFinite(id)) continue;
      const type = statement.slice(eq + 1, paren).trim();
      const argsStr = statement.slice(paren + 1, lastParen);
      entities.set(id, { type, args: splitTopLevel(argsStr, ",") });
    }
  }

  return entities;
}

const reference = (argument: string): number => Number(argument.slice(1));
const tuple = (argument: string): number[] => {
  const inner = argument.slice(1, -1);
  // Coordinates are simple numeric tuples without nesting – fast path avoids depth tracking.
  if (inner.indexOf("(") === -1) {
    const raw = inner.split(",");
    const out = new Array<number>(raw.length);
    for (let index = 0; index < raw.length; index += 1) out[index] = Number(raw[index].trim());
    return out;
  }
  return splitTopLevel(inner, ",").map(Number);
};
const references = (argument: string): number[] => {
  const inner = argument.slice(1, -1);
  if (inner.indexOf("(") === -1) {
    const raw = inner.split(",");
    const out = new Array<number>(raw.length);
    for (let index = 0; index < raw.length; index += 1) out[index] = Number(raw[index].trim().slice(1));
    return out;
  }
  return splitTopLevel(inner, ",").map(reference);
};

export function readStepModel(text: string): PartModel {
  const entities = parseEntities(text);
  const entity = (id: number): Entity | undefined => entities.get(id);
  const coordCache = new Map<number, Vec3>();
  /** Coordinates of a CARTESIAN_POINT or DIRECTION. */
  const coordinates = (id: number): Vec3 => {
    const cached = coordCache.get(id);
    if (cached) return cached;
    const result = tuple(entities.get(id)!.args[1]) as Vec3;
    coordCache.set(id, result);
    return result;
  };
  const vertex = (argument: string): Vec3 => coordinates(reference(entity(reference(argument))!.args[1]));

  function arc(circle: Entity, start: Vec3, end: Vec3, sameSense: boolean): Vec3[] {
    const placement = entity(reference(circle.args[1]))!;
    const origin = coordinates(reference(placement.args[1]));
    const axis = normalize(coordinates(reference(placement.args[2])));
    const reference_ = normalize(coordinates(reference(placement.args[3])));
    const radius = Number(circle.args[2]);

    // Orthonormal frame of the circle's plane; angles are measured from `u`.
    const u = normalize(sub(reference_, scale(axis, dot(reference_, axis))));
    const v = cross(axis, u);
    const angleOf = (point: Vec3): number =>
      Math.atan2(dot(sub(point, origin), v), dot(sub(point, origin), u));

    const startAngle = angleOf(start);
    let sweep = angleOf(end) - startAngle;
    // A zero sweep means the edge closes the full circle.
    if (sameSense) while (sweep <= 1e-9) sweep += 2 * Math.PI;
    else while (sweep >= -1e-9) sweep -= 2 * Math.PI;

    return Array.from({ length: ARC_SEGMENTS + 1 }, (_, step) => {
      const angle = startAngle + (sweep * step) / ARC_SEGMENTS;
      return add(origin, add(scale(u, radius * Math.cos(angle)), scale(v, radius * Math.sin(angle))));
    });
  }

  function edgePolyline({ args }: Entity): Vec3[] {
    const [, startRef, endRef, curveRef, sense] = args;
    const start = vertex(startRef);
    const end = vertex(endRef);
    const curve = entity(reference(curveRef));

    if (curve?.type === "CIRCLE") return arc(curve, start, end, sense === ".T.");
    // Approximate splines by their control polygon; accurate enough for a preview.
    if (curve?.type === "B_SPLINE_CURVE_WITH_KNOTS") return references(curve.args[2]).map(coordinates);
    return [start, end];
  }

  const edges: Vec3[][] = [];
  const diameters = new Set<number>();
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let seen = false;

  for (const candidate of entities.values()) {
    if (candidate.type === "EDGE_CURVE") {
      const poly = edgePolyline(candidate);
      edges.push(poly);
      for (const point of poly) {
        seen = true;
        if (point[0] < min[0]) min[0] = point[0];
        if (point[1] < min[1]) min[1] = point[1];
        if (point[2] < min[2]) min[2] = point[2];
        if (point[0] > max[0]) max[0] = point[0];
        if (point[1] > max[1]) max[1] = point[1];
        if (point[2] > max[2]) max[2] = point[2];
      }
    } else if (candidate.type === "CYLINDRICAL_SURFACE") {
      diameters.add(Number(Number(candidate.args[2]).toFixed(3)) * 2);
    }
  }

  const boundsMin: Vec3 = seen ? min : [0, 0, 0];
  const boundsMax: Vec3 = seen ? max : [0, 0, 0];

  return { edges, min: boundsMin, max: boundsMax, boreDiameters: [...diameters].sort((a, b) => a - b) };
}
