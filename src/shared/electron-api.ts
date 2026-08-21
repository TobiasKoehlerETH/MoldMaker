import { z } from "zod";

export const IPC_CHANNELS = {
  openStep: "files:open-step",
  openProject: "files:open-project",
  saveProject: "files:save-project",
  exportFiles: "files:export",
  appInfo: "app:info"
} as const;

const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => name !== "." && name !== "..", "A file name is required")
  .refine(
    (name) => !/[<>:"/\\|?*]/.test(name) && [...name].every((character) => character.charCodeAt(0) > 31),
    "File name contains invalid characters"
  )
  .refine((name) => !/[. ]$/.test(name), "File name cannot end with a period or space");

const binarySchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  message: "Expected binary file data"
});

export const saveProjectRequestSchema = z.object({
  suggestedName: fileNameSchema,
  data: binarySchema
});

export const exportFilesRequestSchema = z
  .object({
    files: z
      .array(
        z.object({
          name: fileNameSchema,
          data: binarySchema
        })
      )
      .min(1)
      .max(8)
  })
  .superRefine(({ files }, context) => {
    const names = new Set<string>();
    for (const file of files) {
      const key = file.name.toLocaleLowerCase("en-US");
      if (names.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate export file name: ${file.name}`,
          path: ["files"]
        });
      }
      names.add(key);
    }
  });

export type SaveProjectRequest = z.infer<typeof saveProjectRequestSchema>;
export type ExportFilesRequest = z.infer<typeof exportFilesRequestSchema>;

export interface OpenedFile {
  name: string;
  path: string;
  data: Uint8Array;
}

export interface SavedPath {
  path: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";
}

export type NativeResult<T> =
  | { ok: true; value: T }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string };

export interface MoldMakerApi {
  openStepFile(): Promise<NativeResult<OpenedFile>>;
  openProjectFile(): Promise<NativeResult<OpenedFile>>;
  saveProjectFile(request: SaveProjectRequest): Promise<NativeResult<SavedPath>>;
  exportFiles(request: ExportFilesRequest): Promise<NativeResult<SavedPath>>;
  getAppInfo(): Promise<AppInfo>;
}
