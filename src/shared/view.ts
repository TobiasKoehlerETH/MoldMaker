import { z } from "zod";

export const sceneObjectIdSchema = z.enum(["part", "lower", "upper"]);
export const visibilitySchema = z.enum(["solid", "ghost", "hidden"]);
export const standardViewSchema = z.enum(["front", "side", "top"]);

/** Settings that control how a project is presented in the viewport. */
export const viewStateSchema = z.object({
  objects: z.object({
    part: visibilitySchema,
    lower: visibilitySchema,
    upper: visibilitySchema
  }),
  explode: z.number().min(0).max(1),
  section: z.boolean(),
  sectionPosition: z.number().min(0).max(1),
  standardView: standardViewSchema.nullable()
});

export type ViewState = z.infer<typeof viewStateSchema>;

export const DEFAULT_VIEW: ViewState = {
  objects: { part: "solid", lower: "solid", upper: "solid" },
  explode: 1,
  section: false,
  sectionPosition: 0.5,
  standardView: null
};
