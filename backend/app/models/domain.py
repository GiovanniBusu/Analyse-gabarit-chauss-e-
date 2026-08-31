"""Shared domain vocabulary used by every extraction, calculation and export module.

Everything downstream of extraction (ratios, comparison, Excel/DXF export) operates
only on these types, so DXF and IFC extractors are interchangeable: they both produce
a list of WidthSample and a list of Band, nothing else leaks through.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ElementType(str, Enum):
    """Cross-section element categories, matching the 'Entrées' legend of the
    reference Excel workbook. Kept as an open, user-remappable vocabulary rather
    than hard-coded Route/Autoroute cross-section shapes."""

    NON_UTILISE = "non_utilise"
    ACCOTEMENT = "accotement"
    TROTTOIR = "trottoir"
    BAU = "bau"
    CYCLE = "cycle"
    VOIE = "voie"
    TPC = "tpc"


class Side(str, Enum):
    GAUCHE = "gauche"
    DROITE = "droite"


class StateKind(str, Enum):
    EXISTANT = "existant"
    PROJET = "projet"


class SourceMethod(str, Enum):
    """How a value was obtained. Mirrors the 4-level color legend in the reference
    workbook (Entrée manuelle / Menu déroulant / Récupération entrées / Récupération
    dxf) so the UI can render the same confidence badges. RECUPERATION_DXF is kept
    generic and also covers automatic extraction from an IFC source file."""

    ENTREE_MANUELLE = "entree_manuelle"
    MENU_DEROULANT = "menu_deroulant"
    RECUPERATION_ENTREES = "recuperation_entrees"
    RECUPERATION_DXF = "recuperation_dxf"

    @property
    def confidence(self) -> float:
        return {
            SourceMethod.RECUPERATION_ENTREES: 1.0,
            SourceMethod.MENU_DEROULANT: 1.0,
            SourceMethod.ENTREE_MANUELLE: 1.0,
            SourceMethod.RECUPERATION_DXF: 0.6,
        }[self]


class SourceFormat(str, Enum):
    DXF = "dxf"
    IFC = "ifc"


class ComparisonStatus(str, Enum):
    AMELIORE = "ameliore"
    INCHANGE = "inchange"
    DEGRADE = "degrade"


class WidthSample(BaseModel):
    """A single width measurement at one station, for one band, one state."""

    pk: float
    side: Side
    element_type: ElementType
    state: StateKind
    width_m: Optional[float] = None
    source: SourceMethod
    band_id: Optional[str] = None
    note: Optional[str] = None


class Band(BaseModel):
    """A strip between two adjacent cross-section boundary lines (DXF) or a single
    IfcPavement instance (IFC). This is the unit the manual-correction UI acts on:
    the automatic pass classifies the whole band at once (side + element_type),
    and a user override replaces that classification for every sample in the band
    without needing per-PK correction."""

    band_id: str
    state: StateKind
    side: Side
    element_type: ElementType
    source: SourceMethod
    confidence: float
    label_hint: Optional[str] = None  # layer name / IFC type name / heuristic note
    sample_count: int = 0
    width_min: Optional[float] = None
    width_max: Optional[float] = None
    width_mean: Optional[float] = None


class BandOverride(BaseModel):
    band_id: str
    side: Side
    element_type: ElementType


class Threshold(BaseModel):
    element_type: ElementType
    reduit_m: float
    standard_m: float


DEFAULT_THRESHOLDS: list[Threshold] = [
    Threshold(element_type=ElementType.BAU, reduit_m=2.50, standard_m=3.25),
    Threshold(element_type=ElementType.VOIE, reduit_m=7.50, standard_m=8.00),
    Threshold(element_type=ElementType.ACCOTEMENT, reduit_m=1.00, standard_m=2.50),
    Threshold(element_type=ElementType.TROTTOIR, reduit_m=1.50, standard_m=2.00),
    Threshold(element_type=ElementType.CYCLE, reduit_m=1.50, standard_m=2.00),
    Threshold(element_type=ElementType.TPC, reduit_m=1.00, standard_m=3.00),
]

DEFAULT_DELTA_SEUIL_M = 0.05


class RatioResult(BaseModel):
    side: Side
    element_type: ElementType
    state: StateKind
    pct_sous_reduit: float
    pct_entre: float
    pct_sur_standard: float
    n_samples: int


class ComparisonRow(BaseModel):
    pk: float
    side: Side
    element_type: ElementType
    width_existant: Optional[float] = None
    width_projet: Optional[float] = None
    delta: Optional[float] = None
    status: Optional[ComparisonStatus] = None
