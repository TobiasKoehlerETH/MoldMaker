import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMold, DEFAULT_PARAMS, flowPorts, moldParamsSchema, partingHeight, splitAxis } from "../src/shared/mold";
import { decodeProject, encodeProject } from "../src/shared/project";
import { readStepModel } from "../src/shared/step";
import { boundsOf, planarDistance } from "../src/shared/vec3";

const sample = readFileSync("sample/sample.STEP", "utf8");
const part = readStepModel(sample);

describe("RTV mold plan", () => {
  it("uses the thinnest axis as the automatic split direction", () => {
    expect(splitAxis(part)).toBe(1);
  });

  it("adds a printable wall around the cavity", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);
    const [min, max] = boundsOf(mold.partEdges.flat());
    const wall = DEFAULT_PARAMS.wallThickness;

    expect(mold.size).toEqual(mold.minSize);
    mold.size.forEach((span, axis) => {
      // Whole millimetres, grown past the cavity plus the wall but never by a full one.
      const exact = max[axis] - min[axis] + 2 * wall;
      expect(span).toBe(Math.round(span));
      expect(span).toBeGreaterThanOrEqual(exact - 1e-6);
      expect(span).toBeLessThan(exact + 1);
    });
  });

  it("grows the block by the requested padding, keeping the cavity centred", () => {
    const base = buildMold(part, DEFAULT_PARAMS);
    const padded = buildMold(part, { ...DEFAULT_PARAMS, padding: [10, 4, 6] });

    expect(padded.size[0]).toBeCloseTo(base.size[0] + 10, 6);
    expect(padded.size[1]).toBeCloseTo(base.size[1] + 4, 6);
    expect(padded.size[2]).toBeCloseTo(base.size[2] + 6, 6);
    expect(padded.minSize).toEqual(base.minSize);
    // Padding only adds material: the cavity sits where it always did.
    expect(padded.min[0]).toBeCloseTo(base.min[0] - 5, 6);
    expect(padded.max[0]).toBeCloseTo(base.max[0] + 5, 6);
    expect(padded.screws).toHaveLength(4);
  });

  it("parts at the widest cross-section so neither half traps the casting", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);
    const points = mold.partEdges.flat();
    const [min, max] = boundsOf(points);
    const centre: [number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    const reach = (subset: typeof points): number =>
      subset.reduce((widest, point) => Math.max(widest, planarDistance(point, centre)), 0);

    // The plane sits where the silhouette is widest, so both halves draw off it.
    const atSplit = points.filter((point) => Math.abs(point[2] - mold.splitZ) < 0.01);
    expect(reach(atSplit)).toBeCloseTo(reach(points), 6);
    expect(mold.splitZ).toBeGreaterThanOrEqual(min[2]);
    expect(mold.splitZ).toBeLessThanOrEqual(max[2]);
  });

  it.each([1e-4, 1, 1e4])("uses the lower face of a tied widest flange at scale %s", (scale) => {
    const points = [
      [10 * scale, 0, 2 * scale],
      [10 * scale, 0, 3 * scale],
      [0, 5 * scale, 4 * scale]
    ] satisfies [number, number, number][];

    expect(
      partingHeight(points, [-10 * scale, -10 * scale, 0], [10 * scale, 10 * scale, 5 * scale])
    ).toBe(2 * scale);
  });

  it("plans one injection gate, air vents, and four screw holes", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);

    expect(mold.gate).toHaveLength(3);
    expect(mold.vents.length).toBeGreaterThan(0);
    expect(mold.vents.length).toBeLessThanOrEqual(2);
    expect(mold.screws).toHaveLength(4);
  });

  it("moves the injection gate onto the surface under the requested offset", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);
    const points = mold.partEdges.flat();
    const [min, max] = boundsOf(points);
    const centre: [number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    const offset: [number, number] = [mold.gateRange[0], 0];
    const { gate, vents } = flowPorts(points, min, max, offset);

    // The gate follows the offset as far as the part reaches, and stays on the
    // surface rather than floating out to the requested point.
    expect(gate[0]).toBeGreaterThan(mold.gate[0]);
    expect(planarDistance(gate, [centre[0] + offset[0], centre[1]])).toBeLessThanOrEqual(
      planarDistance(mold.gate, [centre[0] + offset[0], centre[1]])
    );
    expect(points.some((point) => point[0] === gate[0] && point[1] === gate[1] && point[2] === gate[2])).toBe(true);
    // Vents belong at the high points wherever the gate goes.
    vents.forEach((vent) => expect(max[2] - vent[2]).toBeLessThanOrEqual(Math.max(0.1, (max[2] - min[2]) * 0.02)));
  });

  it("moves the parting line by the requested offset, held inside the part", () => {
    const base = buildMold(part, DEFAULT_PARAMS);
    const lowered = buildMold(part, { ...DEFAULT_PARAMS, splitOffset: -1 });
    const [min, max] = boundsOf(base.partEdges.flat());

    expect(lowered.splitZ).toBeCloseTo(base.splitZ - 1, 6);
    // Past the part there is nothing left to split, so the plane stops there.
    expect(buildMold(part, { ...DEFAULT_PARAMS, splitOffset: 500 }).splitZ).toBeCloseTo(max[2], 6);
    expect(buildMold(part, { ...DEFAULT_PARAMS, splitOffset: -500 }).splitZ).toBeCloseTo(min[2], 6);
    expect(base.splitRange[0]).toBeCloseTo(min[2] - base.splitZ, 6);
    expect(base.splitRange[1]).toBeCloseTo(max[2] - base.splitZ, 6);
  });

  it("keeps the port within the bore's own margin of the part edge", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);
    const [min, max] = boundsOf(mold.partEdges.flat());

    expect(mold.gateRange[0]).toBeCloseTo((max[0] - min[0] - DEFAULT_PARAMS.injectionDiameter) / 2, 6);
    expect(mold.gateRange[1]).toBeCloseTo((max[1] - min[1] - DEFAULT_PARAMS.injectionDiameter) / 2, 6);
  });

  it("rejects dimensions that are unsuitable for a printable mold", () => {
    expect(moldParamsSchema.safeParse({ ...DEFAULT_PARAMS, wallThickness: 1 }).success).toBe(false);
    expect(moldParamsSchema.safeParse({ ...DEFAULT_PARAMS, injectionDiameter: 20 }).success).toBe(false);
    expect(moldParamsSchema.safeParse({ ...DEFAULT_PARAMS, padding: [-1, 0, 0] }).success).toBe(false);
  });

  it("defaults the port and block settings so older projects still load", () => {
    const older: Record<string, unknown> = { ...DEFAULT_PARAMS };
    for (const key of ["screwDiameter", "padding", "gateOffset", "splitOffset"]) delete older[key];

    expect(moldParamsSchema.parse(older)).toEqual(DEFAULT_PARAMS);
  });
});

describe("project file", () => {
  it("round-trips the embedded STEP source and mold parameters", () => {
    const project = { version: 1, sourceName: "sample.STEP", step: sample, params: DEFAULT_PARAMS } as const;

    expect(decodeProject(encodeProject(project))).toEqual(project);
  });

  it("rejects a project with invalid parameters", () => {
    const broken = new TextEncoder().encode(JSON.stringify({ version: 1, sourceName: "a", step: "b", params: {} }));

    expect(() => decodeProject(broken)).toThrow();
  });
});
