/** Port of build_axis_reference_from_dxf in backend/app/extraction/axis_reference.py. */

import { AxisReference, linearFit } from "../axisReference";
import { PolylineIndex, type Point } from "../geometry";
import { parseDxf } from "./dxfReader";
import { clusterTexts, isPureInt, numericValue } from "./dxfCommon";

function pickMainAxis(lines: Point[][]): Point[] {
  if (lines.length === 0) throw new Error("No legacy POLYLINE entities found to serve as axis");
  const lengths = lines.map((l) => new PolylineIndex(l).length);
  const maxLen = Math.max(...lengths);
  const candidates = lines.filter((_, i) => lengths[i] > 0.9 * maxLen);
  if (candidates.length === 1) return candidates[0];
  const allPts = candidates.flat();
  const centroid: Point = [
    allPts.reduce((s, p) => s + p[0], 0) / allPts.length,
    allPts.reduce((s, p) => s + p[1], 0) / allPts.length,
  ];
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const minDist = Math.min(...c.map((p) => Math.hypot(p[0] - centroid[0], p[1] - centroid[1])));
    if (minDist < bestDist) {
      bestDist = minDist;
      best = c;
    }
  }
  return best;
}

export function buildAxisReferenceFromDxfContent(content: string, pkStepHint?: number): AxisReference {
  const doc = parseDxf(content);
  const legacyLines = doc.polylines.filter((p) => p.kind === "POLYLINE").map((p) => p.points);
  const axisPts = pickMainAxis(legacyLines);
  const axis = new PolylineIndex(axisPts);

  const clusters = clusterTexts(doc.texts);

  // 1) explicit PK/chainage labels, highest confidence
  for (const cluster of clusters.values()) {
    const values = cluster.map((t) => [t, numericValue(t)] as const);
    if (values.length < 3) continue;
    if (values.every(([, v]) => v !== null && v > 100)) {
      const stations = values.map(([t]) => axis.projectPoint([t.x, t.y])[0]);
      const pks = values.map(([, v]) => v as number);
      const { scale, offset } = linearFit(stations, pks);
      return new AxisReference(axis, scale, offset, "pk_labels");
    }
  }

  // 2) sequential profile-number markers (1, 2, 3, ...), spaced at pkStepHint
  let bestCluster: (typeof doc.texts) | null = null;
  for (const cluster of clusters.values()) {
    if (cluster.length < 3) continue;
    if (!cluster.every(isPureInt)) continue;
    const ints = cluster.map((t) => parseInt(t.content, 10)).sort((a, b) => a - b);
    const isSequential = ints.every((v, i) => v === ints[0] + i);
    if (isSequential && (!bestCluster || cluster.length > bestCluster.length)) bestCluster = cluster;
  }
  if (bestCluster) {
    const ordered = [...bestCluster].sort((a, b) => parseInt(a.content, 10) - parseInt(b.content, 10));
    const stations = ordered.map((t) => axis.projectPoint([t.x, t.y])[0]);
    const numbers = ordered.map((t) => parseInt(t.content, 10));
    let step = pkStepHint;
    if (step === undefined) {
      const diffs = stations.slice(1).map((s, i) => s - stations[i]);
      const sorted = [...diffs].sort((a, b) => a - b);
      step = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
    }
    const pks = numbers.map((n) => (n - numbers[0]) * (step as number));
    const { scale, offset } = linearFit(stations, pks);
    return new AxisReference(axis, scale, offset, "profile_markers");
  }

  // 3) fallback: relative station, origin at axis start
  return new AxisReference(axis, 1.0, 0.0, "relative");
}
