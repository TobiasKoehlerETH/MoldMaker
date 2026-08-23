import { describe, expect, it, vi } from "vitest";
import { exportFilesRequestSchema, saveProjectRequestSchema } from "../src/shared/native-api";
import { invoke } from "@tauri-apps/api/core";
import { moldMaker } from "../src/renderer/src/native-api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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

  it("wraps save requests in the Rust command argument", async () => {
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockResolvedValue({ ok: true, value: { path: "C:\\sample.moldmaker" } });

    await moldMaker.saveProjectFile({ suggestedName: "sample.moldmaker", data: new Uint8Array([1, 2, 3]) });

    expect(mockedInvoke).toHaveBeenCalledWith("save_project_file", {
      request: { suggestedName: "sample.moldmaker", data: [1, 2, 3] }
    });
  });

  it("preserves an explicit Save As request", async () => {
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockResolvedValue({ ok: true, value: { path: "C:\\copy.moldmaker" } });

    await moldMaker.saveProjectFile({ suggestedName: "copy.moldmaker", data: new Uint8Array([4]), saveAs: true });

    expect(mockedInvoke).toHaveBeenCalledWith("save_project_file", {
      request: { suggestedName: "copy.moldmaker", data: [4], saveAs: true }
    });
  });
});
