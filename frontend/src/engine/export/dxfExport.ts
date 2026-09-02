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

/** Splits an ordered point sequence wherever consecutive points are
 * disproportionately farther apart than the rest (more than 8x the median
 * gap) — a real gap in coverage (no data over a stretch) or a single
 * misclassified outlier sample both show up this way, and connecting
 * across either with a straight line reads as a spurious streak cutting
 * across the whole drawing rather than the actual boundary. Threshold
 * scales with the data's own spacing instead of a fixed distance so it
 * works whether points come from a dense IFC sampling or a coarse DXF step. */
function splitPolylineByGap(points: readonly Point[]): Point[][] {
  if (points.length < 3) return [points as Point[]];
  const gaps = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(median * 8, 1e-6);

  const runs: Point[][] = [];
  let current: Point[] = [points[0]];
  gaps.forEach((gap, i) => {
    if (gap > threshold) {
      runs.push(current);
      current = [];
    }
    current.push(points[i + 1]);
  });
  runs.push(current);
  return runs;
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
    for (const run of splitPolylineByGap(axisPoints)) writer.addPolyline(layer, run, 7);
  }

  if (options.includeExistant || options.includeProjet) {
    const byGroup = new Map<string, WidthSample[]>();
    const meta = new Map<string, [Side, ElementType, StateKind]>();
    for (const s of samples) {
      if (s.width_m == null) continue;
      if (s.element_type === "non_utilise") continue;
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
          for (const run of splitPolylineByGap(nearLine)) writer.addPolyline(layer, run, color);
          for (const run of splitPolylineByGap(farLine)) writer.addPolyline(layer, run, color);
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
    // Drawn as colored lines at the band's true plan position (the near/far
    // midpoint), not a (pk, largeur) scatter — matches how the reference
    // drawings the user is matching against show compliance directly on the
    // plan, not as a separate abstract chart.
    const thresholdByType = new Map(thresholds.map((t) => [t.element_type, t]));
    const classify = (width: number, threshold: Threshold): number =>
      width < threshold.reduit_m ? ACI_RATIO_SOUS_REDUIT : width < threshold.standard_m ? ACI_RATIO_ENTRE : ACI_RATIO_STANDARD;

    const byGroup = new Map<string, WidthSample[]>();
    for (const s of samples) {
      if (s.width_m == null) continue;
      if (s.element_type === "non_utilise") continue;
      if (!thresholdByType.has(s.element_type)) continue;
      const key = `${s.side}|${s.element_type}|${s.state}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(s);
    }
    for (const [key, groupSamples] of byGroup.entries()) {
      const [side, elementType, state] = key.split("|") as [Side, ElementType, StateKind];
      const threshold = thresholdByType.get(elementType)!;
      const layer = writer.ensureLayer(`RATIOS_${STATE_TAG[state]}_${SIDE_TAG[side]}_${TYPE_TAG[elementType]}`);

      const planSamples = groupSamples.filter(
        (s): s is WidthSample & { near_x: number; near_y: number; far_x: number; far_y: number; width_m: number } =>
          s.near_x != null && s.near_y != null && s.far_x != null && s.far_y != null && s.width_m != null,
      );
      if (planSamples.length >= 2) {
        const ordered = [...planSamples].sort((a, b) => a.pk - b.pk);
        const centerline = ordered.map((s) => ({
          point: [(s.near_x + s.far_x) / 2, (s.near_y + s.far_y) / 2] as [number, number],
          color: classify(s.width_m, threshold),
        }));
        if (options.includePoints) {
          for (const c of centerline) writer.addPoint(layer, c.point[0], c.point[1], c.color);
        }
        if (options.includePolylines) {
          const gaps = centerline.slice(1).map((c, i) => Math.hypot(c.point[0] - centerline[i].point[0], c.point[1] - centerline[i].point[1]));
          const sortedGaps = [...gaps].sort((a, b) => a - b);
          const median = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 0;
          const gapThreshold = Math.max(median * 8, 1e-6);
          // Each segment is its own polyline so it can carry its own
          // classification color — a DXF polyline is single-color, and the
          // classification can change from one sample to the next.
          for (let i = 0; i < centerline.length - 1; i++) {
            if (gaps[i] > gapThreshold) continue;
            writer.addPolyline(layer, [centerline[i].point, centerline[i + 1].point], centerline[i].color);
          }
        }
      } else if (options.includePoints) {
        // Schematic fallback (pk, largeur) — no boundary geometry available
        // for this band (DXF calque/cote mode).
        for (const s of groupSamples) {
          if (s.width_m != null) writer.addPoint(layer, s.pk, s.width_m, classify(s.width_m, threshold));
        }
      }
    }
  }

  if (options.includeComparatif && comparisonRows && comparisonRows.length > 0) {
    const byGroup = new Map<string, [number, number, number][]>();
    for (const row of comparisonRows) {
      if (row.delta == null || row.status == null) continue;
      if (row.element_type === "non_utilise") continue;
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
