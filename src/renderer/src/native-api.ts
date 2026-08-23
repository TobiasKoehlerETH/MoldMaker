import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  ExportFilesRequest,
  MoldMakerApi,
  NativeResult,
  OpenedFile,
  SavedPath,
  SaveProjectRequest
} from "../../../src/shared/native-api";

function normalizeOpenedFile(result: NativeResult<OpenedFile>): NativeResult<OpenedFile> {
  if (!result.ok) return result;
  return { ...result, value: { ...result.value, data: new Uint8Array(result.value.data) } };
}

function bytes(value: Uint8Array): number[] {
  return Array.from(value);
}

export const moldMaker: MoldMakerApi = {
  openStepFile: () => invoke<NativeResult<OpenedFile>>("open_step_file").then(normalizeOpenedFile),
  openProjectFile: () => invoke<NativeResult<OpenedFile>>("open_project_file").then(normalizeOpenedFile),
  saveProjectFile: (request: SaveProjectRequest) =>
    invoke<NativeResult<SavedPath>>("save_project_file", { ...request, data: bytes(request.data) }),
  exportFiles: (request: ExportFilesRequest) =>
    invoke<NativeResult<SavedPath>>("export_files", {
      files: request.files.map((file) => ({ ...file, data: bytes(file.data) }))
    }),
  getAppInfo: () => invoke<AppInfo>("app_info")
};
