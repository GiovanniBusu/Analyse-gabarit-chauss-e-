/** Client-side equivalent of backend/app/api/pipeline.py: detects each
 * file's format by extension and runs the matching extractor, all three
 * files sharing one AxisReference. Runs inside the Web Worker (see
 * worker/extraction.worker.ts) so parsing never blocks the UI thread. */

import type { AxisReference } from "./axisReference";
import { buildAxisReferenceFromDxfContent } from "./dxf/axisReferenceDxf";
import { extractDxfState } from "./dxf/dxfExtractor";
import { buildAxisReferenceFromIfcModel } from "./ifc/axisReferenceIfc";
import { extractIfcState } from "./ifc/ifcExtractor";
import { getIfcApi, openModel } from "./ifc/webIfcClient";
import type { Point } from "./geometry";
import type { Band, StateKind, WidthSample } from "../types/domain";
import { getLog, resetLog, setLogContext, type LogEntry } from "./log";

export type SourceFormat = "dxf" | "ifc";

export function detectFormat(filename: string): SourceFormat {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "dxf") return "dxf";
  if (ext === "ifc") return "ifc";
  throw new Error(`Format de fichier non supporté : .${ext} (attendu .dxf ou .ifc)`);
}

export interface FileInput {
  filename: string;
  format: SourceFormat;
  text?: string; // DXF: decoded text content
  bytes?: Uint8Array; // IFC: raw bytes
}

export interface ExtractionResult {
  axisConfidence: string;
  existantMode: string;
  projetMode: string;
  bands: Band[];
  samples: WidthSample[];
  /** The shared reference axis, in true plan (x, y) — drawn as its own
   * layer in the DXF export so the plan-view reconstruction has a spatial
   * reference, the same way it does in the source DXF/IFC files. */
  axisPoints: Point[];
  /** Notices raised while parsing the three files about anything that had
   * to be guessed or was missing outright (no real PK markers, a fallback
   * axis method, geometry excluded as decorative, an unmeasurable profile,
   * …) — see log.ts. */
  log: LogEntry[];
}

export async function runExtraction(
  axesProfils: FileInput,
  existant: FileInput,
  projet: FileInput,
  gabarit: string,
  dxfStepM: number | null,
  wasmBaseUrl: string,
): Promise<ExtractionResult> {
  resetLog();
  const needsIfc = [axesProfils, existant, projet].some((f) => f.format === "ifc");
  const api = needsIfc ? await getIfcApi(wasmBaseUrl) : null;
  const openedModelIds: number[] = [];

  let axis: AxisReference;
  setLogContext(`Axe / profils (${axesProfils.filename})`);
  if (axesProfils.format === "dxf") {
    axis = buildAxisReferenceFromDxfContent(axesProfils.text as string);
  } else {
    const modelId = openModel(api!, axesProfils.bytes as Uint8Array);
    openedModelIds.push(modelId);
    axis = buildAxisReferenceFromIfcModel(api!, modelId);
  }

  function extractOne(file: FileInput, state: StateKind): { bands: Band[]; samples: WidthSample[]; mode: string } {
    if (file.format === "dxf") {
      const { bands, samples, mode } = extractDxfState(file.text as string, state, axis, gabarit, dxfStepM);
      return { bands, samples, mode };
    }
    const modelId = openModel(api!, file.bytes as Uint8Array);
    openedModelIds.push(modelId);
    const { bands, samples } = extractIfcState(api!, modelId, state, axis);
    return { bands, samples, mode: "ifc" };
  }

  setLogContext(`Existant (${existant.filename})`);
  const existantResult = extractOne(existant, "existant");
  setLogContext(`Projet (${projet.filename})`);
  const projetResult = extractOne(projet, "projet");

  for (const id of openedModelIds) {
    try {
      api!.CloseModel(id);
    } catch {
      // best-effort cleanup
    }
  }

  return {
    axisConfidence: axis.confidence,
    existantMode: existantResult.mode,
    projetMode: projetResult.mode,
    bands: [...existantResult.bands, ...projetResult.bands],
    samples: [...existantResult.samples, ...projetResult.samples],
    axisPoints: axis.axis.points,
    log: getLog(),
  };
}
