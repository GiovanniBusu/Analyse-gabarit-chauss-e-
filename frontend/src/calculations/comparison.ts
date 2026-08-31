import type { ComparisonRow, ComparisonStatus, ElementType, Side, StateKind, WidthSample } from "../types/domain";

/** Direct port of backend/app/calculations/comparison.py. */

function interpolate(pk: number, pks: number[], widths: number[]): number | null {
  if (pks.length === 0) return null;
  // bisect_left
  let lo = 0;
  let hi = pks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pks[mid] < pk) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo;
  if (idx === 0) return Math.abs(pks[0] - pk) < 1e-6 ? widths[0] : null;
  if (idx >= pks.length) return Math.abs(pk - pks[pks.length - 1]) < 1e-6 ? widths[widths.length - 1] : null;
  if (pks[idx] === pk) return widths[idx];
  const pk0 = pks[idx - 1];
  const pk1 = pks[idx];
  const w0 = widths[idx - 1];
  const w1 = widths[idx];
  if (pk1 === pk0) return w0;
  const t = (pk - pk0) / (pk1 - pk0);
  return w0 + t * (w1 - w0);
}

export function compareStates(samples: WidthSample[], deltaSeuilM: number): ComparisonRow[] {
  type Group = { pks: number[]; widths: number[] };
  const byGroup = new Map<string, Group>();
  const keyOf = (side: Side, et: ElementType, state: StateKind) => `${side}|${et}|${state}`;

  const sorted = [...samples]
    .filter((s) => s.width_m != null)
    .sort((a, b) => a.pk - b.pk);

  for (const s of sorted) {
    const key = keyOf(s.side, s.element_type, s.state);
    if (!byGroup.has(key)) byGroup.set(key, { pks: [], widths: [] });
    const g = byGroup.get(key)!;
    g.pks.push(s.pk);
    g.widths.push(s.width_m as number);
  }

  const pairKeys = new Set<string>();
  for (const s of sorted) pairKeys.add(`${s.side}|${s.element_type}`);

  const rows: ComparisonRow[] = [];
  for (const pairKey of Array.from(pairKeys).sort()) {
    const [side, elementType] = pairKey.split("|") as [Side, ElementType];
    const existant = byGroup.get(keyOf(side, elementType, "existant")) ?? { pks: [], widths: [] };
    const projet = byGroup.get(keyOf(side, elementType, "projet")) ?? { pks: [], widths: [] };
    if (existant.pks.length === 0 && projet.pks.length === 0) continue;

    const allPks = Array.from(new Set([...existant.pks, ...projet.pks])).sort((a, b) => a - b);
    for (const pk of allPks) {
      const wExist = interpolate(pk, existant.pks, existant.widths);
      const wProj = interpolate(pk, projet.pks, projet.widths);
      let delta: number | null = null;
      let status: ComparisonStatus | null = null;
      if (wExist != null && wProj != null) {
        delta = wProj - wExist;
        if (delta > deltaSeuilM) status = "ameliore";
        else if (delta < -deltaSeuilM) status = "degrade";
        else status = "inchange";
      }
      rows.push({ pk, side, element_type: elementType, width_existant: wExist, width_projet: wProj, delta, status });
    }
  }
  return rows;
}
