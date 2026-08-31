import type { ElementType, RatioResult, Side, StateKind, Threshold, WidthSample } from "../types/domain";

/** Direct port of backend/app/calculations/ratios.py — kept client-side so a
 * server restart (or a manual band override) never needs a round trip. */
export function computeRatios(samples: WidthSample[], thresholds: Threshold[]): RatioResult[] {
  const thresholdByType = new Map<ElementType, Threshold>(thresholds.map((t) => [t.element_type, t]));
  const groups = new Map<string, { side: Side; element_type: ElementType; state: StateKind; widths: number[] }>();

  for (const s of samples) {
    if (s.width_m == null) continue;
    const key = `${s.side}|${s.element_type}|${s.state}`;
    if (!groups.has(key)) {
      groups.set(key, { side: s.side, element_type: s.element_type, state: s.state, widths: [] });
    }
    groups.get(key)!.widths.push(s.width_m);
  }

  const results: RatioResult[] = [];
  for (const { side, element_type, state, widths } of groups.values()) {
    const threshold = thresholdByType.get(element_type);
    const n = widths.length;
    if (!threshold || n === 0) continue;
    const nSous = widths.filter((w) => w < threshold.reduit_m).length;
    const nEntre = widths.filter((w) => w >= threshold.reduit_m && w < threshold.standard_m).length;
    const nSur = widths.filter((w) => w >= threshold.standard_m).length;
    results.push({
      side,
      element_type,
      state,
      pct_sous_reduit: (100 * nSous) / n,
      pct_entre: (100 * nEntre) / n,
      pct_sur_standard: (100 * nSur) / n,
      n_samples: n,
    });
  }
  return results;
}
