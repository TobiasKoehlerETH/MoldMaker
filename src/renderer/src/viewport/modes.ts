import { DEFAULT_VIEW, type ViewState } from "../../../shared/view";

/** The three things drawn in the preview, each with its own visibility. */
export type SceneObjectId = "part" | "lower" | "upper";
export type StandardView = "front" | "side" | "top";

/** Solid by default; `ghost` is the see-through state for looking inside. */
export type Visibility = "solid" | "ghost" | "hidden";

/** Listed the way the tool stacks: top half, the part it casts, base half. */
export const OBJECT_ORDER: SceneObjectId[] = ["upper", "part", "lower"];

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

export { DEFAULT_VIEW };
export type { ViewState };
