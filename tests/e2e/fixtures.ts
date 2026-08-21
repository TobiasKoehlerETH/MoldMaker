import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "../..");

interface ElectronFixtures {
  electronApp: ElectronApplication;
  appPage: Page;
}

export const test = base.extend<ElectronFixtures>({
  // Playwright requires the fixture-dependency object even when this worker fixture has none.
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "moldmaker-e2e-"));
    const electronApp = await electron.launch({
      args: ["--disable-gpu", `--user-data-dir=${userDataDir}`, workspaceRoot],
      cwd: workspaceRoot,
      env: { ...process.env, NODE_ENV: "test" }
    });

    try {
      await use(electronApp);
    } finally {
      await electronApp.close();
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    }
  },

  appPage: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    const diagnostics: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        diagnostics.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));

    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/^v\d+\.\d+\.\d+/)).toBeVisible();
    await use(page);

    if (diagnostics.length > 0) {
      await testInfo.attach("renderer-diagnostics", {
        body: Buffer.from(diagnostics.join("\n")),
        contentType: "text/plain"
      });
    }
  }
});

export { expect };

export const paths = {
  workspaceRoot,
  sampleStep: path.join(workspaceRoot, "sample/sample.STEP")
};

export async function selectOpenPath(electronApp: ElectronApplication, selectedPath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [filePath] })
    });
  }, selectedPath);
}

export async function selectSavePath(electronApp: ElectronApplication, selectedPath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePath })
    });
  }, selectedPath);
}

export async function capture(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await testInfo.attach(name, { path: screenshotPath, contentType: "image/png" });
}
