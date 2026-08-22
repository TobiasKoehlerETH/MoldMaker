import { capture, expect, paths, selectOpenPath, test } from "./fixtures";

test("toggles the contextual sidebar from the selected rail icon", async ({ electronApp, appPage }, testInfo) => {
  await expect(appPage.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
  await expect(appPage.getByRole("button", { name: "Open sidebar" })).toHaveCount(0);

  await selectOpenPath(electronApp, paths.sampleStep);
  await appPage.getByRole("button", { name: "Import STEP" }).click();
  await expect(appPage.getByText("sample.STEP", { exact: true })).toBeVisible();
  await expect(appPage.getByRole("complementary", { name: "Settings" })).toBeVisible();
  await expect(appPage.getByText("Objects", { exact: true })).toBeVisible();
  await expect(appPage.getByText("Explode", { exact: true })).toBeVisible();

  const panel = appPage.locator('[role="complementary"][aria-label="Settings"]');
  const settings = appPage.getByRole("button", { name: "Settings", exact: true });

  await settings.click();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await capture(appPage, "sidebar-closed", testInfo);

  await settings.click();
  await expect(panel).toBeVisible();
  await capture(appPage, "sidebar-open", testInfo);
});
