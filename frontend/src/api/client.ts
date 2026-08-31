import type { Band, ComparisonRow, RatioResult, Side, Threshold, UploadRole } from "../types/domain";
import type { ElementType } from "../types/domain";

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

export async function createProject(): Promise<string> {
  const data = await req<{ project_id: string }>("/projects", { method: "POST" });
  return data.project_id;
}

export async function uploadFile(projectId: string, role: UploadRole, file: File) {
  const form = new FormData();
  form.append("file", file);
  return req(`/projects/${projectId}/files/${role}`, { method: "POST", body: form });
}

export async function extract(projectId: string, gabarit: string, dxfStepM: number) {
  return req<{ axis_confidence: string; existant_mode: string | null; projet_mode: string | null; bands: Band[] }>(
    `/projects/${projectId}/extract`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gabarit, dxf_step_m: dxfStepM }),
    },
  );
}

export async function getBands(projectId: string): Promise<Band[]> {
  return req(`/projects/${projectId}/bands`);
}

export async function overrideBand(
  projectId: string,
  bandId: string,
  side: Side,
  elementType: ElementType,
): Promise<Band[]> {
  return req(`/projects/${projectId}/bands/${bandId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side, element_type: elementType }),
  });
}

export async function getThresholds(projectId: string): Promise<{ thresholds: Threshold[]; delta_seuil_m: number }> {
  return req(`/projects/${projectId}/thresholds`);
}

export async function updateThresholds(projectId: string, thresholds: Threshold[], deltaSeuilM: number) {
  return req(`/projects/${projectId}/thresholds`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thresholds, delta_seuil_m: deltaSeuilM }),
  });
}

export async function getResults(projectId: string): Promise<{ ratios: RatioResult[] }> {
  return req(`/projects/${projectId}/results`);
}

export async function getComparison(projectId: string): Promise<{ rows: ComparisonRow[] }> {
  return req(`/projects/${projectId}/comparison`);
}

export function exportExcelUrl(projectId: string): string {
  return `${BASE}/projects/${projectId}/export/excel`;
}

export interface DxfExportOptions {
  include_points: boolean;
  include_polylines: boolean;
  include_existant: boolean;
  include_projet: boolean;
  include_ratios: boolean;
  include_comparatif: boolean;
}

export async function exportDxf(projectId: string, options: DxfExportOptions): Promise<Blob> {
  const res = await fetch(`${BASE}/projects/${projectId}/export/dxf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}
