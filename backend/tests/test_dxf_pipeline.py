import math

from app.extraction.axis_reference import build_axis_reference_from_dxf
from app.extraction.dxf_extractor import extract_dxf_state
from app.models.domain import StateKind


def test_axis_reference_profile_markers(tmp_dxf_paths):
    axis = build_axis_reference_from_dxf(tmp_dxf_paths["axis"], pk_step_hint=20.0)
    assert axis.confidence == "profile_markers"
    assert math.isclose(axis.station_to_pk(0.0), 0.0, abs_tol=1e-6)
    assert math.isclose(axis.station_to_pk(60.0), 60.0, abs_tol=1e-6)


def test_heuristic_band_widths(tmp_dxf_paths):
    axis = build_axis_reference_from_dxf(tmp_dxf_paths["axis"], pk_step_hint=20.0)
    bands, samples, mode = extract_dxf_state(
        tmp_dxf_paths["heuristic"], StateKind.EXISTANT, axis, gabarit="route", step_m=10.0
    )
    assert mode == "heuristic"
    assert len(bands) == 2
    widths_by_band = {b.band_id: b.width_mean for b in bands}
    values = sorted(widths_by_band.values())
    assert math.isclose(values[0], 3.0, abs_tol=1e-6)
    assert math.isclose(values[1], 8.0, abs_tol=1e-6)
    assert all(s.pk is not None for s in samples)


def test_layer_based_extraction(tmp_dxf_paths):
    axis = build_axis_reference_from_dxf(tmp_dxf_paths["axis"], pk_step_hint=20.0)
    bands, samples, mode = extract_dxf_state(tmp_dxf_paths["layers"], StateKind.PROJET, axis)
    assert mode == "layers"
    labels = {(b.label_hint): (b.side, b.element_type, b.width_mean) for b in bands}
    assert math.isclose(labels["COTE-VOIE-G"][2], 8.00, abs_tol=1e-6)
    assert math.isclose(labels["COTE-BAU-D"][2], 3.25, abs_tol=1e-6)
