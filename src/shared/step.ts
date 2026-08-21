import { add, boundsOf, cross, dot, normalize, scale, sub, type Vec3 } from "./vec3";

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

interface Entity {
  type: string;
  args: string[];
}

const ARC_SEGMENTS = 24;
const ENTITY_PATTERN = /^#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*)\)$/;

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
  const dataSection = text.slice(text.indexOf("DATA;") + "DATA;".length);
  const entities = new Map<number, Entity>();

  for (const statement of splitTopLevel(dataSection, ";")) {
    const match = ENTITY_PATTERN.exec(statement);
    if (match) {
      entities.set(Number(match[1]), { type: match[2], args: splitTopLevel(match[3], ",") });
    }
  }

  return entities;
}

const reference = (argument: string): number => Number(argument.slice(1));
const tuple = (argument: string): number[] => splitTopLevel(argument.slice(1, -1), ",").map(Number);
const references = (argument: string): number[] =>
  splitTopLevel(argument.slice(1, -1), ",").map(reference);

export function readStepModel(text: string): PartModel {
  const entities = parseEntities(text);
  const entity = (id: number): Entity | undefined => entities.get(id);
  /** Coordinates of a CARTESIAN_POINT or DIRECTION. */
  const coordinates = (id: number): Vec3 => tuple(entities.get(id)!.args[1]) as Vec3;
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

  for (const candidate of entities.values()) {
    if (candidate.type === "EDGE_CURVE") edges.push(edgePolyline(candidate));
    else if (candidate.type === "CYLINDRICAL_SURFACE") {
      diameters.add(Number(Number(candidate.args[2]).toFixed(3)) * 2);
    }
  }

  const [min, max] = boundsOf(edges.flat());

  return { edges, min, max, boreDiameters: [...diameters].sort((a, b) => a - b) };
}
