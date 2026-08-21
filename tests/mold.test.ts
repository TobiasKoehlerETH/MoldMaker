import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMold, DEFAULT_PARAMS, moldParamsSchema, splitAxis } from "../src/shared/mold";
import { decodeProject, encodeProject } from "../src/shared/project";
import { readStepModel } from "../src/shared/step";
import { boundsOf } from "../src/shared/vec3";

const sample = readFileSync("sample/sample.STEP", "utf8");
const part = readStepModel(sample);

describe("RTV mold plan", () => {
  it("uses the thinnest axis as the automatic split direction", () => {
    expect(splitAxis(part)).toBe(1);
  });

  it("adds a printable wall around a shrinkage-compensated cavity", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);

    expect(mold.size[0]).toBeCloseTo(42.06, 2);
    expect(mold.size[1]).toBeCloseTo(40.91, 2);
    expect(mold.size[2]).toBeCloseTo(17.11, 2);
    const [min, max] = boundsOf(mold.partEdges.flat());
    expect(mold.splitZ).toBeCloseTo((min[2] + max[2]) / 2, 6);
  });

  it("plans one injection gate, air vents, and four screw holes", () => {
    const mold = buildMold(part, DEFAULT_PARAMS);

    expect(mold.gate).toHaveLength(3);
    expect(mold.vents.length).toBeGreaterThan(0);
    expect(mold.vents.length).toBeLessThanOrEqual(2);
    expect(mold.screws).toHaveLength(4);
  });

  it("rejects dimensions that are unsuitable for a printable mold", () => {
    expect(moldParamsSchema.safeParse({ ...DEFAULT_PARAMS, wallThickness: 1 }).success).toBe(false);
    expect(moldParamsSchema.safeParse({ ...DEFAULT_PARAMS, injectionDiameter: 20 }).success).toBe(false);
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
