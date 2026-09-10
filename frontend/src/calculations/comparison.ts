import type { ComparisonRow, ComparisonStatus, ElementType, Side, StateKind, WidthSample } from "../types/domain";

/** Direct port of backend/app/calculations/comparison.py, extended to a
 * 3-way comparison once a "Projet V1" file is uploaded: Existant → Projet
 * V0 is the original comparison, and Projet V0 → Projet V1 / Existant →
 * Projet V1 are the two additional deltas that come with a second project
 * version. All three are always computed; a pair with a missing state (no
 * V1 uploaded) simply comes back null, same as an empty file always has. */

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
  type Group = { pks: number[]; widths: number[]; byPk: Map<number, WidthSample> };
  const byGroup = new Map<string, Group>();
  const keyOf = (side: Side, et: ElementType, state: StateKind) => `${side}|${et}|${state}`;

  const sorted = [...samples]
    .filter((s) => s.width_m != null && s.element_type !== "non_utilise")
    .sort((a, b) => a.pk - b.pk);

  for (const s of sorted) {
    const key = keyOf(s.side, s.element_type, s.state);
    if (!byGroup.has(key)) byGroup.set(key, { pks: [], widths: [], byPk: new Map() });
    const g = byGroup.get(key)!;
    g.pks.push(s.pk);
    g.widths.push(s.width_m as number);
    g.byPk.set(s.pk, s);
  }

  const pairKeys = new Set<string>();
  for (const s of sorted) pairKeys.add(`${s.side}|${s.element_type}`);

  const statusOf = (delta: number | null): ComparisonStatus | null => {
    if (delta == null) return null;
    if (delta > deltaSeuilM) return "ameliore";
    if (delta < -deltaSeuilM) return "degrade";
    return "inchange";
  };

  const rows: ComparisonRow[] = [];
  for (const pairKey of Array.from(pairKeys).sort()) {
    const [side, elementType] = pairKey.split("|") as [Side, ElementType];
    const empty: Group = { pks: [], widths: [], byPk: new Map() };
    const existant = byGroup.get(keyOf(side, elementType, "existant")) ?? empty;
    const projetV0 = byGroup.get(keyOf(side, elementType, "projet")) ?? empty;
    const projetV1 = byGroup.get(keyOf(side, elementType, "projet_v1")) ?? empty;
    if (existant.pks.length === 0 && projetV0.pks.length === 0 && projetV1.pks.length === 0) continue;

    const allPks = Array.from(new Set([...existant.pks, ...projetV0.pks, ...projetV1.pks])).sort((a, b) => a - b);
    for (const pk of allPks) {
      const wExist = interpolate(pk, existant.pks, existant.widths);
      const wV0 = interpolate(pk, projetV0.pks, projetV0.widths);
      const wV1 = interpolate(pk, projetV1.pks, projetV1.widths);

      const deltaExistantV0 = wExist != null && wV0 != null ? wV0 - wExist : null;
      const deltaV0V1 = wV0 != null && wV1 != null ? wV1 - wV0 : null;
      const deltaExistantV1 = wExist != null && wV1 != null ? wV1 - wExist : null;

      // Every pk here came verbatim from one state's own sample list, so
      // that sample's own near/far is a real plan position — not a new
      // interpolation — good enough to draw this row "en situation".
      const origin = existant.byPk.get(pk) ?? projetV0.byPk.get(pk) ?? projetV1.byPk.get(pk);
      rows.push({
        pk,
        side,
        element_type: elementType,
        width_existant: wExist,
        width_projet_v0: wV0,
        width_projet_v1: wV1,
        delta_existant_v0: deltaExistantV0,
        status_existant_v0: statusOf(deltaExistantV0),
        delta_v0_v1: deltaV0V1,
        status_v0_v1: statusOf(deltaV0V1),
        delta_existant_v1: deltaExistantV1,
        status_existant_v1: statusOf(deltaExistantV1),
        near_x: origin?.near_x,
        near_y: origin?.near_y,
        far_x: origin?.far_x,
        far_y: origin?.far_y,
      });
    }
  }
  return rows;
}
