/** Port of build_axis_reference_from_ifc in backend/app/extraction/axis_reference.py. */

import * as WebIFC from "web-ifc";
import type { IfcAPI } from "web-ifc";
import { AxisReference } from "../axisReference";
import { PolylineIndex, type Point } from "../geometry";
import { attrRef, attrRefList } from "./webIfcClient";
import { allVertices, pcaAxisPolyline } from "./ifcGeometry";

function allExpressIdsOfType(api: IfcAPI, modelID: number, type: number): number[] {
  const ids = api.GetLineIDsWithType(modelID, type);
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
        if (attrRef(rel, "RelatingObject") === parentId) out.push(...attrRefList(rel, "RelatedObjects"));
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
  const verts = allVertices(api, modelID, pavementIds, function* () {
    for (const id of allExpressIdsOfType(api, modelID, WebIFC.IFCPRODUCT)) yield id;
  });
  const pts = pcaAxisPolyline(verts);
  const axis = new PolylineIndex(pts);
  return new AxisReference(axis, 1.0, 0.0, "relative");
}
