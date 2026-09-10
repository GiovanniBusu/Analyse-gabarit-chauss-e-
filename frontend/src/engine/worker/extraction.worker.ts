/// <reference lib="webworker" />
import { runExtraction, type FileInput } from "../pipeline";

interface ExtractRequest {
  requestId: number;
  axesProfils: FileInput;
  existant: FileInput;
  projet: FileInput;
  projetV1: FileInput | null;
  gabarit: string;
  dxfStepM: number | null;
  wasmBaseUrl: string;
}

self.onmessage = async (e: MessageEvent<ExtractRequest>) => {
  const { requestId, axesProfils, existant, projet, projetV1, gabarit, dxfStepM, wasmBaseUrl } = e.data;
  try {
    const result = await runExtraction(axesProfils, existant, projet, gabarit, dxfStepM, wasmBaseUrl, projetV1);
    self.postMessage({ requestId, ok: true, result });
  } catch (err) {
    self.postMessage({ requestId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
