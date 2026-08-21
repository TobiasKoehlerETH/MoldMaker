import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { capture, expect, paths, selectOpenPath, selectSavePath, test } from "./fixtures";

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
  test.setTimeout(120_000);
  const workDir = testInfo.outputPath("native-files");
  const projectPath = path.join(workDir, "sample.moldmaker");
  const exportDir = path.join(workDir, "export");
  await mkdir(exportDir, { recursive: true });

  await selectOpenPath(electronApp, paths.sampleStep);
  await appPage.getByRole("button", { name: "Import STEP" }).click();

  await expect(appPage.getByText("sample.STEP", { exact: true })).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Save project" })).toBeEnabled();
  await expect(appPage.getByRole("complementary", { name: "Mold settings" })).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });

  const wall = appPage.getByRole("spinbutton", { name: "Wall" });
  await wall.fill("7");
  await expect(wall).toHaveValue("7");
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeDisabled();
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });
  await capture(appPage, "workspace-imported", testInfo);

  await appPage.getByRole("button", { name: "View settings" }).click();
  await expect(appPage.getByRole("complementary", { name: "View settings" })).toBeVisible();
  await expect(appPage.getByRole("radio", { name: "Transparent mold" })).toBeVisible();
  await expect(appPage.getByRole("button", { name: "Show all edges" })).toBeVisible();

  await appPage.getByRole("radio", { name: "Ghost top half" }).click();
  await expect(appPage.getByRole("radio", { name: "Ghost top half" })).toBeChecked();
  const explode = appPage.getByRole("slider").last();
  await explode.focus();
  await explode.press("Home");
  for (let step = 0; step < 30; step += 1) await explode.press("ArrowRight");
  await expect(explode).toHaveAttribute("aria-valuenow", "0.6");
  await appPage.getByRole("button", { name: "Show all edges" }).click();
  await expect(appPage.getByRole("button", { name: "Show all edges" })).toHaveAttribute("aria-pressed", "false");
  await appPage.getByRole("button", { name: "Show all edges" }).click();
  await capture(appPage, "workspace-exploded", testInfo);

  await appPage.getByRole("button", { name: "Mold settings" }).click();
  await expect(appPage.getByRole("complementary", { name: "Mold settings" })).toBeVisible();

  await selectSavePath(electronApp, projectPath);
  await appPage.getByRole("button", { name: "Save project" }).click();
  await expect.poll(async () => (await stat(projectPath)).size).toBeGreaterThan(0);

  await wall.fill("9");
  await selectOpenPath(electronApp, projectPath);
  await appPage.getByRole("button", { name: "Open project" }).click();
  await expect(wall).toHaveValue("7");
  await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });

  await selectOpenPath(electronApp, exportDir);
  await appPage.getByRole("button", { name: "Export mold" }).click();
  await expect.poll(async () => (await readdir(exportDir)).length).toBe(4);

  const lowerStep = await readFile(path.join(exportDir, "sample-mold-lower.step"), "utf8");
  const upperStep = await readFile(path.join(exportDir, "sample-mold-upper.step"), "utf8");
  expect(lowerStep).toContain("ISO-10303-21");
  expect(upperStep).toContain("ISO-10303-21");
  expect(lowerStep).toContain("MANIFOLD_SOLID_BREP");
  expect(upperStep).toContain("MANIFOLD_SOLID_BREP");
  expect((await readdir(exportDir)).sort()).toEqual([
    "sample-mold-lower.step",
    "sample-mold-lower.stl",
    "sample-mold-upper.step",
    "sample-mold-upper.stl"
  ]);
  expect((await stat(path.join(exportDir, "sample-mold-lower.stl"))).size).toBeGreaterThan(84);
  expect((await stat(path.join(exportDir, "sample-mold-upper.stl"))).size).toBeGreaterThan(84);
});
