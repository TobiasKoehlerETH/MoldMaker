import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { capture, expect, paths, selectOpenPath, selectSavePath, test } from "./fixtures";

const stlZBounds = (stl: Buffer): [number, number] => {
  const triangles = stl.readUInt32LE(80);
  let min = Infinity;
  let max = -Infinity;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const start = 84 + triangle * 50;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const z = stl.readFloatLE(start + 20 + vertex * 12);
      min = Math.min(min, z);
      max = Math.max(max, z);
    }
  }
  return [min, max];
};

test("launches a minimal workspace with the nested sidebar rail", async ({ appPage }, testInfo) => {
  await expect(appPage.getByText("Untitled", { exact: true })).toBeVisible();
  await expect(appPage.getByText("MoldMaker", { exact: true })).toHaveCount(0);
  await expect(appPage.getByText("Ready", { exact: true })).toHaveCount(0);
  await expect(appPage.getByRole("button", { name: "Help" })).toHaveCount(0);
  await expect(appPage.getByRole("button", { name: "Import STEP" })).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Save project" })).toBeDisabled();
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeDisabled();
  await expect(appPage.getByLabel("3D model viewport")).toBeVisible();
  await capture(appPage, "workspace-empty", testInfo);
});

test("imports, edits, saves, reloads, and exports a mold", async ({ electronApp, appPage }, testInfo) => {
  test.setTimeout(180_000);
  const workDir = testInfo.outputPath("native-files");
  const projectPath = path.join(workDir, "sample.moldmaker");
  const exportDir = path.join(workDir, "export");
  await mkdir(exportDir, { recursive: true });

  await selectOpenPath(electronApp, paths.sampleStep);
  await appPage.getByRole("button", { name: "Import STEP" }).click();

  await expect(appPage.getByText("sample.STEP", { exact: true })).toBeVisible();
  await expect(appPage.getByRole("status")).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Save project" })).toBeEnabled();
  await expect(appPage.getByRole("complementary", { name: "Mold settings" })).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });
  await expect(appPage.getByRole("status")).toHaveCount(0);

  const wall = appPage.getByRole("spinbutton", { name: "Wall" });
  await wall.fill("7");
  await expect(wall).toHaveValue("7");
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeDisabled();

  // The block grows past the wall and the syringe port moves off centre. The
  // model on screen is never torn down for a rebuild, so the viewport keeps
  // showing the previous solids until the new ones land.
  const blockX = appPage.getByRole("spinbutton", { name: "Block X" });
  const width = await blockX.inputValue();
  await blockX.fill(String(Number(width) + 4));
  const portX = appPage.getByRole("spinbutton", { name: "Port X" });
  await portX.fill("5");
  await expect(appPage.getByLabel("3D model viewport")).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });
  await expect(blockX).not.toHaveValue(width);
  await capture(appPage, "workspace-imported", testInfo);

  // The seam scrubs off the automatic height and the reset puts it back.
  const parting = appPage.getByRole("slider", { name: "Parting line" });
  await expect(parting).toHaveAttribute("aria-valuenow", "0");
  await parting.press("ArrowUp");
  await expect(parting).not.toHaveAttribute("aria-valuenow", "0");
  await appPage.getByRole("button", { name: "Automatic parting line" }).click();
  await expect(parting).toHaveAttribute("aria-valuenow", "0");
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });

  await appPage.getByRole("button", { name: "View settings" }).click();
  await expect(appPage.getByRole("complementary", { name: "View settings" })).toBeVisible();

  // One eye per body and one explode slider: nothing else to get wrong.
  const topHalf = appPage.getByRole("button", { name: "Top half visibility" });
  await expect(topHalf).toHaveAttribute("aria-pressed", "true");
  await topHalf.click();
  await expect(topHalf).toHaveAttribute("aria-pressed", "false");
  await topHalf.click();
  await expect(topHalf).toHaveAttribute("aria-pressed", "true");
  const explode = appPage.getByRole("slider").last();
  await expect(explode).toHaveAttribute("aria-valuenow", "1");
  await explode.focus();
  await explode.press("Home");
  for (let step = 0; step < 30; step += 1) await explode.press("ArrowRight");
  await expect(explode).toHaveAttribute("aria-valuenow", "0.6");
  await capture(appPage, "workspace-exploded", testInfo);

  // Clicking a body in the viewport still offers every state, transparency
  // included; the sidebar eye only shows and hides.
  const canvas = appPage.getByLabel("3D model viewport");
  const box = (await canvas.boundingBox()) ?? { width: 0, height: 0 };
  const onBaseHalf = { x: box.width * 0.5, y: box.height * 0.78 };
  const menu = appPage.getByRole("group", { name: "Base half visibility" });

  await canvas.click({ position: onBaseHalf });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Transparent" }).click();
  await expect(menu).toBeHidden();

  await canvas.click({ position: onBaseHalf });
  await menu.getByRole("button", { name: "Solid" }).click();
  await expect(menu).toBeHidden();

  await appPage.getByRole("button", { name: "Mold settings" }).click();
  await expect(appPage.getByRole("complementary", { name: "Mold settings" })).toBeVisible();

  await selectSavePath(electronApp, projectPath);
  await appPage.getByRole("button", { name: "Save project" }).click();
  await expect.poll(async () => (await stat(projectPath)).size).toBeGreaterThan(0);

  await wall.fill("9");
  await selectOpenPath(electronApp, projectPath);
  await appPage.getByRole("button", { name: "Open project" }).click();
  await expect(wall).toHaveValue("7");
  await expect(portX).toHaveValue("5");
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });

  await selectOpenPath(electronApp, exportDir);
  await appPage.getByRole("button", { name: "Export mold" }).click();
  await expect.poll(async () => (await readdir(exportDir)).length).toBe(4);

  const lowerStep = await readFile(path.join(exportDir, "sample-mold-lower.step"), "utf8");
  const upperStep = await readFile(path.join(exportDir, "sample-mold-upper.step"), "utf8");
  for (const step of [lowerStep, upperStep]) {
    expect(step.startsWith("ISO-10303-21;")).toBe(true);
    expect(step.trimEnd().endsWith("END-ISO-10303-21;")).toBe(true);
    expect(step.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(1);
    expect(step.match(/CLOSED_SHELL/g)).toHaveLength(1);
    expect(step.match(/ADVANCED_FACE/g)?.length).toBeGreaterThan(0);
  }
  expect((await readdir(exportDir)).sort()).toEqual([
    "sample-mold-lower.step",
    "sample-mold-lower.stl",
    "sample-mold-upper.step",
    "sample-mold-upper.stl"
  ]);
  const stls = await Promise.all(
    ["sample-mold-lower.stl", "sample-mold-upper.stl"].map((name) => readFile(path.join(exportDir, name)))
  );
  for (const stl of stls) {
    const triangleCount = stl.readUInt32LE(80);
    expect(triangleCount).toBeGreaterThan(0);
    expect(stl.length).toBe(84 + triangleCount * 50);
  }
  const [lowerBottom, lowerTop] = stlZBounds(stls[0]);
  const [upperBottom] = stlZBounds(stls[1]);
  // The top half owns the pocket core, and it must stop on the sample's actual
  // pocket floor: 1.0 mm above the part's lower bound, so 8 mm above the bottom
  // of this 7 mm-walled mold. The near misses are the informative ones — 7 mm
  // means the core was projected to the part's overall lower bound and
  // flattened the curve, 7.5 mm means the part's second solid never got cut and
  // its lower half is still standing inside the cavity.
  expect(upperBottom).toBeLessThan(lowerTop - 1);
  expect(upperBottom).toBeGreaterThan(lowerBottom + 7.75);
  expect(upperBottom).toBeLessThan(lowerBottom + 8.25);
});
