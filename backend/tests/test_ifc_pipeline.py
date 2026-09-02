import math

from app.extraction.axis_reference import build_axis_reference_from_ifc
from app.extraction.ifc_extractor import extract_ifc_state
from app.models.domain import ElementType, Side, SourceMethod, StateKind


def test_ifc_axis_reference_pca_fallback(tmp_ifc_path):
    axis = build_axis_reference_from_ifc(tmp_ifc_path)
    assert axis.confidence == "relative"
    assert axis.axis.length > 90


def test_extract_ifc_state_widths_and_auto_guess(tmp_ifc_path):
    axis = build_axis_reference_from_ifc(tmp_ifc_path)
    bands, samples = extract_ifc_state(tmp_ifc_path, StateKind.EXISTANT, axis)
    assert len(bands) == 2
    by_hint = {b.label_hint: b for b in bands}

    voie_band = by_hint["Voie Gauche"]
    assert math.isclose(voie_band.width_mean, 8.0, abs_tol=1e-6)
    assert voie_band.side == Side.GAUCHE
    assert voie_band.element_type == ElementType.VOIE
    assert voie_band.source == SourceMethod.RECUPERATION_DXF  # auto-guessed, not user-confirmed

    bau_band = by_hint["BAU Droite"]
    assert math.isclose(bau_band.width_mean, 3.25, abs_tol=1e-6)
    assert bau_band.side == Side.DROITE
    assert bau_band.element_type == ElementType.BAU

    assert all(s.width_m is not None for s in samples)


def test_extract_ifc_state_respects_user_type_mapping(tmp_ifc_path):
    axis = build_axis_reference_from_ifc(tmp_ifc_path)
    mapping = {"ifc-existant-voie_gauche-gauche": (Side.GAUCHE, ElementType.TROTTOIR)}  # deliberately override the auto-guess
    bands, _samples = extract_ifc_state(tmp_ifc_path, StateKind.EXISTANT, axis, type_mapping=mapping)
    by_hint = {b.label_hint: b for b in bands}
    assert by_hint["Voie Gauche"].element_type == ElementType.TROTTOIR
    assert by_hint["Voie Gauche"].source == SourceMethod.RECUPERATION_ENTREES
    assert by_hint["Voie Gauche"].confidence == 1.0
