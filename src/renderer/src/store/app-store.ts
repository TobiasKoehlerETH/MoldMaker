import { create } from "zustand";

interface AppState {
  importedFileName: string | null;
  status: string;
  setImportedFile(fileName: string): void;
  setStatus(status: string): void;
}

export const useAppStore = create<AppState>((set) => ({
  importedFileName: null,
  status: "Ready",
  setImportedFile: (importedFileName) => set({ importedFileName, status: "STEP loaded" }),
  setStatus: (status) => set({ status })
}));
