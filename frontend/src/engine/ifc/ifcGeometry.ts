/** Port of backend/app/extraction/ifc_geometry.py. */

import type { IfcAPI } from "web-ifc";
import type { AxisReference } from "../axisReference";
import { perpendicularDirection, type Point } from "../geometry";
import { shapeVertexGroups, shapeVertices } from "./webIfcClient";
import { maxOf, minOf, pushAll } from "../arrayUtils";
import type { Side } from "../../types/domain";

export interface RingWidth {
  station: number;
  width: number;
  /** Signed axis offsets bounding this ring. offsetMin/offsetMax keep a
   * *stable* identity (the algebraically smaller/larger offset) rather than
   * a "near/far from axis" one — picking near/far by absolute value flips
   * which physical edge each field represents whenever a ring is close to
   * straddling the axis (common for a central "voie" band), and connecting
   * such flip-flopping points into one polyline draws a zigzag instead of a
   * smooth boundary. This mirrors the DXF heuristic extractor's own
   * convention (orderLinesByOffset: always low-offset-line first). */
  offsetMin: number;
  offsetMax: number;
  /** gauche/droite of this specific ring, from the sign of the ring's mean
   * offset — see clusterRingWidths' offset-gap split for why side can't be
   * decided once per whole product. */
  side: Side;
}

export function clusterRingWidths(
  stations: number[],
  offsets: number[],
  gapThresholdM = 1.5,
  plausibleRange: [number, number] = [0.1, 20.0],
): RingWidth[] {
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

  const samples: RingWidth[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const groupOffsets = group.map((i) => offsetsSorted[i]);
    const groupStations = group.map((i) => stationsSorted[i]);
    const offsetMin = minOf(groupOffsets);
    const offsetMax = maxOf(groupOffsets);
    const width = offsetMax - offsetMin;
    if (width >= plausibleRange[0] && width <= plausibleRange[1]) {
      const meanStation = groupStations.reduce((a, b) => a + b, 0) / groupStations.length;
      const side: Side = offsetMin + offsetMax >= 0 ? "gauche" : "droite";
      samples.push({ station: meanStation, width, offsetMin, offsetMax, side });
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

export interface PlanWidthSample {
  pk: number;
  width: number;
  side: Side;
  /** True (x, y) boundary points of this ring, reconstructed from the axis
   * at this station — used to redraw the road in plan (see dxfExport.ts)
   * instead of only a schematic (pk, width) chart. `near` always comes from
   * offsetMin and `far` from offsetMax (see RingWidth) — a stable identity,
   * not literal distance from the axis. */
  near: Point;
  far: Point;
}

/** A single IfcPavement product can carry more than one physically disjoint
 * solid in its shape representation — e.g. a compound "Accotements" product
 * with a separate item per side of the road. Flattening all of a product's
 * vertices together before clustering would merge such disjoint pieces into
 * one bogus, oversized ring (there is no single distance threshold that
 * reliably tells "the near/far edge of one wide band" apart from "two
 * separate bands sitting far apart"). So each geometry item is projected and
 * clustered independently, and the results concatenated — real connectivity
 * from the file decides what's one piece, not a guessed gap size. */
export function pavementWidthSamples(
  api: IfcAPI,
  modelID: number,
  expressID: number,
  axis: AxisReference,
  gapThresholdM = 1.5,
  plausibleRange: [number, number] = [0.1, 20.0],
): PlanWidthSample[] {
  const vertexGroups = shapeVertexGroups(api, modelID, expressID);
  if (!vertexGroups) return [];

  const result: PlanWidthSample[] = [];
  for (const verts of vertexGroups) {
    if (verts.length < 2) continue;
    const stations: number[] = [];
    const offsets: number[] = [];
    for (const v of verts) {
      const [s, o] = axis.axis.projectPoint([v[0], v[1]]);
      stations.push(s);
      offsets.push(o);
    }
    const rings = clusterRingWidths(stations, offsets, gapThresholdM, plausibleRange);
    for (const { station, width, offsetMin, offsetMax, side } of rings) {
      const { point, direction } = axis.axis.pointAndDirectionAtStation(station);
      const perp = perpendicularDirection(direction);
      const near: Point = [point[0] + offsetMin * perp[0], point[1] + offsetMin * perp[1]];
      const far: Point = [point[0] + offsetMax * perp[0], point[1] + offsetMax * perp[1]];
      result.push({ pk: axis.stationToPk(station), width, side, near, far });
    }
  }
  return result;
}
