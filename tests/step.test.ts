import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStepModel, scalePartModel } from "../src/shared/step";

const sample = readFileSync("sample/sample.STEP", "utf8");

const FULL_CIRCLE = `ISO-10303-21;
DATA;
#1 = CARTESIAN_POINT ( 'NONE', ( 0.0, 0.0, 0.0 ) ) ;
#2 = DIRECTION ( 'NONE', ( 0.0, 0.0, 1.0 ) ) ;
#3 = DIRECTION ( 'NONE', ( 1.0, 0.0, 0.0 ) ) ;
#4 = AXIS2_PLACEMENT_3D ( 'NONE', #1, #2, #3 ) ;
#5 = CIRCLE ( 'NONE', #4, 5.0 ) ;
#6 = CARTESIAN_POINT ( 'NONE', ( 5.0, 0.0, 0.0 ) ) ;
#7 = VERTEX_POINT ( 'NONE', #6 ) ;
#8 = EDGE_CURVE ( 'NONE', #7, #7, #5, .T. ) ;
ENDSEC;
END-ISO-10303-21;`;

describe("STEP reader", () => {
  it("tessellates every edge of the sample assembly to finite points", () => {
    const model = readStepModel(sample);

    expect(model.edges).toHaveLength(73);
    expect(model.edges.flat().flat().every(Number.isFinite)).toBe(true);
  });

  it("measures the sample bounding box in millimetres", () => {
    const { min, max } = readStepModel(sample);

    expect(max.map((value, axis) => Number((value - min[axis]).toFixed(2)))).toEqual([30, 5.1, 28.85]);
  });

  it("lists cylindrical bores smallest first", () => {
    expect(readStepModel(sample).boreDiameters[0]).toBeCloseTo(4, 6);
  });

  it("sweeps a closed circular edge through a full turn", () => {
    const [circle] = readStepModel(FULL_CIRCLE).edges;

    expect(circle).toHaveLength(25);
    expect(circle.every(([x, y]) => Math.abs(Math.hypot(x, y) - 5) < 1e-9)).toBe(true);
    const closingGap = circle.at(-1)!.map((value, axis) => value - circle[0][axis]);
    expect(Math.hypot(...closingGap)).toBeLessThan(1e-9);
  });

  it("scales the casting model around its centre", () => {
    const model = {
      edges: [[[0, 0, 0], [10, 20, 30]] as [[number, number, number], [number, number, number]]],
      min: [0, 0, 0] as [number, number, number],
      max: [10, 20, 30] as [number, number, number],
      boreDiameters: []
    };

    expect(scalePartModel(model, 10)).toEqual({
      ...model,
      edges: [[[-0.5, -1, -1.5], [10.5, 21, 31.5]]],
      min: [-0.5, -1, -1.5],
      max: [10.5, 21, 31.5]
    });
  });
});
