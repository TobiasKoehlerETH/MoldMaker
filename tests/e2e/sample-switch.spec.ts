import path from "node:path";
import { expect, selectOpenPath, test } from "./fixtures";

test("switches samples while the previous mold is building", async ({ electronApp, appPage }) => {
  test.setTimeout(180_000);
  const samples = ["box-object.STEP", "cylinder-object.STEP", "bracket-object.STEP"];

  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = path.join(process.cwd(), "sample", "objects", samples[index]);
    const next = path.join(process.cwd(), "sample", "objects", samples[index + 1]);

    await selectOpenPath(electronApp, current);
    await appPage.getByRole("button", { name: "Import STEP" }).click();
    await expect(appPage.getByText(samples[index], { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(appPage.getByLabel("Building mold")).toBeVisible({ timeout: 10_000 });

    await selectOpenPath(electronApp, next);
    await appPage.getByRole("button", { name: "Import STEP" }).click();
    await expect(appPage.getByText(samples[index + 1], { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(appPage.getByRole("button", { name: "Export mold" })).toBeEnabled({ timeout: 60_000 });
  }
});
