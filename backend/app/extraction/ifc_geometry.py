"""IFC solid-geometry helpers: turns an IfcPavement's triangulated shell into
width-vs-station samples, per the validated method — project vertices onto the
axis, group them into transversal 'rings' by station proximity, and take each
ring's lateral (perpendicular-to-axis) extent as the width at that PK. Using
the offset span rather than pairing two specific vertices makes this robust
to rings carrying more than two vertices (e.g. a solid with wall thickness
contributing duplicate top/bottom vertices at the same plan position)."""

from __future__ import annotations

import numpy as np
import ifcopenshell
import ifcopenshell.geom

from app.extraction.axis_reference import AxisReference

_SETTINGS = ifcopenshell.geom.settings()
_SETTINGS.set(_SETTINGS.USE_WORLD_COORDS, True)


def shape_vertices(product) -> np.ndarray | None:
    try:
        shape = ifcopenshell.geom.create_shape(_SETTINGS, product)
    except Exception:
        return None
    verts = shape.geometry.verts
    if not verts:
        return None
    arr = np.array(verts, dtype=float).reshape(-1, 3)
    return arr


def all_vertices(
    ifc,
    ifc_class: str = "IfcPavement",
    max_products: int = 500,
    max_vertices: int = 200_000,
) -> np.ndarray:
    """Collects vertices for the PCA fallback axis. Bounded on purpose: this
    only needs enough points to fit a stable direction and a binned
    centerline, not the whole model. Without a cap, a reference file that
    happens to carry no IfcPavement falls through to triangulating *every*
    IfcProduct in the file — on a real full BIM export (as opposed to the
    small synthetic fixtures this was tested against) that is enough
    triangulated geometry to exceed a 512 MB container and get OOM-killed."""
    chunks = []
    total = 0
    for product in ifc.by_type(ifc_class):
        v = shape_vertices(product)
        if v is not None:
            chunks.append(v)
            total += len(v)
        if total >= max_vertices:
            break
    if not chunks:
        count = 0
        for product in ifc.by_type("IfcProduct"):
            v = shape_vertices(product)
            if v is not None:
                chunks.append(v)
                total += len(v)
                count += 1
            if count >= max_products or total >= max_vertices:
                break
    if not chunks:
        raise ValueError("No geometry found in IFC file to build a fallback axis")
    return np.concatenate(chunks, axis=0)


def pca_axis_polyline(verts: np.ndarray, n_bins: int = 40) -> list[tuple[float, float]]:
    """Fallback axis when no IfcAlignment is present: PCA principal direction
    of the point cloud, then bin points along it and take per-bin centroids so
    the resulting polyline follows the corridor's curvature rather than being
    a single straight chord."""
    xy = verts[:, :2]
    centroid = xy.mean(axis=0)
    centered = xy - centroid
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    direction = vt[0]
    projection = centered @ direction
    order = np.argsort(projection)
    proj_sorted = projection[order]
    bins = np.linspace(proj_sorted[0], proj_sorted[-1], n_bins + 1)
    bin_idx = np.clip(np.digitize(projection, bins) - 1, 0, n_bins - 1)
    pts = []
    for b in range(n_bins):
        mask = bin_idx == b
        if mask.any():
            pts.append(tuple(xy[mask].mean(axis=0)))
    if len(pts) < 2:
        raise ValueError("Not enough spread in IFC geometry to derive a fallback axis")
    return pts


def cluster_ring_widths(
    stations: np.ndarray,
    offsets: np.ndarray,
    gap_threshold_m: float = 1.5,
    plausible_range: tuple[float, float] = (0.1, 20.0),
) -> list[tuple[float, float]]:
    """Pure clustering logic, kept separate from IFC shape extraction so it can
    be unit-tested with synthetic (station, offset) pairs. Sorts by station,
    greedily chains vertices into the same ring while consecutive stations are
    closer than `gap_threshold_m`, then takes each ring's offset span (max -
    min) as its width. Rings whose span falls outside `plausible_range` are
    dropped (rejects near-zero noise and cross-ring mismatches)."""
    order = np.argsort(stations, kind="stable")
    stations_sorted = stations[order]
    offsets_sorted = offsets[order]

    groups: list[list[int]] = []
    current = [0]
    for i in range(1, len(stations_sorted)):
        if stations_sorted[i] - stations_sorted[current[-1]] < gap_threshold_m:
            current.append(i)
        else:
            groups.append(current)
            current = [i]
    groups.append(current)

    samples: list[tuple[float, float]] = []
    for group in groups:
        if len(group) < 2:
            continue
        group_offsets = offsets_sorted[group]
        group_stations = stations_sorted[group]
        width = float(group_offsets.max() - group_offsets.min())
        if plausible_range[0] <= width <= plausible_range[1]:
            samples.append((float(group_stations.mean()), width))
    return samples


def pavement_width_samples(
    product,
    axis: AxisReference,
    gap_threshold_m: float = 1.5,
    plausible_range: tuple[float, float] = (0.1, 20.0),
) -> list[tuple[float, float]]:
    """Returns a list of (pk, width_m) for one IfcPavement solid."""
    verts = shape_vertices(product)
    if verts is None or len(verts) < 2:
        return []
    projections = np.array([axis.axis.project_point((v[0], v[1])) for v in verts])
    stations, offsets = projections[:, 0], projections[:, 1]
    pairs = cluster_ring_widths(stations, offsets, gap_threshold_m, plausible_range)
    return [(axis.station_to_pk(station), width) for station, width in pairs]
