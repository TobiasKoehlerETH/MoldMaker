import { readFileSync } from 'node:fs';
import { readStepModel } from './src/shared/step';
import { buildMold, DEFAULT_PARAMS, flowPorts, partingHeight, splitAxis } from './src/shared/mold';
import { boundsOf } from './src/shared/vec3';
import type { Vec3 } from './src/shared/vec3';

const text = readFileSync('sample/sample.STEP','utf8');
const part = readStepModel(text);

console.time('buildMold x1000');
for(let i=0;i<1000;i++) buildMold(part, DEFAULT_PARAMS);
console.timeEnd('buildMold x1000');

console.time('partingHeight x10000');
const points = part.edges.flat();
for(let i=0;i<10000;i++) partingHeight(points, part.min, part.max);
console.timeEnd('partingHeight x10000');

console.time('flowPorts x1000');
for(let i=0;i<1000;i++) flowPorts(points, part.min, part.max);
console.timeEnd('flowPorts x1000');

// test orient cost
console.time('buildMold with orient x1000');
for(let i=0;i<1000;i++) {
  const axis = splitAxis(part); // 1
  const edges = part.edges.map(edge => edge.map(p => axis===0? [-p[2],p[1],p[0]] as Vec3 : axis===1? [p[0],-p[2],p[1]] as Vec3 : p));
  boundsOf(edges.flat());
}
console.timeEnd('buildMold with orient x1000');
