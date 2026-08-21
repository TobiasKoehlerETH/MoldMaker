/** The three things drawn in the preview, each with its own visibility. */
export type SceneObjectId = "part" | "lower" | "upper";

export type Visibility = "solid" | "ghost" | "hidden";

export const OBJECT_ORDER: SceneObjectId[] = ["part", "lower", "upper"];

export const OBJECT_LABELS: Record<SceneObjectId, string> = {
  part: "Cast part",
  lower: "Base half",
  upper: "Top half"
};

/** Material opacity per visibility; `hidden` objects are left out of the scene. */
export const OPACITY: Record<Visibility, number> = { solid: 1, ghost: 0.2, hidden: 0 };

export const VISIBILITY_ORDER: Visibility[] = ["solid", "ghost", "hidden"];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  solid: "Solid",
  ghost: "Transparent",
  hidden: "Hidden"
};

/** A body picked in the viewport, with where to anchor its menu. */
export interface BodySelection {
  id: SceneObjectId;
  /** Click position in canvas pixels. */
  x: number;
  y: number;
}

/** The sidebar rows step an object through these in order. */
export const NEXT_VISIBILITY: Record<Visibility, Visibility> = {
  solid: "ghost",
  ghost: "hidden",
  hidden: "solid"
};

export type ShadingMode = "solid" | "transparent" | "ghost-upper" | "ghost-lower";

interface ShadingPreset {
  label: string;
  objects: Record<SceneObjectId, Visibility>;
}

/** Presets set every object at once; clicking a single object refines from there. */
export const SHADING_MODES: Record<ShadingMode, ShadingPreset> = {
  solid: { label: "Solid mold", objects: { part: "solid", lower: "solid", upper: "solid" } },
  transparent: { label: "Transparent mold", objects: { part: "solid", lower: "ghost", upper: "ghost" } },
  "ghost-upper": { label: "Ghost top half", objects: { part: "solid", lower: "solid", upper: "ghost" } },
  "ghost-lower": { label: "Ghost base half", objects: { part: "solid", lower: "ghost", upper: "solid" } }
};

export const MODE_ORDER = Object.keys(SHADING_MODES) as ShadingMode[];

export interface ViewState {
  objects: Record<SceneObjectId, Visibility>;
  /** Separation of the halves, as a fraction of the mold height. */
  explode: number;
  showEdges: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  objects: { ...SHADING_MODES.transparent.objects },
  explode: 0,
  showEdges: true
};

/** True when the current visibilities match a preset exactly, so it can be shown as active. */
export const matchesMode = (view: ViewState, mode: ShadingMode): boolean =>
  OBJECT_ORDER.every((id) => view.objects[id] === SHADING_MODES[mode].objects[id]);
