/** Single source of truth for the colors used across both exports (DXF and
 * Excel) — defined once here instead of as separate, hand-picked palettes
 * in dxfExport.ts and excelExport.ts, which could silently drift apart
 * (exactly the "cohérence entre les couleurs du dxf et du xls" the user
 * asked for). Colors are standard AutoCAD Color Index (ACI) codes, since
 * the DXF side needs an ACI number either way; aciToArgb converts the ones
 * actually used here to an ARGB hex string for ExcelJS font/fill colors. */

import type { ComparisonStatus, Side, StateKind } from "../../types/domain";

export const ACI = {
  AXE: 7,
  EXISTANT_GAUCHE: 5,
  EXISTANT_DROITE: 4,
  PROJET_GAUCHE: 3,
  PROJET_DROITE: 2,
  RATIO_SOUS_REDUIT: 1,
  RATIO_ENTRE: 30, // true orange — ACI 2 is yellow, not orange, so it can't double as this
  RATIO_STANDARD: 3,
  STATUS_AMELIORE: 3,
  STATUS_INCHANGE: 8,
  STATUS_DEGRADE: 1,
} as const;

export const SERIES_COLOR: Record<StateKind, Record<Side, number>> = {
  existant: { gauche: ACI.EXISTANT_GAUCHE, droite: ACI.EXISTANT_DROITE },
  projet: { gauche: ACI.PROJET_GAUCHE, droite: ACI.PROJET_DROITE },
};

export const ACI_STATUS: Record<ComparisonStatus, number> = {
  ameliore: ACI.STATUS_AMELIORE,
  degrade: ACI.STATUS_DEGRADE,
  inchange: ACI.STATUS_INCHANGE,
};

// RGB for the specific ACI codes this app draws with — not the full 256-color
// AutoCAD table, just enough to render the same hue in Excel.
const ACI_RGB: Record<number, string> = {
  1: "FF0000", // red
  2: "FFFF00", // yellow
  3: "00FF00", // green
  4: "00FFFF", // cyan
  5: "0000FF", // blue
  7: "000000", // white on a CAD viewer's black background; black on Excel's white one
  8: "808080", // gray
  30: "FF7F00", // orange
};

/** ARGB hex (ExcelJS font/fill color format) for an ACI code used above. */
export function aciToArgb(aci: number): string {
  return `FF${ACI_RGB[aci] ?? "000000"}`;
}
