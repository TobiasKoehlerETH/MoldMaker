import { promises as fs } from "node:fs";
import path from "node:path";
import { app, dialog, ipcMain } from "electron";
import {
  IPC_CHANNELS,
  exportFilesRequestSchema,
  saveProjectRequestSchema,
  type NativeResult,
  type OpenedFile,
  type SavedPath
} from "../shared/electron-api";

interface FileDialogState {
  lastDirectory?: string;
}

let lastDirectory: string | undefined;
let lastDirectoryLoaded = false;

function fileDialogStatePath(): string {
  return path.join(app.getPath("userData"), "file-dialog-state.json");
}

async function getLastDirectory(): Promise<string | undefined> {
  if (lastDirectoryLoaded) return lastDirectory;

  lastDirectoryLoaded = true;
  try {
    const state = JSON.parse(await fs.readFile(fileDialogStatePath(), "utf8")) as FileDialogState;
    if (typeof state.lastDirectory !== "string") return undefined;

    const directory = await fs.stat(state.lastDirectory);
    if (directory.isDirectory()) lastDirectory = state.lastDirectory;
  } catch {
    // A missing or stale preference should leave Electron to choose its normal default.
  }

  return lastDirectory;
}

async function rememberDirectory(directory: string): Promise<void> {
  lastDirectory = directory;
  lastDirectoryLoaded = true;

  try {
    await fs.writeFile(fileDialogStatePath(), JSON.stringify({ lastDirectory } satisfies FileDialogState), "utf8");
  } catch {
    // Remembering a preference must not turn a completed file operation into an error.
  }
}

function canceled<T>(): NativeResult<T> {
  return { ok: false, canceled: true };
}

function failed<T>(error: unknown): NativeResult<T> {
  return {
    ok: false,
    canceled: false,
    error: error instanceof Error ? error.message : "The file operation failed"
  };
}

async function withNativeErrorHandling<T>(
  operation: () => Promise<NativeResult<T>>
): Promise<NativeResult<T>> {
  return operation().catch((error) => failed<T>(error));
}

async function openFile(filters: Electron.FileFilter[]): Promise<NativeResult<OpenedFile>> {
  return withNativeErrorHandling(async () => {
    const defaultPath = await getLastDirectory();
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters,
      defaultPath
    });

    if (result.canceled || result.filePaths.length === 0) return canceled();

    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    await rememberDirectory(path.dirname(filePath));
    return {
      ok: true,
      value: {
        name: path.basename(filePath),
        path: filePath,
        data: new Uint8Array(data)
      }
    };
  });
}

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.openStep, () =>
    openFile([{ name: "STEP model", extensions: ["step", "stp"] }])
  );

  ipcMain.handle(IPC_CHANNELS.openProject, () =>
    openFile([{ name: "MoldMaker project", extensions: ["moldmaker"] }])
  );

  ipcMain.handle(IPC_CHANNELS.saveProject, async (_event, input): Promise<NativeResult<SavedPath>> => {
    return withNativeErrorHandling(async () => {
      const request = saveProjectRequestSchema.parse(input);
      const suggestedName = request.suggestedName.toLocaleLowerCase("en-US").endsWith(".moldmaker")
        ? request.suggestedName
        : `${request.suggestedName}.moldmaker`;
      const lastDirectoryPath = await getLastDirectory();
      const result = await dialog.showSaveDialog({
        defaultPath: lastDirectoryPath ? path.join(lastDirectoryPath, suggestedName) : suggestedName,
        filters: [{ name: "MoldMaker project", extensions: ["moldmaker"] }]
      });

      if (result.canceled || !result.filePath) return canceled();

      await fs.writeFile(result.filePath, request.data);
      await rememberDirectory(path.dirname(result.filePath));
      return { ok: true, value: { path: result.filePath } };
    });
  });

  ipcMain.handle(IPC_CHANNELS.exportFiles, async (_event, input): Promise<NativeResult<SavedPath>> => {
    return withNativeErrorHandling(async () => {
      const request = exportFilesRequestSchema.parse(input);
      const defaultPath = await getLastDirectory();
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        defaultPath
      });

      if (result.canceled || result.filePaths.length === 0) return canceled();

      const exportDirectory = result.filePaths[0];
      await Promise.all(
        request.files.map((file) => fs.writeFile(path.join(exportDirectory, file.name), file.data))
      );
      await rememberDirectory(exportDirectory);
      return { ok: true, value: { path: exportDirectory } };
    });
  });

  ipcMain.handle(IPC_CHANNELS.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }));
}
