/* global console */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Inline step parser to avoid TS import issues - we will transpile via esbuild-like
// Instead directly test the file's logic by reading source and eval? Simpler: use tsx via node --experimental...
// Let's just manually implement the current splitTopLevel and measure.

const text = readFileSync('sample/sample.STEP', 'utf8');

function splitTopLevelOrig(text, separator) {
  const parts = [];
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

const ENTITY_PATTERN = /^#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*)\)$/;
function parseEntitiesOrig(text) {
  const dataSection = text.slice(text.indexOf("DATA;") + "DATA;".length);
  const entities = new Map();
  for (const statement of splitTopLevelOrig(dataSection, ";")) {
    const match = ENTITY_PATTERN.exec(statement);
    if (match) {
      entities.set(Number(match[1]), { type: match[2], args: splitTopLevelOrig(match[3], ",") });
    }
  }
  return entities;
}

let t0 = performance.now();
for (let i=0;i<20;i++) parseEntitiesOrig(text);
console.log('parseEntities x20 orig', performance.now()-t0, 'avg', (performance.now()-t0)/20);

t0=performance.now();
for(let i=0;i<100;i++) splitTopLevelOrig(text.slice(text.indexOf("DATA;"))," ;".charAt(1));
console.log('split ;', performance.now()-t0);

// measure readStepModel full via dynamic import using vite? Let's try using esbuild via node?
// We'll try to compile with swc? Instead use simple bench of current mold.ts functions if we can
