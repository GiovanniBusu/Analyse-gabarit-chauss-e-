/** Port of backend/app/extraction/dxf_extractor.py. */

import type { AxisReference } from "../axisReference";
import { PolylineIndex, orderLinesByOffset, perpendicularDirection, type Point } from "../geometry";
import type { Band, ElementType, Side, SourceMethod, StateKind, WidthSample } from "../../types/domain";
import { parseDxf } from "./dxfReader";
import { findLegacyPolylines, namedAxisAndCoteLayers, numericValue } from "./dxfCommon";
import { maxOf, minOf } from "../arrayUtils";

const ROUTE_TEMPLATE_HALF: ElementType[] = ["accotement", "trottoir", "cycle", "voie"];
const AUTOROUTE_TEMPLATE_HALF: ElementType[] = ["accotement", "bau", "voie", "voie"];

const GABARIT_TEMPLATES: Record<string, { half: ElementType[]; center: ElementType | null }> = {
  route: { half: ROUTE_TEMPLATE_HALF, center: null },
  autoroute: { half: AUTOROUTE_TEMPLATE_HALF, center: "tpc" },
};

const ELEMENT_TOKENS: [RegExp, ElementType][] = [
  [/BAU/i, "bau"],
  [/ACCOT/i, "accotement"],
  [/TR.{0,4}OIR/i, "trottoir"],
  [/CYCL/i, "cycle"],
  [/VOIE|CHAUSS/i, "voie"],
  [/TPC/i, "tpc"],
];

function defaultBandLabels(nBands: number, gabarit: string): [Side, ElementType][] {
  const template = GABARIT_TEMPLATES[gabarit] ?? GABARIT_TEMPLATES.route;
  const { half, center } = template;
  const expectedNoCenter = 2 * half.length;

  if (center !== null && nBands === expectedNoCenter + 1) {
    const left: [Side, ElementType][] = half.map((t) => ["gauche", t]);
    const right: [Side, ElementType][] = [...half].reverse().map((t) => ["droite", t]);
    return [...left, ["gauche", center], ...right];
  }
  if (nBands === expectedNoCenter) {
    const left: [Side, ElementType][] = half.map((t) => ["gauche", t]);
    const right: [Side, ElementType][] = [...half].reverse().map((t) => ["droite", t]);
    return [...left, ...right];
  }
  const mid = Math.floor(nBands / 2);
  const labels: [Side, ElementType][] = [];
  for (let i = 0; i < mid; i++) labels.push(["gauche", "non_utilise"]);
  for (let i = mid; i < nBands; i++) labels.push(["droite", "non_utilise"]);
  return labels;
}

function frange(start: number, stop: number, step: number): number[] {
  const n = Math.floor((stop - start) / step + 1e-9) + 1;
  return Array.from({ length: n }, (_, i) => start + i * step);
}

export function detectDxfMode(content: string): "layers" | "heuristic" {
  const doc = parseDxf(content);
  return namedAxisAndCoteLayers(doc) !== null ? "layers" : "heuristic";
}

export function extractDxfState(
  content: string,
  state: StateKind,
  axis: AxisReference,
  gabarit = "route",
  stepM = 5.0,
): { bands: Band[]; samples: WidthSample[]; mode: "layers" | "heuristic" } {
  const doc = parseDxf(content);
  const mode = namedAxisAndCoteLayers(doc) !== null ? "layers" : "heuristic";

  if (mode === "layers") {
    const { bands, samples } = extractLayerBased(doc, state, axis);
    return { bands, samples, mode };
  }
  const { bands, samples } = extractHeuristic(doc, state, axis, gabarit, stepM);
  return { bands, samples, mode };
}

function extractHeuristic(
  doc: ReturnType<typeof parseDxf>,
  state: StateKind,
  axis: AxisReference,
  gabarit: string,
  stepM: number,
): { bands: Band[]; samples: WidthSample[] } {
  const lines = findLegacyPolylines(doc);
  if (lines.length < 2) {
    throw new Error(
      "L'extraction heuristique DXF nécessite au moins 2 lignes POLYLINE anciennes génération (les LWPOLYLINE fragmentées sont ignorées volontairement)",
    );
  }
  const order = orderLinesByOffset(axis.axis, lines);
  const orderedLines = order.map((i) => new PolylineIndex(lines[i]));
  const nBands = orderedLines.length - 1;
  const defaultLabels = defaultBandLabels(nBands, gabarit);
  const stations = frange(0, axis.axis.length, stepM);

  const bands: Band[] = [];
  const samples: WidthSample[] = [];
  for (let bandIdx = 0; bandIdx < nBands; bandIdx++) {
    const bandKey = `dxf-${state}-band${bandIdx}`;
    const [side, elementType] = defaultLabels[bandIdx];
    const source: SourceMethod = "recuperation_dxf";
    const confidence = 0.4;

    const widths: number[] = [];
    for (const s of stations) {
      const { point, direction } = axis.axis.pointAndDirectionAtStation(s);
      const perp = perpendicularDirection(direction);
      const p1 = orderedLines[bandIdx].intersectRay(point, perp);
      const p2 = orderedLines[bandIdx + 1].intersectRay(point, perp);
      if (!p1 || !p2) continue;
      const width = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const pk = axis.stationToPk(s);
      widths.push(width);
      samples.push({ pk, side, element_type: elementType, state, width_m: width, source, band_id: bandKey });
    }

    bands.push({
      band_id: bandKey,
      state,
      side,
      element_type: elementType,
      source,
      confidence,
      label_hint: `bande géométrique #${bandIdx}`,
      sample_count: widths.length,
      width_min: widths.length ? minOf(widths) : null,
      width_max: widths.length ? maxOf(widths) : null,
      width_mean: widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null,
    });
  }
  return { bands, samples };
}

function parseLayerTokens(name: string): [Side, ElementType] {
  const side: Side = /(?:^|[-_])D(?:$|[-_])|DROITE|S2/i.test(name) ? "droite" : "gauche";
  let elementType: ElementType = "non_utilise";
  for (const [pattern, et] of ELEMENT_TOKENS) {
    if (pattern.test(name)) {
      elementType = et;
      break;
    }
  }
  return [side, elementType];
}

function extractLayerBased(
  doc: ReturnType<typeof parseDxf>,
  state: StateKind,
  axis: AxisReference,
): { bands: Band[]; samples: WidthSample[] } {
  const layers = namedAxisAndCoteLayers(doc);
  const coteLayers = new Set(layers?.cote ?? []);
  const byLayer = new Map<string, typeof doc.texts>();
  for (const t of doc.texts) {
    if (coteLayers.has(t.layer)) {
      if (!byLayer.has(t.layer)) byLayer.set(t.layer, []);
      byLayer.get(t.layer)!.push(t);
    }
  }

  const bands: Band[] = [];
  const samples: WidthSample[] = [];
  for (const [layerName, layerTexts] of byLayer.entries()) {
    const [side, elementType] = parseLayerTokens(layerName);
    const bandKey = `dxf-${state}-${layerName}`;
    const source: SourceMethod = "recuperation_entrees";
    const confidence = elementType !== "non_utilise" ? 1.0 : 0.2;

    const widths: number[] = [];
    for (const t of layerTexts) {
      const value = numericValue(t);
      if (value === null) continue;
      const [pk] = axis.project([t.x, t.y] as Point);
      widths.push(value);
      samples.push({ pk, side, element_type: elementType, state, width_m: value, source, band_id: bandKey });
    }

    bands.push({
      band_id: bandKey,
      state,
      side,
      element_type: elementType,
      source,
      confidence,
      label_hint: layerName,
      sample_count: widths.length,
      width_min: widths.length ? minOf(widths) : null,
      width_max: widths.length ? maxOf(widths) : null,
      width_mean: widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null,
    });
  }
  return { bands, samples };
}
