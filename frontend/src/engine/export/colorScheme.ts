/** Single source of truth for the colors used across both exports (DXF and
 * Excel) — defined once here instead of as separate, hand-picked palettes
 * in dxfExport.ts and excelExport.ts, which could silently drift apart
 * (exactly the "cohérence entre les couleurs du dxf et du xls" the user
 * asked for). Colors are standard AutoCAD Color Index (ACI) codes, since
 * the DXF side needs an ACI number either way; aciToArgb converts the ones
 * actually used here to an ARGB hex string for ExcelJS font/fill colors.
 *
 * One color per *state* only (not per side): gauche/droite used to each get
 * their own shade of the same hue (e.g. blue vs cyan for Existant), which
 * read as near-identical at a glance — exactly the "couleurs trop proches"
 * complaint. Three states now get three clearly distinct hues instead. */

import type { ComparisonStatus, StateKind } from "../../types/domain";

export const ACI = {
  AXE: 7,
  EXISTANT: 5, // blue
  PROJET_V0: 3, // green
  PROJET_V1: 6, // magenta
  RATIO_SOUS_REDUIT: 1,
  RATIO_ENTRE: 30, // true orange — ACI 2 is yellow, not orange, so it can't double as this
  RATIO_STANDARD: 3,
  STATUS_AMELIORE: 3,
  STATUS_INCHANGE: 8,
  STATUS_DEGRADE: 1,
  JOURNAL: 1, // red — deliberately reused from STATUS_DEGRADE to read as "attention"
} as const;

export const SERIES_COLOR: Record<StateKind, number> = {
  existant: ACI.EXISTANT,
  projet: ACI.PROJET_V0,
  projet_v1: ACI.PROJET_V1,
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
  6: "FF00FF", // magenta
  7: "000000", // white on a CAD viewer's black background; black on Excel's white one
  8: "808080", // gray
  30: "FF7F00", // orange
};

/** ARGB hex (ExcelJS font/fill color format) for an ACI code used above. */
export function aciToArgb(aci: number): string {
  return `FF${ACI_RGB[aci] ?? "000000"}`;
}

/** Black or white ARGB, whichever reads clearly on top of a cell filled with
 * this ACI color — used for Excel header text, since a fixed font color
 * (the previous approach: colored text on a plain white cell) is exactly
 * the low-contrast look the user asked to move away from. Hand-picked per
 * color rather than computed from a luminance formula: a generic weighted
 * formula (e.g. ITU-R BT.601) puts pure green and orange right on the
 * threshold between black and white, which is exactly backwards from how
 * they actually read in practice (green and orange both want black text,
 * same as yellow and cyan; saturated red/blue/magenta want white). */
const CONTRAST_TEXT: Record<number, string> = {
  1: "FFFFFFFF", // red
  2: "FF000000", // yellow
  3: "FF000000", // green
  4: "FF000000", // cyan
  5: "FFFFFFFF", // blue
  6: "FFFFFFFF", // magenta
  7: "FFFFFFFF", // black
  8: "FFFFFFFF", // gray
  30: "FF000000", // orange
};

export function contrastTextArgb(aci: number): string {
  return CONTRAST_TEXT[aci] ?? "FFFFFFFF";
}
