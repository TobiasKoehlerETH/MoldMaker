/* global console, performance */
import { readFileSync } from "node:fs";
import { readStepModel } from "./src/shared/step.ts";
import { buildMold, DEFAULT_PARAMS } from "./src/shared/mold.ts";
const text = readFileSync("sample/sample.STEP", "utf8");
const part = readStepModel(text);
console.time("buildMold x 1000");
for(let i=0;i<1000;i++) buildMold(part, DEFAULT_PARAMS);
console.timeEnd("buildMold x 1000");
console.log("per", performance.now());
const t0=performance.now();
for(let i=0;i<5000;i++) buildMold(part, {...DEFAULT_PARAMS, splitOffset: Math.random()*10-5, wallThickness: 6+Math.random()*5});
console.log("avg random", (performance.now()-t0)/5000);

import { moldWireframe } from "./src/shared/mold.ts";
const mold = buildMold(part, DEFAULT_PARAMS);
console.time("wireframe 1000");
for(let i=0;i<1000;i++) moldWireframe(mold);
console.timeEnd("wireframe 1000");
