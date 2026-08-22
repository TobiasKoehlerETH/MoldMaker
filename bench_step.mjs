/* global console, performance */
import { readFileSync } from "node:fs";
import { readStepModel } from "./src/shared/step.ts";
const text = readFileSync("sample/sample.STEP", "utf8");
console.time("readStepModel");
for(let i=0;i<10;i++){
  const m = readStepModel(text);
  if(i===0) console.log("edges", m.edges.length, "min", m.min, "max", m.max);
}
console.timeEnd("readStepModel");
const t0=performance.now();
for(let i=0;i<200;i++) readStepModel(text);
console.log("avg", (performance.now()-t0)/200, "ms");
