import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import madge from "madge";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "docs", "code-graph");

await mkdir(outputDirectory, { recursive: true });

const graph = await madge(path.join(projectRoot, "src"), {
  baseDir: projectRoot,
  fileExtensions: ["ts", "tsx"],
  tsConfig: path.join(projectRoot, "tsconfig.web.json")
});

const dependencies = graph.obj();
const moduleNames = Object.keys(dependencies).sort();
const nodeIds = new Map(moduleNames.map((moduleName, index) => [moduleName, `n${index}`]));
const mermaidLines = ["flowchart LR"];

for (const moduleName of moduleNames) {
  const nodeId = nodeIds.get(moduleName);
  mermaidLines.push(`  ${nodeId}[\`${moduleName}\`]`);
}

for (const moduleName of moduleNames) {
  for (const dependency of dependencies[moduleName]) {
    const sourceId = nodeIds.get(moduleName);
    const targetId = nodeIds.get(dependency);
    if (targetId) mermaidLines.push(`  ${sourceId} --> ${targetId}`);
  }
}

const metadata = {
  tool: "madge",
  source: "src",
  modules: Object.fromEntries(
    moduleNames.map((moduleName) => [moduleName, [...dependencies[moduleName]].sort()])
  ),
  circularDependencies: graph.circular()
};

await writeFile(
  path.join(outputDirectory, "dependencies.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8"
);
await writeFile(path.join(outputDirectory, "dependencies.mmd"), `${mermaidLines.join("\n")}\n`, "utf8");

console.log(`Wrote ${moduleNames.length} modules to docs/code-graph`);
if (metadata.circularDependencies.length > 0) {
  console.warn("Circular dependencies detected:", metadata.circularDependencies);
}
