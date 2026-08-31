/** Port of backend/app/export/dxf_export.py: a schematic width-vs-PK chart
 * (X = PK, Y = width), layered by Existant/Projet/Ratios/Comparatif. See the
 * Python module's docstring for why this isn't a plan-view reconstruction:
 * the pipeline only keeps scalar widths after extraction, not boundary curves. */

import { DxfWriter } from "../dxf/dxfWriter";
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
): string {
  const writer = new DxfWriter();

  if (options.includeExistant || options.includeProjet) {
    const byGroup = new Map<string, [number, number][]>();
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
      byGroup.get(key)!.push([s.pk, s.width_m]);
    }
    for (const [key, points] of byGroup.entries()) {
      const [side, elementType, state] = meta.get(key)!;
      const layer = writer.ensureLayer(`${STATE_TAG[state]}_${SIDE_TAG[side]}_${TYPE_TAG[elementType]}`, state === "existant" ? 5 : 3);
      const color = state === "existant" ? 5 : 3;
      drawSeries(writer, layer, points, color, options);
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
