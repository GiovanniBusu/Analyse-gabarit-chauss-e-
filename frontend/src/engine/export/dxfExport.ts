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
import { ACI, ACI_STATUS, SERIES_COLOR } from "./colorScheme";

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
const STATE_LABEL: Record<StateKind, string> = { existant: "Existant", projet: "Projet" };
const SIDE_LABEL: Record<Side, string> = { gauche: "Gauche", droite: "Droite" };

const ACI_RATIO_SOUS_REDUIT = ACI.RATIO_SOUS_REDUIT;
const ACI_RATIO_ENTRE = ACI.RATIO_ENTRE;
const ACI_RATIO_STANDARD = ACI.RATIO_STANDARD;

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
    // Drawn at the row's true plan position, colored amélioré/inchangé/
    // dégradé, exactly like the Ratios layer above — a row's pk always
    // matches one original sample's own pk (see compareStates), so its
    // near/far is a real plan position, not a new interpolation.
    const byGroup = new Map<string, ComparisonRow[]>();
    for (const row of comparisonRows) {
      if (row.delta == null || row.status == null) continue;
      if (row.element_type === "non_utilise") continue;
      const key = `${row.side}|${row.element_type}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(row);
    }
    for (const [key, groupRows] of byGroup.entries()) {
      const [side, elementType] = key.split("|") as [Side, ElementType];
      const layer = writer.ensureLayer(`COMPARATIF_${SIDE_TAG[side]}_${TYPE_TAG[elementType]}`);

      const planRows = groupRows.filter(
        (r): r is ComparisonRow & { near_x: number; near_y: number; far_x: number; far_y: number; status: ComparisonStatus } =>
          r.near_x != null && r.near_y != null && r.far_x != null && r.far_y != null && r.status != null,
      );
      if (planRows.length >= 2) {
        const ordered = [...planRows].sort((a, b) => a.pk - b.pk);
        const centerline = ordered.map((r) => ({
          point: [(r.near_x + r.far_x) / 2, (r.near_y + r.far_y) / 2] as [number, number],
          color: ACI_STATUS[r.status],
        }));
        if (options.includePoints) {
          for (const c of centerline) writer.addPoint(layer, c.point[0], c.point[1], c.color);
        }
        if (options.includePolylines) {
          const gaps = centerline.slice(1).map((c, i) => Math.hypot(c.point[0] - centerline[i].point[0], c.point[1] - centerline[i].point[1]));
          const sortedGaps = [...gaps].sort((a, b) => a - b);
          const median = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 0;
          const gapThreshold = Math.max(median * 8, 1e-6);
          for (let i = 0; i < centerline.length - 1; i++) {
            if (gaps[i] > gapThreshold) continue;
            writer.addPolyline(layer, [centerline[i].point, centerline[i + 1].point], centerline[i].color);
          }
        }
      } else {
        // Schematic fallback (pk, delta) — no boundary geometry available
        // for this band (DXF calque/cote mode).
        const triples = groupRows.map((r) => [r.pk, r.delta as number, ACI_STATUS[r.status as ComparisonStatus]] as const);
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
  }

  // Colors are reused across sections (e.g. ACI 3 is both "Projet Gauche"
  // and Ratios' "≥ standard"), so a flat color→label map would conflate
  // them — the legend lists each enabled section's own colors instead,
  // grouped under that section's name. Placed below the drawing's actual
  // bottom-left corner (rounded down to the nearest 50m) rather than a
  // fixed coordinate, so it lands somewhere sensible whatever area a given
  // export happens to cover.
  const legendEntries: [string, number][] = [];
  if (axisPoints && axisPoints.length >= 2) legendEntries.push(["Axe", ACI.AXE]);
  if (options.includeExistant) {
    legendEntries.push([`${STATE_LABEL.existant} ${SIDE_LABEL.gauche}`, SERIES_COLOR.existant.gauche]);
    legendEntries.push([`${STATE_LABEL.existant} ${SIDE_LABEL.droite}`, SERIES_COLOR.existant.droite]);
  }
  if (options.includeProjet) {
    legendEntries.push([`${STATE_LABEL.projet} ${SIDE_LABEL.gauche}`, SERIES_COLOR.projet.gauche]);
    legendEntries.push([`${STATE_LABEL.projet} ${SIDE_LABEL.droite}`, SERIES_COLOR.projet.droite]);
  }
  if (options.includeRatios) {
    legendEntries.push(["Ratios : < réduit", ACI_RATIO_SOUS_REDUIT]);
    legendEntries.push(["Ratios : réduit ≤ largeur < standard", ACI_RATIO_ENTRE]);
    legendEntries.push(["Ratios : ≥ standard", ACI_RATIO_STANDARD]);
  }
  if (options.includeComparatif && comparisonRows && comparisonRows.length > 0) {
    legendEntries.push(["Comparatif : amélioré", ACI_STATUS.ameliore]);
    legendEntries.push(["Comparatif : inchangé", ACI_STATUS.inchange]);
    legendEntries.push(["Comparatif : dégradé", ACI_STATUS.degrade]);
  }

  const bbox = writer.boundingBox();
  if (bbox && legendEntries.length > 0) {
    const anchorX = Math.floor(bbox.minX / 50) * 50;
    const anchorY = Math.floor(bbox.minY / 50) * 50;
    const legendLayer = writer.ensureLayer("LEGENDE", 7);
    const textHeight = 5;
    const lineSpacing = 7;
    legendEntries.forEach(([label, color], i) => {
      writer.addText(legendLayer, anchorX, anchorY - (i + 1) * lineSpacing, textHeight, label, color);
    });
  }

  return writer.toString();
}
