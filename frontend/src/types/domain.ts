export type ElementType =
  | "non_utilise"
  | "accotement"
  | "trottoir"
  | "bau"
  | "cycle"
  | "voie"
  | "tpc";

export type Side = "gauche" | "droite";
export type StateKind = "existant" | "projet";
export type SourceMethod =
  | "entree_manuelle"
  | "menu_deroulant"
  | "recuperation_entrees"
  | "recuperation_dxf";
export type ComparisonStatus = "ameliore" | "inchange" | "degrade";

export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  non_utilise: "Non utilisé",
  accotement: "Accotement",
  trottoir: "Trottoir",
  bau: "BAU",
  cycle: "Cycle",
  voie: "Voie",
  tpc: "TPC",
};

export const SOURCE_LABELS: Record<SourceMethod, string> = {
  entree_manuelle: "Entrée manuelle",
  menu_deroulant: "Menu déroulant",
  recuperation_entrees: "Récupération entrées",
  recuperation_dxf: "Récupération automatique",
};

export const SOURCE_COLORS: Record<SourceMethod, string> = {
  entree_manuelle: "#ffd54f",
  menu_deroulant: "#4fc3f7",
  recuperation_entrees: "#81c784",
  recuperation_dxf: "#e0e0e0",
};

export interface Band {
  band_id: string;
  state: StateKind;
  side: Side;
  element_type: ElementType;
  source: SourceMethod;
  confidence: number;
  label_hint?: string | null;
  sample_count: number;
  width_min?: number | null;
  width_max?: number | null;
  width_mean?: number | null;
}

export interface Threshold {
  element_type: ElementType;
  reduit_m: number;
  standard_m: number;
}

export interface WidthSample {
  pk: number;
  side: Side;
  element_type: ElementType;
  state: StateKind;
  width_m?: number | null;
  source: SourceMethod;
  band_id?: string | null;
  note?: string | null;
  // Plan-view (true x, y) boundary points bounding this band at this PK, for
  // DXF plan reconstruction. Populated only when the extraction method has
  // real boundary geometry to draw from (DXF heuristic mode, IFC) — left null
  // for DXF calque/cote mode, which only ever has a (pk, value) text label,
  // no boundary line to reconstruct a plan curve from.
  near_x?: number | null;
  near_y?: number | null;
  far_x?: number | null;
  far_y?: number | null;
}

export const DEFAULT_THRESHOLDS: Threshold[] = [
  { element_type: "bau", reduit_m: 2.5, standard_m: 3.25 },
  { element_type: "voie", reduit_m: 7.5, standard_m: 8.0 },
  { element_type: "accotement", reduit_m: 1.0, standard_m: 2.5 },
  { element_type: "trottoir", reduit_m: 1.5, standard_m: 2.0 },
  { element_type: "cycle", reduit_m: 1.5, standard_m: 2.0 },
  { element_type: "tpc", reduit_m: 1.0, standard_m: 3.0 },
];

export const DEFAULT_DELTA_SEUIL_M = 0.05;

export interface RatioResult {
  side: Side;
  element_type: ElementType;
  state: StateKind;
  pct_sous_reduit: number;
  pct_entre: number;
  pct_sur_standard: number;
  n_samples: number;
}

export interface ComparisonRow {
  pk: number;
  side: Side;
  element_type: ElementType;
  width_existant?: number | null;
  width_projet?: number | null;
  delta?: number | null;
  status?: ComparisonStatus | null;
  // Plan-view (true x, y) boundary points at this row's PK, for drawing the
  // Comparatif DXF layer "en situation" like Ratios/Existant/Projet — every
  // row's pk exactly matches an original WidthSample's own pk (see
  // compareStates), so these are that sample's own near/far, not a new
  // interpolation.
  near_x?: number | null;
  near_y?: number | null;
  far_x?: number | null;
  far_y?: number | null;
}

export type UploadRole = "axes_profils" | "existant" | "projet";
