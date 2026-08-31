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
}

export type UploadRole = "axes_profils" | "existant" | "projet";
