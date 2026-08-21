import { describe, expect, it } from "vitest";
import { exportFilesRequestSchema, saveProjectRequestSchema } from "../src/shared/electron-api";

describe("native file contracts", () => {
  it("accepts a project payload", () => {
    const result = saveProjectRequestSchema.safeParse({
      suggestedName: "sample.moldmaker",
      data: new Uint8Array([1, 2, 3])
    });

    expect(result.success).toBe(true);
  });

  it("rejects traversal and duplicate export names", () => {
    const traversal = exportFilesRequestSchema.safeParse({
      files: [{ name: "../outside.step", data: new Uint8Array() }]
    });
    const duplicate = exportFilesRequestSchema.safeParse({
      files: [
        { name: "half-a.step", data: new Uint8Array() },
        { name: "HALF-A.step", data: new Uint8Array() }
      ]
    });

    expect(traversal.success).toBe(false);
    expect(duplicate.success).toBe(false);
  });
});
