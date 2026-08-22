import type { CadPreview, CadResponse, GeneratedFile, GenerateMoldRequest, ExportMoldRequest } from "../../shared/cad";
import type { MoldParams, SplitAxis } from "../../shared/mold";

let sequence = 0;
/** The newest request; replies for anything older are dropped. */
let latest = 0;
/** The encoded part the worker already holds, so repeat requests skip the upload. */
let uploaded: Uint8Array | null = null;
let worker: Worker | null = null;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

/**
 * Started on first use rather than at import. The CAD kernel is a ~23 MB
 * WebAssembly bundle, and loading it during start-up delays the first paint.
 */
function cadWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./cad-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<CadResponse>) => {
    // A superseded build's reply must neither settle nor clobber: only the
    // newest request's result matches what the settings asked for.
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (!request || data.id !== latest) return;
    if (!data.ok) {
      request.reject(new Error(data.error));
      return;
    }
    request.resolve("preview" in data ? data.preview : data.files);
  };
  worker.onerror = ({ message }) => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  return worker;
}

function post<T>(request: Omit<GenerateMoldRequest, "id"> | Omit<ExportMoldRequest, "id">, transfer: ArrayBuffer[]): Promise<T> {
  const id = ++sequence;
  latest = id;
  const result = new Promise<T>((resolve, reject) =>
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
  );
  cadWorker().postMessage({ ...request, id }, transfer);
  return result;
}

/**
 * Rebuilds the mold. `step` carries the encoded file for a newly opened part;
 * passing the same array again uploads nothing — the worker keeps the imported
 * part alive between settings changes and rebuilds only what they moved.
 */
export function generateMold(step: Uint8Array | null, params: MoldParams, splitAxis: SplitAxis): Promise<CadPreview> {
  const isNewPart = step !== null && step !== uploaded;
  uploaded = step;
  if (!isNewPart) return post({ kind: "generate", params, splitAxis }, []);
  const buffer = step.slice().buffer;
  const result = post<CadPreview>({ kind: "generate", params, splitAxis, step: buffer }, [buffer]);
  // A failed import leaves the worker holding the previous part, so the next
  // attempt must upload again rather than rebuild against the wrong file.
  result.catch(() => {
    if (uploaded === step) uploaded = null;
  });
  return result;
}

/** Encodes the current halves into their STEP and STL files on demand. */
export function exportMoldFiles(): Promise<GeneratedFile[]> {
  return post({ kind: "export" }, []);
}
