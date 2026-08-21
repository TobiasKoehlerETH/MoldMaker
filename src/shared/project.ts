import { z } from "zod";
import { moldParamsSchema } from "./mold";

/** A `.moldmaker` project embeds its STEP source so it reopens without the original file. */
export const projectSchema = z.object({
  version: z.literal(1),
  sourceName: z.string().min(1),
  step: z.string().min(1),
  params: moldParamsSchema
});

export type Project = z.infer<typeof projectSchema>;

export function encodeProject(project: Project): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(project, null, 2));
}

export function decodeProject(data: Uint8Array): Project {
  return projectSchema.parse(JSON.parse(new TextDecoder().decode(data)));
}

/** Strips the extension and any character the native file-name contract rejects. */
export function baseName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[<>:"/|?*]/g, "-").trim();
  return stem.replace(/[. ]+$/, "") || "mold";
}
