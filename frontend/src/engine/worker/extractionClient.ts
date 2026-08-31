/** Main-thread side of the extraction worker: spawns it lazily, and turns
 * postMessage round trips into promises. Parsing (DXF text processing, and
 * especially IFC/web-ifc WASM geometry work) runs off the main thread so a
 * large real file never freezes the UI. */

import type { FileInput, ExtractionResult } from "../pipeline";

let worker: Worker | null = null;
let counter = 0;
const pending = new Map<number, { resolve: (r: ExtractionResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./extraction.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const { requestId, ok, result, error } = e.data;
      const p = pending.get(requestId);
      if (!p) return;
      pending.delete(requestId);
      if (ok) p.resolve(result as ExtractionResult);
      else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const [, p] of pending) p.reject(new Error(e.message));
      pending.clear();
    };
  }
  return worker;
}

export function extractInWorker(
  axesProfils: FileInput,
  existant: FileInput,
  projet: FileInput,
  gabarit: string,
  dxfStepM: number,
): Promise<ExtractionResult> {
  const w = getWorker();
  const requestId = ++counter;
  const wasmBaseUrl = new URL("wasm/", document.baseURI).href;
  const transfer: Transferable[] = [];
  for (const f of [axesProfils, existant, projet]) {
    if (f.bytes) transfer.push(f.bytes.buffer);
  }
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    w.postMessage({ requestId, axesProfils, existant, projet, gabarit, dxfStepM, wasmBaseUrl }, transfer);
  });
}

export async function fileToInput(file: File): Promise<FileInput> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "dxf") {
    return { filename: file.name, format: "dxf", text: await file.text() };
  }
  if (ext === "ifc") {
    return { filename: file.name, format: "ifc", bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  throw new Error(`Format de fichier non supporté : .${ext} (attendu .dxf ou .ifc)`);
}
