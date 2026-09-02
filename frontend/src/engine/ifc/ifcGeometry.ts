/** Port of backend/app/extraction/ifc_geometry.py. */

import type { IfcAPI } from "web-ifc";
import type { AxisReference } from "../axisReference";
import type { Point } from "../geometry";
import { shapeVertices } from "./webIfcClient";
import { maxOf, minOf, pushAll } from "../arrayUtils";

export function clusterRingWidths(
  stations: number[],
  offsets: number[],
  gapThresholdM = 1.5,
  plausibleRange: [number, number] = [0.1, 20.0],
): [number, number][] {
  const order = stations.map((_, i) => i).sort((a, b) => stations[a] - stations[b]);
  const stationsSorted = order.map((i) => stations[i]);
  const offsetsSorted = order.map((i) => offsets[i]);

  const groups: number[][] = [];
  let current = [0];
  for (let i = 1; i < stationsSorted.length; i++) {
    if (stationsSorted[i] - stationsSorted[current[current.length - 1]] < gapThresholdM) {
      current.push(i);
    } else {
      groups.push(current);
      current = [i];
    }
  }
  groups.push(current);

  const samples: [number, number][] = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const groupOffsets = group.map((i) => offsetsSorted[i]);
    const groupStations = group.map((i) => stationsSorted[i]);
    const width = maxOf(groupOffsets) - minOf(groupOffsets);
    if (width >= plausibleRange[0] && width <= plausibleRange[1]) {
      const meanStation = groupStations.reduce((a, b) => a + b, 0) / groupStations.length;
      samples.push([meanStation, width]);
    }
  }
  return samples;
}

/** Fallback axis when no IfcAlignment is present: PCA principal direction of
 * the point cloud, then bin points along it and take per-bin centroids. */
export function pcaAxisPolyline(verts: [number, number, number][], nBins = 40): Point[] {
  const xy: Point[] = verts.map((v) => [v[0], v[1]]);
  const cx = xy.reduce((s, p) => s + p[0], 0) / xy.length;
  const cy = xy.reduce((s, p) => s + p[1], 0) / xy.length;
  const centered = xy.map(([x, y]) => [x - cx, y - cy] as Point);

  // Principal direction via the 2x2 covariance matrix's dominant eigenvector
  // (equivalent to the first right-singular vector used in the Python SVD).
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of centered) {
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const eig = trace / 2 + Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  let dx = sxy;
  let dy = eig - sxx;
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
    dx = 1;
    dy = 0;
  }
  const norm = Math.hypot(dx, dy);
  dx /= norm;
  dy /= norm;

  const projection = centered.map(([x, y]) => x * dx + y * dy);
  const minP = minOf(projection);
  const maxP = maxOf(projection);
  const binWidth = (maxP - minP) / nBins;
  const bins: Point[][] = Array.from({ length: nBins }, () => []);
  for (let i = 0; i < projection.length; i++) {
    let b = binWidth > 1e-12 ? Math.floor((projection[i] - minP) / binWidth) : 0;
    b = Math.min(Math.max(b, 0), nBins - 1);
    bins[b].push(xy[i]);
  }
  const pts: Point[] = [];
  for (const bin of bins) {
    if (bin.length === 0) continue;
    pts.push([bin.reduce((s, p) => s + p[0], 0) / bin.length, bin.reduce((s, p) => s + p[1], 0) / bin.length]);
  }
  if (pts.length < 2) throw new Error("Not enough spread in IFC geometry to derive a fallback axis");
  return pts;
}

/** Bounded on purpose — see backend/app/extraction/ifc_geometry.py's
 * all_vertices docstring: without a cap, a reference file with no
 * IfcPavement falls through to triangulating every IfcProduct in the model. */
export function allVertices(
  api: IfcAPI,
  modelID: number,
  pavementExpressIds: number[],
  otherProductExpressIds: () => Iterable<number>,
  maxProducts = 500,
  maxVertices = 200_000,
): [number, number, number][] {
  const chunks: [number, number, number][] = [];
  let total = 0;
  for (const id of pavementExpressIds) {
    const v = shapeVertices(api, modelID, id);
    if (v) {
      pushAll(chunks, v);
      total += v.length;
    }
    if (total >= maxVertices) break;
  }
  if (chunks.length === 0) {
    let count = 0;
    for (const id of otherProductExpressIds()) {
      const v = shapeVertices(api, modelID, id);
      if (v) {
        pushAll(chunks, v);
        total += v.length;
        count++;
      }
      if (count >= maxProducts || total >= maxVertices) break;
    }
  }
  if (chunks.length === 0) throw new Error("No geometry found in IFC file to build a fallback axis");
  return chunks;
}

export function pavementWidthSamples(
  api: IfcAPI,
  modelID: number,
  expressID: number,
  axis: AxisReference,
  gapThresholdM = 1.5,
  plausibleRange: [number, number] = [0.1, 20.0],
): [number, number][] {
  const verts = shapeVertices(api, modelID, expressID);
  if (!verts || verts.length < 2) return [];
  const stations: number[] = [];
  const offsets: number[] = [];
  for (const v of verts) {
    const [s, o] = axis.axis.projectPoint([v[0], v[1]]);
    stations.push(s);
    offsets.push(o);
  }
  const pairs = clusterRingWidths(stations, offsets, gapThresholdM, plausibleRange);
  return pairs.map(([station, width]) => [axis.stationToPk(station), width]);
}
