import { create } from "zustand";
import { DEFAULT_PARAMS, type MoldParams } from "../../../shared/mold";
import type { PartModel } from "../../../shared/step";

/** Shown while the CAD worker rebuilds; also the marker for a status the build owns. */
export const BUILDING = "Building mold…";

interface AppState {
  fileName: string | null;
  /** Raw STEP text, kept so projects can embed their source. */
  source: string;
  part: PartModel | null;
  params: MoldParams;
  status: string;
  openPart(fileName: string, source: string, part: PartModel, params: MoldParams): void;
  setParams(patch: Partial<MoldParams>): void;
  setStatus(status: string): void;
  finishBuild(status: string): void;
}

export const useAppStore = create<AppState>((set) => ({
  fileName: null,
  source: "",
  part: null,
  params: DEFAULT_PARAMS,
  status: "Ready",
  openPart: (fileName, source, part, params) => set({ fileName, source, part, params }),
  setParams: (patch) => set((state) => ({ params: { ...state.params, ...patch }, status: BUILDING })),
  setStatus: (status) => set({ status }),
  // A build finishing must not overwrite a message a newer user action put up.
  finishBuild: (status) => set((state) => (state.status === BUILDING ? { status } : {}))
}));
