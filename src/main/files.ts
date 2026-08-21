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

async function openFile(filters: Electron.FileFilter[]): Promise<NativeResult<OpenedFile>> {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters
    });

    if (result.canceled || result.filePaths.length === 0) return canceled();

    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    return {
      ok: true,
      value: {
        name: path.basename(filePath),
        path: filePath,
        data: new Uint8Array(data)
      }
    };
  } catch (error) {
    return failed(error);
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.openStep, () =>
    openFile([{ name: "STEP model", extensions: ["step", "stp"] }])
  );

  ipcMain.handle(IPC_CHANNELS.openProject, () =>
    openFile([{ name: "MoldMaker project", extensions: ["moldmaker"] }])
  );

  ipcMain.handle(IPC_CHANNELS.saveProject, async (_event, input): Promise<NativeResult<SavedPath>> => {
    try {
      const request = saveProjectRequestSchema.parse(input);
      const suggestedName = request.suggestedName.toLocaleLowerCase("en-US").endsWith(".moldmaker")
        ? request.suggestedName
        : `${request.suggestedName}.moldmaker`;
      const result = await dialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: "MoldMaker project", extensions: ["moldmaker"] }]
      });

      if (result.canceled || !result.filePath) return canceled();

      await fs.writeFile(result.filePath, request.data);
      return { ok: true, value: { path: result.filePath } };
    } catch (error) {
      return failed(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.exportFiles, async (_event, input): Promise<NativeResult<SavedPath>> => {
    try {
      const request = exportFilesRequestSchema.parse(input);
      const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });

      if (result.canceled || result.filePaths.length === 0) return canceled();

      const exportDirectory = result.filePaths[0];
      await Promise.all(
        request.files.map((file) => fs.writeFile(path.join(exportDirectory, file.name), file.data))
      );
      return { ok: true, value: { path: exportDirectory } };
    } catch (error) {
      return failed(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }));
}
