/** Port of backend/app/extraction/ifc_extractor.py. */

import * as WebIFC from "web-ifc";
import type { IfcAPI } from "web-ifc";
import type { AxisReference } from "../axisReference";
import type { Band, ElementType, Side, SourceMethod, StateKind, WidthSample } from "../../types/domain";
import { attrRef, attrRefList, attrString } from "./webIfcClient";
import { pavementWidthSamples, type PlanWidthSample } from "./ifcGeometry";
import { maxOf, minOf, pushAll } from "../arrayUtils";

const KEYWORD_HINTS: [RegExp, ElementType][] = [
  [/bau/i, "bau"],
  [/accot/i, "accotement"],
  [/tr.{0,4}oir/i, "trottoir"],
  [/cycl/i, "cycle"],
  [/voie|chauss/i, "voie"],
  [/tpc|median|terre.?plein/i, "tpc"],
];

export function guessElementType(typeName: string): [ElementType, number] {
  for (const [pattern, elementType] of KEYWORD_HINTS) {
    if (pattern.test(typeName)) return [elementType, 0.3];
  }
  return ["non_utilise", 0.1];
}

interface PavementGroup {
  typeName: string;
  expressIds: number[];
}

function pavementTypeName(api: IfcAPI, modelID: number, line: Record<string, unknown>, expressID: number): string {
  const relTypeIds = api.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE, true);
  for (let i = 0; i < relTypeIds.size(); i++) {
    const rel = api.GetLine(modelID, relTypeIds.get(i)) as Record<string, unknown>;
    const related = attrRefList(rel, "RelatedObjects");
    if (related.includes(expressID)) {
      const typeId = attrRef(rel, "RelatingType");
      if (typeId !== null) {
        const typeLine = api.GetLine(modelID, typeId) as Record<string, unknown>;
        return attrString(typeLine, "Name") ?? `Type-${typeId}`;
      }
    }
  }
  return attrString(line, "Name") ?? `Pavement-${expressID}`;
}

function roadAncestorName(api: IfcAPI, modelID: number, expressID: number, parentMap: Map<number, number>): string | null {
  let current = expressID;
  for (let depth = 0; depth < 6; depth++) {
    const parent = parentMap.get(current);
    if (parent === undefined) return null;
    const parentLine = api.GetLine(modelID, parent) as Record<string, unknown>;
    if (parentLine.type === WebIFC.IFCROAD) return attrString(parentLine, "Name");
    current = parent;
  }
  return null;
}

function matchesState(name: string | null, state: StateKind): boolean {
  if (name === null) return true;
  const lowered = name.toLowerCase();
  if (state === "existant") return /exist|actuel/.test(lowered);
  return /projet|project|futur/.test(lowered);
}

function buildParentMap(api: IfcAPI, modelID: number): Map<number, number> {
  const parentMap = new Map<number, number>();
  const relAggIds = api.GetLineIDsWithType(modelID, WebIFC.IFCRELAGGREGATES, true);
  for (let i = 0; i < relAggIds.size(); i++) {
    const rel = api.GetLine(modelID, relAggIds.get(i)) as Record<string, unknown>;
    const parent = attrRef(rel, "RelatingObject");
    if (parent === null) continue;
    for (const child of attrRefList(rel, "RelatedObjects")) parentMap.set(child, parent);
  }
  return parentMap;
}

/** Groups by type name only. Side is *not* decided here: a real IFC export
 * can put both lanes of a road under the same IfcPavementType, or even model
 * both sides as one compound product's mesh (e.g. "all accotements" as one
 * part) — so which physical side a piece of geometry is on can only be
 * determined per width sample (see pavementWidthSamples' offset-gap split in
 * ifcGeometry.ts), not once per product or per type name. */
function listPavementGroups(api: IfcAPI, modelID: number, state: StateKind): PavementGroup[] {
  const pavementIds = api.GetLineIDsWithType(modelID, WebIFC.IFCPAVEMENT, true);
  const ids: number[] = [];
  for (let i = 0; i < pavementIds.size(); i++) ids.push(pavementIds.get(i));

  const parentMap = buildParentMap(api, modelID);
  const roadNames = new Map(ids.map((id) => [id, roadAncestorName(api, modelID, id, parentMap)]));
  const hasDualState = ids.some((id) => {
    const n = roadNames.get(id) ?? null;
    return n !== null && matchesState(n, "existant") !== matchesState(n, "projet");
  });

  const groups = new Map<string, PavementGroup>();
  for (const id of ids) {
    if (hasDualState && !matchesState(roadNames.get(id) ?? null, state)) continue;
    const line = api.GetLine(modelID, id) as Record<string, unknown>;
    const typeName = pavementTypeName(api, modelID, line, id);
    if (!groups.has(typeName)) groups.set(typeName, { typeName, expressIds: [] });
    groups.get(typeName)!.expressIds.push(id);
  }
  return Array.from(groups.values());
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function extractIfcState(
  api: IfcAPI,
  modelID: number,
  state: StateKind,
  axis: AxisReference,
  typeMapping: Map<string, [Side, ElementType]> = new Map(),
): { bands: Band[]; samples: WidthSample[] } {
  const groups = listPavementGroups(api, modelID, state);

  const bands: Band[] = [];
  const samples: WidthSample[] = [];
  for (const group of groups) {
    const allSamples: PlanWidthSample[] = [];
    for (const id of group.expressIds) {
      pushAll(allSamples, pavementWidthSamples(api, modelID, id, axis));
    }

    const bySide = new Map<Side, PlanWidthSample[]>();
    for (const s of allSamples) {
      if (!bySide.has(s.side)) bySide.set(s.side, []);
      bySide.get(s.side)!.push(s);
    }

    for (const [autoSide, sideSamples] of bySide.entries()) {
      const bandId = `ifc-${state}-${slugify(group.typeName)}-${autoSide}`;
      let side: Side = autoSide;
      let elementType: ElementType;
      let source: SourceMethod;
      let confidence: number;
      if (typeMapping.has(bandId)) {
        [side, elementType] = typeMapping.get(bandId)!;
        source = "recuperation_entrees";
        confidence = 1.0;
      } else {
        [elementType, confidence] = guessElementType(group.typeName);
        source = "recuperation_dxf";
      }

      const widths = sideSamples.map((s) => s.width);
      bands.push({
        band_id: bandId,
        state,
        side,
        element_type: elementType,
        source,
        confidence,
        label_hint: group.typeName,
        sample_count: widths.length,
        width_min: widths.length ? minOf(widths) : null,
        width_max: widths.length ? maxOf(widths) : null,
        width_mean: widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null,
      });
      for (const s of sideSamples) {
        samples.push({
          pk: s.pk,
          side,
          element_type: elementType,
          state,
          width_m: s.width,
          source,
          band_id: bandId,
          near_x: s.near[0],
          near_y: s.near[1],
          far_x: s.far[0],
          far_y: s.far[1],
        });
      }
    }
  }
  return { bands, samples };
}
