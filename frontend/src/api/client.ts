import type { Band, ComparisonRow, Threshold, UploadRole, WidthSample } from "../types/domain";

// Defaults to a same-origin relative path: in production the backend serves
// this built frontend itself (single Render service, no CORS needed). Local
// dev with two separate servers (`npm run dev` + `uvicorn`) overrides this
// via .env (see .env.example).
const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export interface ExtractResult {
  axis_confidence: string;
  existant_mode: string;
  projet_mode: string;
  bands: Band[];
  samples: WidthSample[];
}

export async function extract(
  files: Record<UploadRole, File>,
  gabarit: string,
  dxfStepM: number,
): Promise<ExtractResult> {
  const form = new FormData();
  form.append("axes_profils", files.axes_profils);
  form.append("existant", files.existant);
  form.append("projet", files.projet);
  form.append("gabarit", gabarit);
  form.append("dxf_step_m", String(dxfStepM));
  return req<ExtractResult>("/extract", { method: "POST", body: form });
}

export function exportExcel(
  samples: WidthSample[],
  thresholds: Threshold[],
  deltaSeuilM: number,
  comparison: ComparisonRow[],
): Promise<Blob> {
  return fetch(`${BASE}/export/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples, thresholds, delta_seuil_m: deltaSeuilM, comparison }),
  }).then(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  });
}

export interface DxfExportOptions {
  include_points: boolean;
  include_polylines: boolean;
  include_existant: boolean;
  include_projet: boolean;
  include_ratios: boolean;
  include_comparatif: boolean;
}

export async function exportDxf(
  samples: WidthSample[],
  thresholds: Threshold[],
  deltaSeuilM: number,
  comparison: ComparisonRow[],
  options: DxfExportOptions,
): Promise<Blob> {
  const res = await fetch(`${BASE}/export/dxf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples, thresholds, delta_seuil_m: deltaSeuilM, comparison, ...options }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}
