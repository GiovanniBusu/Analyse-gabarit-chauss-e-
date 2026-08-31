/** Port of backend/app/extraction/dxf_common.py: text classification helpers
 * and legacy-POLYLINE discovery built on top of the raw dxfReader parse. */

import type { DxfDocument, DxfTextEntity } from "./dxfReader";
import type { Point } from "../geometry";

const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;
const CHAINAGE_RE = /^\d{1,4}[+.]\d{3}$/;

export function numericValue(text: DxfTextEntity): number | null {
  const t = text.content.trim().replace(",", ".");
  if (NUMERIC_RE.test(t)) return parseFloat(t);
  if (CHAINAGE_RE.test(t)) {
    const sep = t.includes("+") ? "+" : ".";
    const [main, sub] = t.split(sep);
    return parseFloat(main) * 1000 + parseFloat(sub);
  }
  return null;
}

export function isPureInt(text: DxfTextEntity): boolean {
  const t = text.content.trim();
  return /^-?\d+$/.test(t);
}

export function clusterTexts(texts: DxfTextEntity[]): Map<string, DxfTextEntity[]> {
  const clusters = new Map<string, DxfTextEntity[]>();
  for (const t of texts) {
    const key = `${t.layer}|${t.color}|${Math.round(t.height * 10) / 10}|${t.style}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(t);
  }
  return clusters;
}

export function findLegacyPolylines(doc: DxfDocument): Point[][] {
  return doc.polylines.filter((p) => p.kind === "POLYLINE").map((p) => p.points);
}

export function namedAxisAndCoteLayers(doc: DxfDocument): { axis: string[]; cote: string[] } | null {
  const axisLayers = doc.layerNames.filter((n) => /\bAXE\b/i.test(n));
  const coteLayers = doc.layerNames.filter((n) => /\bCOTE\b/i.test(n));
  if (axisLayers.length > 0 && coteLayers.length > 0) return { axis: axisLayers, cote: coteLayers };
  return null;
}
