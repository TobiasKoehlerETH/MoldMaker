import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { importSTEP, makeCylinder, measureShapeVolumeProperties } from "replicad";
import { buildMold, DEFAULT_PARAMS } from "../src/shared/mold";
import type { CadRequest, CadResponse } from "../src/shared/cad";
import { readStepModel } from "../src/shared/step";

vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: `${process.cwd()}/node_modules/replicad-opencascadejs/dist/replicad_single.wasm`
}));

describe("exported mold geometry", () => {
  it("drills the syringe channel through a transferred pocket core", async () => {
    const responses = new Map<number, (response: CadResponse) => void>();
    const worker = {
      onmessage: null as ((event: MessageEvent<CadRequest>) => void) | null,
      postMessage(response: CadResponse) {
        responses.get(response.id)?.(response);
      }
    };
    vi.stubGlobal("self", worker);
    try {
      await import("../src/renderer/src/cad-worker");
      const request = (data: CadRequest): Promise<CadResponse> => {
        const reply = new Promise<CadResponse>((resolve) => responses.set(data.id, resolve));
        worker.onmessage?.({ data } as MessageEvent<CadRequest>);
        return reply;
      };
      const step = readFileSync("sample/sample.STEP");
      const plan = buildMold(readStepModel(step.toString("utf8")), DEFAULT_PARAMS);
      const built = await request({
        id: 1, kind: "generate", step: step.buffer.slice(step.byteOffset, step.byteOffset + step.byteLength),
        params: DEFAULT_PARAMS, splitAxis: plan.splitAxis
      });
      expect(built.ok, !built.ok ? built.error : "").toBe(true);
      const exported = await request({ id: 2, kind: "export" });
      expect(exported.ok, !exported.ok ? exported.error : "").toBe(true);
      if (!exported.ok || !("files" in exported)) return;

      const upperFile = exported.files.find((file) => file.kind === "upper-step");
      expect(upperFile).toBeDefined();
      const upper = (await importSTEP(new Blob([upperFile!.data]))).asShape3D();
      const [min, max] = upper.boundingBox.bounds;
      // The transferred core extends well below the old cutter start.
      expect(min[2]).toBeLessThan(plan.gate[2] - 0.25);
      const probe = makeCylinder(DEFAULT_PARAMS.injectionDiameter / 2 - 0.05,
        max[2] - min[2] + 2, [plan.gate[0], plan.gate[1], min[2] - 1]);
      const obstruction = upper.intersect(probe);
      expect(obstruction.isNull ? 0 : measureShapeVolumeProperties(obstruction).volume).toBeLessThan(1e-5);
      obstruction.delete();
      probe.delete();
      upper.delete();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 120_000);
});
