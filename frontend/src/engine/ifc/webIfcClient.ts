/** Thin wrapper around web-ifc's IfcAPI: model open/close, attribute
 * access, and per-product geometry extraction. Isolates the raw web-ifc
 * calling conventions (REF handles, Y-up world transform) so the rest of
 * the engine can work with plain numbers and plan-view (x, y) points, the
 * same shape backend/app/extraction/ifc_extractor.py works with. */

import * as WebIFC from "web-ifc";
import { pushAll } from "../arrayUtils";

let apiPromise: Promise<WebIFC.IfcAPI> | null = null;

/** `wasmBaseUrl` must end in a trailing slash and point to the directory
 * containing web-ifc's .wasm files (see public/wasm/ + vite.config base). */
export function getIfcApi(wasmBaseUrl: string): Promise<WebIFC.IfcAPI> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new WebIFC.IfcAPI();
      api.SetWasmPath(wasmBaseUrl, true);
      await api.Init();
      return api;
    })();
  }
  return apiPromise;
}

export function openModel(api: WebIFC.IfcAPI, bytes: Uint8Array): number {
  return api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
}

type RawAttr = { value: unknown; type: number; name?: string } | null | undefined;

export function attrString(line: Record<string, unknown>, key: string): string | null {
  const attr = line[key] as RawAttr;
  if (!attr || typeof attr !== "object") return null;
  return typeof attr.value === "string" ? attr.value : null;
}

export function attrRef(line: Record<string, unknown>, key: string): number | null {
  const attr = line[key] as RawAttr;
  if (!attr || typeof attr !== "object") return null;
  return attr.type === WebIFC.REF && typeof attr.value === "number" ? attr.value : null;
}

export function attrRefList(line: Record<string, unknown>, key: string): number[] {
  const attr = line[key];
  if (!Array.isArray(attr)) return [];
  return attr
    .filter((a): a is { value: number; type: number } => !!a && typeof a === "object" && a.type === WebIFC.REF)
    .map((a) => a.value);
}

/** column-major 4x4 transform, as returned in PlacedGeometry.flatTransformation. */
function applyTransform(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Returns world-space vertex positions for one product, remapped so index
 * 0/1 are plan-view (x, y) matching the DXF/IFC-native convention used
 * everywhere else in this engine, and index 2 is height:
 *   planX = webifc_x, planY = -webifc_z, height = webifc_y
 * (web-ifc's Y-up output has z_webifc = -y_ifc, y_webifc = z_ifc — see
 * engine/ifc/README notes / IFC2CLOUD's own documented axis convention). */
export function shapeVertices(api: WebIFC.IfcAPI, modelID: number, expressID: number): [number, number, number][] | null {
  const groups = shapeVertexGroups(api, modelID, expressID);
  if (!groups) return null;
  const out: [number, number, number][] = [];
  for (const g of groups) pushAll(out, g);
  return out;
}

/** Like shapeVertices, but keeps each `mesh.geometries` entry (one placed
 * solid "item" of the product's shape representation) as its own array
 * instead of flattening them together. A single IfcPavement product can
 * carry more than one such item to model physically disjoint pieces (e.g.
 * one compound "Accotements" product with a separate solid per side of the
 * road) — callers that need to reason about which vertices are actually
 * connected (width/cross-section extraction) must keep them apart; callers
 * that only need an unstructured point cloud (PCA axis fallback) can still
 * use the flattened shapeVertices. */
export function shapeVertexGroups(api: WebIFC.IfcAPI, modelID: number, expressID: number): [number, number, number][][] | null {
  let mesh: WebIFC.FlatMesh;
  try {
    mesh = api.GetFlatMesh(modelID, expressID);
  } catch {
    return null;
  }
  const groups: [number, number, number][][] = [];
  for (let g = 0; g < mesh.geometries.size(); g++) {
    const placed = mesh.geometries.get(g);
    const geom = api.GetGeometry(modelID, placed.geometryExpressID);
    const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
    const group: [number, number, number][] = [];
    // interleaved: position(3) + normal(3) per vertex
    for (let i = 0; i + 5 < verts.length; i += 6) {
      const [wx, wy, wz] = applyTransform(placed.flatTransformation, verts[i], verts[i + 1], verts[i + 2]);
      group.push([wx, -wz, wy]);
    }
    if (group.length > 0) groups.push(group);
  }
  return groups.length > 0 ? groups : null;
}
