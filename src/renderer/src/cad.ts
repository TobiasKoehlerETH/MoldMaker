import type { CadPreview, CadResponse, GeneratedFile, GenerateMoldRequest, ExportMoldRequest } from "../../shared/cad";
import type { MoldParams, SplitAxis } from "../../shared/mold";

let sequence = 0;
/** The newest request; replies for anything older are dropped. */
let latest = 0;
/** The encoded part the worker already holds, so repeat requests skip the upload. */
let uploaded: Uint8Array | null = null;
let worker: Worker | null = null;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function rejectPending(error: Error): void {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function resetWorker(error: Error): void {
  const current = worker;
  worker = null;
  uploaded = null;
  if (current) {
    current.onmessage = null;
    current.onerror = null;
    current.onmessageerror = null;
    current.terminate();
  }
  rejectPending(error);
}

/**
 * Started on first use rather than at import. The CAD kernel is a ~23 MB
 * WebAssembly bundle, and loading it during start-up delays the first paint.
 */
function cadWorker(): Worker {
  if (worker) return worker;

  const current = new Worker(new URL("./cad-worker.ts", import.meta.url), { type: "module" });
  worker = current;
  current.onmessage = ({ data }: MessageEvent<CadResponse>) => {
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
  current.onerror = ({ message }) => {
    if (worker !== current) return;
    resetWorker(new Error(message || "The CAD worker stopped unexpectedly"));
  };
  current.onmessageerror = () => {
    if (worker !== current) return;
    resetWorker(new Error("The CAD worker returned an unreadable response"));
  };
  return current;
}

function post<T>(request: Omit<GenerateMoldRequest, "id"> | Omit<ExportMoldRequest, "id">, transfer: ArrayBuffer[]): Promise<T> {
  const id = ++sequence;
  latest = id;
  const result = new Promise<T>((resolve, reject) =>
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
  );
  try {
    cadWorker().postMessage({ ...request, id }, transfer);
  } catch (error) {
    const requestState = pending.get(id);
    pending.delete(id);
    requestState?.reject(error instanceof Error ? error : new Error("The CAD worker could not start"));
  }
  return result;
}

/**
 * Rebuilds the mold. `step` carries the encoded file for a newly opened part;
 * passing the same array again uploads nothing — the worker keeps the imported
 * part alive between settings changes and rebuilds only what they moved.
 */
export function generateMold(step: Uint8Array | null, params: MoldParams, splitAxis: SplitAxis): Promise<CadPreview> {
  const isNewPart = step !== null && step !== uploaded;
  // A running OpenCascade boolean is synchronous and cannot be interrupted.
  // Restarting only for a new sample lets the user abandon a stale build;
  // parameter edits still reuse the warm worker and its imported geometry.
  if (isNewPart && pending.size > 0) {
    resetWorker(new Error("Mold build superseded by a new sample"));
  }
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
