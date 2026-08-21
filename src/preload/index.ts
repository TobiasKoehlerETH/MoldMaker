import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AppInfo,
  type ExportFilesRequest,
  type MoldMakerApi,
  type NativeResult,
  type OpenedFile,
  type SavedPath,
  type SaveProjectRequest
} from "../shared/electron-api";

const api: MoldMakerApi = {
  openStepFile: (): Promise<NativeResult<OpenedFile>> => ipcRenderer.invoke(IPC_CHANNELS.openStep),
  openProjectFile: (): Promise<NativeResult<OpenedFile>> => ipcRenderer.invoke(IPC_CHANNELS.openProject),
  saveProjectFile: (request: SaveProjectRequest): Promise<NativeResult<SavedPath>> =>
    ipcRenderer.invoke(IPC_CHANNELS.saveProject, request),
  exportFiles: (request: ExportFilesRequest): Promise<NativeResult<SavedPath>> =>
    ipcRenderer.invoke(IPC_CHANNELS.exportFiles, request),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo)
};

contextBridge.exposeInMainWorld("moldMaker", api);
