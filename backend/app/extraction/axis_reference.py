"""Builds the shared spatial/PK backbone from the mandatory 'Axes + profils'
file. Both the existant and projet extractors (DXF or IFC) calibrate against
this single reference so that PK values line up for the comparison step even
when the two state files don't carry PK information themselves (this is the
best-reference-first strategy the brief calls for on the IFC side)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.extraction.dxf_common import cluster_texts, find_legacy_polylines, load_document, read_texts
from app.extraction.geometry import PolylineIndex


@dataclass
class AxisReference:
    axis: PolylineIndex
    station_to_pk_scale: float
    station_to_pk_offset: float
    confidence: str  # "pk_labels" | "profile_markers" | "relative"

    def station_to_pk(self, station: float) -> float:
        return station * self.station_to_pk_scale + self.station_to_pk_offset

    def pk_to_station(self, pk: float) -> float:
        return (pk - self.station_to_pk_offset) / self.station_to_pk_scale

    def project(self, point: tuple[float, float]) -> tuple[float, float]:
        """Returns (pk, signed_offset). Positive offset = left side (gauche)."""
        station, offset = self.axis.project_point(point)
        return self.station_to_pk(station), offset


def _pick_main_axis(lines: list[list[tuple[float, float]]]) -> list[tuple[float, float]]:
    """The main axis is the longest legacy polyline: in a road cross-section
    export the centerline runs the full corridor length, same as the boundary
    lines, but is conventionally the one closest to the mean of all lines."""
    if not lines:
        raise ValueError("No legacy POLYLINE entities found to serve as axis")
    lengths = [PolylineIndex.from_points(l).length for l in lines]
    max_len = max(lengths)
    candidates = [l for l, length in zip(lines, lengths) if length > 0.9 * max_len]
    if len(candidates) == 1:
        return candidates[0]
    all_pts = np.concatenate([np.asarray(c) for c in candidates], axis=0)
    centroid = all_pts.mean(axis=0)
    best = min(candidates, key=lambda c: float(np.min(np.linalg.norm(np.asarray(c) - centroid, axis=1))))
    return best


def build_axis_reference_from_dxf(path: str, pk_step_hint: float | None = None) -> AxisReference:
    doc = load_document(path)
    lines = find_legacy_polylines(doc)
    axis_pts = _pick_main_axis(lines)
    axis = PolylineIndex.from_points(axis_pts)

    texts = read_texts(doc)
    clusters = cluster_texts(texts)

    # 1) explicit PK/chainage labels, highest confidence
    for cluster in clusters.values():
        values = [(t, t.numeric_value) for t in cluster]
        if len(values) < 3:
            continue
        if all(v is not None and v > 100 for _, v in values):
            stations = [axis.project_point((t.x, t.y))[0] for t, _ in values]
            pks = [v for _, v in values]
            scale, offset = np.polyfit(stations, pks, 1)
            return AxisReference(axis=axis, station_to_pk_scale=float(scale), station_to_pk_offset=float(offset), confidence="pk_labels")

    # 2) sequential profile-number markers (1, 2, 3, ...), spaced at pk_step_hint
    best_cluster = None
    for cluster in clusters.values():
        if len(cluster) < 3:
            continue
        if not all(t.is_pure_int for t in cluster):
            continue
        ints = sorted(int(t.content) for t in cluster)
        if ints == list(range(ints[0], ints[0] + len(ints))):
            if best_cluster is None or len(cluster) > len(best_cluster):
                best_cluster = cluster
    if best_cluster is not None:
        ordered = sorted(best_cluster, key=lambda t: int(t.content))
        stations = [axis.project_point((t.x, t.y))[0] for t in ordered]
        numbers = [int(t.content) for t in ordered]
        if pk_step_hint is None:
            diffs = np.diff(stations)
            pk_step_hint = float(np.median(diffs)) if len(diffs) else 1.0
        pks = [(n - numbers[0]) * pk_step_hint for n in numbers]
        scale, offset = np.polyfit(stations, pks, 1)
        return AxisReference(axis=axis, station_to_pk_scale=float(scale), station_to_pk_offset=float(offset), confidence="profile_markers")

    # 3) fallback: relative station, origin at axis start
    return AxisReference(axis=axis, station_to_pk_scale=1.0, station_to_pk_offset=0.0, confidence="relative")


def build_axis_reference_from_ifc(path: str) -> AxisReference:
    import ifcopenshell

    ifc = ifcopenshell.open(path)
    alignments = ifc.by_type("IfcAlignment")
    if alignments:
        pts = _alignment_polyline(alignments[0])
        if pts is not None and len(pts) >= 2:
            axis = PolylineIndex.from_points(pts)
            return AxisReference(axis=axis, station_to_pk_scale=1.0, station_to_pk_offset=0.0, confidence="profile_markers")

    # Fallback: PCA line through all product vertices, relative station only.
    from app.extraction.ifc_geometry import all_vertices, pca_axis_polyline

    verts = all_vertices(ifc)
    pts = pca_axis_polyline(verts)
    axis = PolylineIndex.from_points(pts)
    return AxisReference(axis=axis, station_to_pk_scale=1.0, station_to_pk_offset=0.0, confidence="relative")


def _alignment_polyline(alignment) -> list[tuple[float, float]] | None:
    """Best-effort extraction of an IfcAlignment's horizontal geometry as a
    polyline. IFC4X3 alignment representations vary a lot between authoring
    tools, so this degrades gracefully to None (caller falls back to PCA)."""
    try:
        import ifcopenshell.util.shape as ifc_shape_util  # noqa: F401
    except Exception:
        pass
    try:
        for rel in getattr(alignment, "IsNestedBy", []) or []:
            for obj in rel.RelatedObjects:
                if obj.is_a("IfcAlignmentHorizontal"):
                    segs = []
                    for seg_rel in getattr(obj, "IsNestedBy", []) or []:
                        segs.extend(seg_rel.RelatedObjects)
                    pts: list[tuple[float, float]] = []
                    for seg in segs:
                        design_params = getattr(seg, "DesignParameters", None)
                        if design_params is not None:
                            sp = design_params.StartPoint
                            pts.append((float(sp[0]), float(sp[1])))
                    if len(pts) >= 2:
                        return pts
    except Exception:
        return None
    return None
