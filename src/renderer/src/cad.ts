import type { GenerateMoldRequest, GenerateMoldResponse, GeneratedMold } from "../../shared/cad";
import type { MoldParams, SplitAxis } from "../../shared/mold";

let sequence = 0;
let worker: Worker | null = null;
const pending = new Map<number, { resolve(result: GeneratedMold): void; reject(error: Error): void }>();

/**
 * Started on first use rather than at import. The CAD kernel is a ~23 MB
 * WebAssembly bundle, and loading it during start-up delays the first paint.
 */
function cadWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./cad-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<GenerateMoldResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.error));
  };
  worker.onerror = ({ message }) => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  return worker;
}

export function generateMold(step: Uint8Array, params: MoldParams, splitAxis: SplitAxis): Promise<GeneratedMold> {
  const id = ++sequence;
  const buffer = step.slice().buffer;
  // Register before posting so the reply can never arrive unhandled.
  const result = new Promise<GeneratedMold>((resolve, reject) => pending.set(id, { resolve, reject }));
  const request: GenerateMoldRequest = { id, step: buffer, params, splitAxis };
  cadWorker().postMessage(request, [buffer]);
  return result;
}
