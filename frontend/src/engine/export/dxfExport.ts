/** Port of backend/app/export/dxf_export.py, extended with a true plan-view
 * reconstruction: Existant/Projet bands are drawn as real (x, y) boundary
 * curves (the near/far edges the extractor already computed while
 * projecting onto the axis) alongside the shared reference axis, so opening
 * the DXF shows the actual road geometry rather than an abstract chart.
 * This only works for extraction methods that have boundary geometry to
 * draw from (DXF heuristic mode, IFC) — samples from DXF calque/cote mode
 * carry no near/far points (only a (pk, value) text label), so those bands
 * fall back to the previous schematic (pk, largeur) chart. Ratios/Comparatif
 * stay schematic in all cases: they're derived scalars (a ratio, a delta),
 * not something with a plan-view boundary in the first place. */

import { DxfWriter } from "../dxf/dxfWriter";
import type { Point } from "../geometry";
import type { ComparisonRow, ComparisonStatus, ElementType, Side, StateKind, Threshold, WidthSample } from "../../types/domain";

const SIDE_TAG: Record<Side, string> = { gauche: "G", droite: "D" };
const TYPE_TAG: Record<ElementType, string> = {
  non_utilise: "NON_UTILISE",
  accotement: "ACCOTEMENT",
  trottoir: "TROTTOIR",
  bau: "BAU",
  cycle: "CYCLE",
  voie: "VOIE",
  tpc: "TPC",
};
const STATE_TAG: Record<StateKind, string> = { existant: "EXISTANT", projet: "PROJET" };

const ACI_RATIO_SOUS_REDUIT = 1;
const ACI_RATIO_ENTRE = 2;
const ACI_RATIO_STANDARD = 3;
const ACI_STATUS: Record<ComparisonStatus, number> = { ameliore: 3, degrade: 1, inchange: 8 };

// Distinct color per (état, côté) combination — coloring by état alone made
// gauche and droite series render identically, so the two sides couldn't be
// told apart in a DXF viewer even though the layers are named separately.
const SERIES_COLOR: Record<StateKind, Record<Side, number>> = {
  existant: { gauche: 5, droite: 4 }, // blue / cyan
  projet: { gauche: 3, droite: 2 }, // green / yellow
};

export interface DxfExportOptions {
  includePoints: boolean;
  includePolylines: boolean;
  includeExistant: boolean;
  includeProjet: boolean;
  includeRatios: boolean;
  includeComparatif: boolean;
}

function drawSeries(writer: DxfWriter, layer: string, points: [number, number][], color: number, opts: DxfExportOptions): void {
  if (points.length === 0) return;
  if (opts.includePoints) for (const [x, y] of points) writer.addPoint(layer, x, y, color);
  if (opts.includePolylines && points.length >= 2) {
    const ordered = [...points].sort((a, b) => a[0] - b[0]);
    writer.addPolyline(layer, ordered, color);
  }
}

export function buildDxf(
  samples: WidthSample[],
  thresholds: Threshold[],
  comparisonRows: ComparisonRow[] | null,
  options: DxfExportOptions,
  axisPoints?: Point[],
): string {
  const writer = new DxfWriter();

  if (axisPoints && axisPoints.length >= 2) {
    const layer = writer.ensureLayer("AXE", 7);
    writer.addPolyline(layer, axisPoints, 7);
  }

  if (options.includeExistant || options.includeProjet) {
    const byGroup = new Map<string, WidthSample[]>();
    const meta = new Map<string, [Side, ElementType, StateKind]>();
    for (const s of samples) {
      if (s.width_m == null) continue;
      if (s.state === "existant" && !options.includeExistant) continue;
      if (s.state === "projet" && !options.includeProjet) continue;
      const key = `${s.side}|${s.element_type}|${s.state}`;
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        meta.set(key, [s.side, s.element_type, s.state]);
      }
      byGroup.get(key)!.push(s);
    }
    for (const [key, groupSamples] of byGroup.entries()) {
      const [side, elementType, state] = meta.get(key)!;
      const color = SERIES_COLOR[state][side];
      const layer = writer.ensureLayer(`${STATE_TAG[state]}_${SIDE_TAG[side]}_${TYPE_TAG[elementType]}`, color);

      const planSamples = groupSamples.filter(
        (s): s is WidthSample & { near_x: number; near_y: number; far_x: number; far_y: number } =>
          s.near_x != null && s.near_y != null && s.far_x != null && s.far_y != null,
      );
      if (planSamples.length >= 2) {
        const ordered = [...planSamples].sort((a, b) => a.pk - b.pk);
        const nearLine: [number, number][] = ordered.map((s) => [s.near_x, s.near_y]);
        const farLine: [number, number][] = ordered.map((s) => [s.far_x, s.far_y]);
        if (options.includePoints) {
          for (const [x, y] of [...nearLine, ...farLine]) writer.addPoint(layer, x, y, color);
        }
        if (options.includePolylines) {
          writer.addPolyline(layer, nearLine, color);
          writer.addPolyline(layer, farLine, color);
        }
      } else {
        // Schematic fallback (pk, largeur) — no boundary geometry available
        // for this band (DXF calque/cote mode).
        const points: [number, number][] = groupSamples.filter((s) => s.width_m != null).map((s) => [s.pk, s.width_m as number]);
        drawSeries(writer, layer, points, color, options);
      }
    }
  }

  if (options.includeRatios) {
    const thresholdByType = new Map(thresholds.map((t) => [t.element_type, t]));
    for (const s of samples) {
      if (s.width_m == null) continue;
      const threshold = thresholdByType.get(s.element_type);
      if (!threshold) continue;
      let color: number;
      if (s.width_m < threshold.reduit_m) color = ACI_RATIO_SOUS_REDUIT;
      else if (s.width_m < threshold.standard_m) color = ACI_RATIO_ENTRE;
      else color = ACI_RATIO_STANDARD;
      const layer = writer.ensureLayer(`RATIOS_${STATE_TAG[s.state]}_${SIDE_TAG[s.side]}_${TYPE_TAG[s.element_type]}`);
      if (options.includePoints) writer.addPoint(layer, s.pk, s.width_m, color);
    }
  }

  if (options.includeComparatif && comparisonRows && comparisonRows.length > 0) {
    const byGroup = new Map<string, [number, number, number][]>();
    for (const row of comparisonRows) {
      if (row.delta == null || row.status == null) continue;
      const key = `${row.side}|${row.element_type}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push([row.pk, row.delta, ACI_STATUS[row.status]]);
    }
    for (const [key, triples] of byGroup.entries()) {
      const [side, elementType] = key.split("|") as [Side, ElementType];
      const layer = writer.ensureLayer(`COMPARATIF_${SIDE_TAG[side]}_${TYPE_TAG[elementType]}`);
      if (options.includePoints) for (const [pk, delta, color] of triples) writer.addPoint(layer, pk, delta, color);
      if (options.includePolylines && triples.length >= 2) {
        const ordered = [...triples].sort((a, b) => a[0] - b[0]);
        writer.addPolyline(
          layer,
          ordered.map(([pk, delta]) => [pk, delta] as [number, number]),
          7,
        );
      }
    }
  }

  return writer.toString();
}
