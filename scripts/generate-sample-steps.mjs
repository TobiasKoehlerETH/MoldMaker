import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initOpenCascade from "replicad-opencascadejs";
import { makeBox, makeCylinder, setOC } from "replicad";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "sample", "objects");
const wasm = path.join(root, "node_modules", "replicad-opencascadejs", "dist", "replicad_single.wasm");

await mkdir(output, { recursive: true });
setOC(await initOpenCascade({ locateFile: () => wasm }));

const objects = [
  ["box-object.STEP", makeBox([-24, -18, 0], [24, 18, 16])],
  ["cylinder-object.STEP", makeCylinder(16, 36, [0, 0, 0])],
  [
    "bracket-object.STEP",
    makeBox([-24, -16, 0], [24, 16, 8])
      .fuse(makeCylinder(11, 26, [0, 0, 8]))
      .cut(makeCylinder(4, 36, [0, 0, 0]))
  ]
];

for (const [name, shape] of objects) {
  const blob = shape.blobSTEP();
  await writeFile(path.join(output, name), Buffer.from(await blob.arrayBuffer()));
  shape.delete();
}

console.log(`Generated ${objects.length} STEP samples in ${path.relative(root, output)}`);
