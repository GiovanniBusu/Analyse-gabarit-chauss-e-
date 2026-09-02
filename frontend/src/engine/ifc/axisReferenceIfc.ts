/** Port of build_axis_reference_from_ifc in backend/app/extraction/axis_reference.py. */

import * as WebIFC from "web-ifc";
import type { IfcAPI } from "web-ifc";
import { AxisReference } from "../axisReference";
import { PolylineIndex, type Point } from "../geometry";
import { attrRef, attrRefList } from "./webIfcClient";
import { allVertices, pcaAxisPolyline, productCentroids } from "./ifcGeometry";
import { pushAll } from "../arrayUtils";

function allExpressIdsOfType(api: IfcAPI, modelID: number, type: number): number[] {
  const ids = api.GetLineIDsWithType(modelID, type, true);
  const out: number[] = [];
  for (let i = 0; i < ids.size(); i++) out.push(ids.get(i));
  return out;
}

function cartesianPointXY(api: IfcAPI, modelID: number, pointRef: number): Point | null {
  const point = api.GetLine(modelID, pointRef) as Record<string, unknown>;
  const coords = point.Coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const x = (coords[0] as { value: number })?.value;
  const y = (coords[1] as { value: number })?.value;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return [x, y];
}

/** Best-effort extraction of an IfcAlignment's horizontal geometry as a
 * polyline. IFC4X3 alignment representations vary a lot between authoring
 * tools, so this degrades gracefully to null (caller falls back to PCA) —
 * same spirit as the Python version's own docstring. */
function alignmentPolyline(api: IfcAPI, modelID: number, alignmentId: number): Point[] | null {
  try {
    const nests = allExpressIdsOfType(api, modelID, WebIFC.IFCRELNESTS).map(
      (id) => api.GetLine(modelID, id) as Record<string, unknown>,
    );
    const childrenOf = (parentId: number): number[] => {
      const out: number[] = [];
      for (const rel of nests) {
        if (attrRef(rel, "RelatingObject") === parentId) pushAll(out, attrRefList(rel, "RelatedObjects"));
      }
      return out;
    };

    for (const horizontalId of childrenOf(alignmentId)) {
      const horizontalLine = api.GetLine(modelID, horizontalId) as Record<string, unknown>;
      if (horizontalLine.type !== WebIFC.IFCALIGNMENTHORIZONTAL) continue;
      const pts: Point[] = [];
      for (const segId of childrenOf(horizontalId)) {
        const seg = api.GetLine(modelID, segId) as Record<string, unknown>;
        const designParamsRef = attrRef(seg, "DesignParameters");
        if (designParamsRef === null) continue;
        const designParams = api.GetLine(modelID, designParamsRef) as Record<string, unknown>;
        const startPointRef = attrRef(designParams, "StartPoint");
        if (startPointRef === null) continue;
        const pt = cartesianPointXY(api, modelID, startPointRef);
        if (pt) pts.push(pt);
      }
      if (pts.length >= 2) return pts;
    }
  } catch {
    return null;
  }
  return null;
}

/** Orders a scattered point cloud into a path by repeatedly walking to the
 * closest not-yet-used point — unlike projecting onto a single global
 * direction (fine for a roughly straight corridor, unreliable once it
 * curves enough that two points on different bends project to nearly the
 * same scalar), this only ever looks at real proximity, so it follows
 * curves correctly regardless of their shape. Works in full 3D (x, y,
 * height): a road passing under a bridge, or over/under itself at an
 * interchange, can put two real path segments close together in plan while
 * they sit at very different elevations — 2D-only proximity would treat
 * them as neighbors and produce a visible kink where the chain jumps
 * between levels. Starting point is the one with the smallest x (ties
 * broken by y, then z) purely so the same input always produces the same
 * chain — which physical end that is doesn't matter, since nothing
 * downstream depends on the axis's tracing direction. */
function nearestNeighborChain(points: [number, number, number][]): [number, number, number][] {
  if (points.length < 2) return points;
  let startIdx = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i];
    const b = points[startIdx];
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) {
      startIdx = i;
    }
  }

  const remaining = new Set(points.map((_, i) => i));
  const chain: [number, number, number][] = [points[startIdx]];
  remaining.delete(startIdx);
  while (remaining.size > 0) {
    const [cx, cy, cz] = chain[chain.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const idx of remaining) {
      const [x, y, z] = points[idx];
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    }
    chain.push(points[bestIdx]);
    remaining.delete(bestIdx);
  }
  return chain;
}

/** A nearest-neighbor chain over real-world data rarely covers every input
 * point cleanly: a stray marker unrelated to the sequential corridor chain
 * (a legend, an out-of-place annotation, …) gets stranded until the greedy
 * walk is finally forced to jump to it, showing up as one segment far
 * longer than the rest. Cuts the chain at any such disproportionate jump
 * (more than 6x the median segment length) and keeps the longest piece,
 * rather than let a handful of outliers balloon the axis length and shift
 * every station computed from it. */
function trimOutlierEnds(chain: [number, number, number][]): [number, number, number][] {
  if (chain.length < 3) return chain;
  const segLens: number[] = [];
  for (let i = 1; i < chain.length; i++) {
    segLens.push(Math.hypot(chain[i][0] - chain[i - 1][0], chain[i][1] - chain[i - 1][1], chain[i][2] - chain[i - 1][2]));
  }
  const sorted = [...segLens].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(median * 6, 5);

  const breaks: number[] = [];
  segLens.forEach((len, i) => {
    if (len > threshold) breaks.push(i);
  });
  if (breaks.length === 0) return chain;

  const boundaries = [-1, ...breaks, segLens.length];
  let bestStart = 0;
  let bestCount = 0;
  for (let k = 0; k < boundaries.length - 1; k++) {
    const start = boundaries[k] + 1;
    const end = boundaries[k + 1];
    const count = end - start + 1;
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }
  return chain.slice(bestStart, bestStart + bestCount);
}

export function buildAxisReferenceFromIfcModel(api: IfcAPI, modelID: number): AxisReference {
  const alignmentIds = allExpressIdsOfType(api, modelID, WebIFC.IFCALIGNMENT);
  if (alignmentIds.length > 0) {
    const pts = alignmentPolyline(api, modelID, alignmentIds[0]);
    if (pts && pts.length >= 2) {
      const axis = new PolylineIndex(pts);
      return new AxisReference(axis, 1.0, 0.0, "profile_markers");
    }
  }

  const pavementIds = allExpressIdsOfType(api, modelID, WebIFC.IFCPAVEMENT);
  if (pavementIds.length > 0) {
    const verts = allVertices(api, modelID, pavementIds, function* () {});
    const pts = pcaAxisPolyline(verts);
    const axis = new PolylineIndex(pts);
    return new AxisReference(axis, 1.0, 0.0, "relative");
  }

  // No IfcAlignment, no IfcPavement: this is typically a dedicated
  // "axes + profils" reference file whose only geometry is many small
  // cross-section marker products spread along the true corridor (see
  // productCentroids' docstring). A single global PCA direction is a poor
  // *ordering* key once the corridor curves enough — projecting onto one
  // straight scalar interleaves markers from different bends, which reads
  // as a dense zigzag once connected. Chain the markers by proximity
  // instead (greedy nearest-neighbor): each next point is simply the
  // closest not-yet-used marker to the current chain end, which follows a
  // curve correctly regardless of its shape. A marker or two that's a
  // stray outlier (not part of the sequential chain at all — e.g. an
  // unrelated annotation far from the corridor) then shows up as one very
  // long segment at the point the greedy walk is forced to jump to it;
  // trimOutlierEnds cuts those off rather than let them balloon the axis
  // length and distort every station downstream.
  const centroids = productCentroids(api, modelID, allExpressIdsOfType(api, modelID, WebIFC.IFCPRODUCT));
  const chain = nearestNeighborChain(centroids);
  const trimmed = trimOutlierEnds(chain);
  const pts: Point[] = (trimmed.length >= 2 ? trimmed : chain).map(([x, y]) => [x, y]);
  const axis = new PolylineIndex(pts);
  return new AxisReference(axis, 1.0, 0.0, "relative");
}
