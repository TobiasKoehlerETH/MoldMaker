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

type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const invoke = <T>(channel: IpcChannel, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  openStepFile: () => invoke<NativeResult<OpenedFile>>(IPC_CHANNELS.openStep),
  openProjectFile: () => invoke<NativeResult<OpenedFile>>(IPC_CHANNELS.openProject),
  saveProjectFile: (request: SaveProjectRequest) =>
    invoke<NativeResult<SavedPath>>(IPC_CHANNELS.saveProject, request),
  exportFiles: (request: ExportFilesRequest) =>
    invoke<NativeResult<SavedPath>>(IPC_CHANNELS.exportFiles, request),
  getAppInfo: () => invoke<AppInfo>(IPC_CHANNELS.appInfo)
} satisfies MoldMakerApi;

contextBridge.exposeInMainWorld("moldMaker", api);
