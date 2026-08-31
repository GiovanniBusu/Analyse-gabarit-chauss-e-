import math

import numpy as np

from app.extraction.ifc_extractor import guess_element_type
from app.extraction.ifc_geometry import cluster_ring_widths, pca_axis_polyline
from app.models.domain import ElementType


def test_cluster_ring_widths_groups_by_station_and_spans_offsets():
    # Rings every 10m, left edge offset 0, right edge offset 3 -> width 3.0.
    # A third vertex per ring (offset 1.5, e.g. a duplicated Z point at the
    # same plan position) must not change the computed span.
    stations, offsets = [], []
    for s in range(0, 51, 10):
        stations.extend([s, s, s])
        offsets.extend([0.0, 1.5, 3.0])
    stations = np.array(stations, dtype=float)
    offsets = np.array(offsets, dtype=float)
    pairs = cluster_ring_widths(stations, offsets, gap_threshold_m=1.5, plausible_range=(0.1, 20.0))
    assert len(pairs) == 6
    for _station, width in pairs:
        assert math.isclose(width, 3.0, abs_tol=1e-9)


def test_cluster_ring_widths_rejects_out_of_range():
    stations = np.array([0, 0, 10, 10], dtype=float)
    offsets = np.array([0.0, 0.001, 0.0, 50.0], dtype=float)
    pairs = cluster_ring_widths(stations, offsets, gap_threshold_m=1.5, plausible_range=(0.1, 20.0))
    assert pairs == []  # both the near-zero and the oversized span are filtered out


def test_pca_axis_polyline_follows_spread():
    rng = np.random.default_rng(0)
    xs = np.linspace(0, 100, 200)
    ys = rng.normal(0, 0.05, size=200)
    verts = np.stack([xs, ys, np.zeros_like(xs)], axis=1)
    pts = pca_axis_polyline(verts, n_bins=20)
    assert len(pts) >= 15
    span = max(p[0] for p in pts) - min(p[0] for p in pts)
    assert span > 90


def test_guess_element_type_keyword_hints_are_low_confidence():
    element_type, confidence = guess_element_type("BAU-Gauche")
    assert element_type == ElementType.BAU
    assert confidence < 0.5
    element_type, confidence = guess_element_type("Trotoir")  # brief's known-misleading case
    assert element_type == ElementType.TROTTOIR
    assert confidence < 0.5
