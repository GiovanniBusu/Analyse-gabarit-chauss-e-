"""2D polyline geometry helpers shared by the DXF heuristic extractor and the
axis/PK calibration module. Roads are analysed in plan view, so all geometry
here is 2D (x, y); Z is dropped on purpose.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

Point = tuple[float, float]


@dataclass
class PolylineIndex:
    """A polyline with precomputed cumulative arc-length, used to convert between
    (x, y) points and a 1D station along the line, and to cast perpendicular
    intersections against it."""

    points: np.ndarray  # (N, 2)
    cum_length: np.ndarray  # (N,) cumulative arc length, cum_length[0] == 0

    @classmethod
    def from_points(cls, points: list[Point]) -> "PolylineIndex":
        pts = np.asarray(points, dtype=float)
        if pts.ndim != 2 or pts.shape[0] < 2:
            raise ValueError("A polyline needs at least 2 points")
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        return cls(points=pts, cum_length=cum)

    @property
    def length(self) -> float:
        return float(self.cum_length[-1])

    def project_point(self, point: Point) -> tuple[float, float]:
        """Project `point` onto the polyline. Returns (station, signed_offset).
        signed_offset > 0 means the point is to the left of the line direction
        (standard 2D cross-product convention)."""
        p = np.asarray(point, dtype=float)
        best_dist2 = np.inf
        best_station = 0.0
        best_offset = 0.0
        pts = self.points
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            seg_len2 = float(ab @ ab)
            if seg_len2 < 1e-12:
                continue
            t = float((p - a) @ ab) / seg_len2
            t_clamped = min(1.0, max(0.0, t))
            foot = a + t_clamped * ab
            dist2 = float((p - foot) @ (p - foot))
            if dist2 < best_dist2:
                best_dist2 = dist2
                seg_len = np.sqrt(seg_len2)
                station = self.cum_length[i] + t_clamped * seg_len
                cross = ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])
                offset = cross / seg_len
                best_station = float(station)
                best_offset = float(offset)
        return best_station, best_offset

    def point_and_direction_at_station(self, station: float) -> tuple[np.ndarray, np.ndarray]:
        station = min(max(station, 0.0), self.length)
        idx = int(np.searchsorted(self.cum_length, station, side="right") - 1)
        idx = min(max(idx, 0), len(self.points) - 2)
        a, b = self.points[idx], self.points[idx + 1]
        seg_len = self.cum_length[idx + 1] - self.cum_length[idx]
        direction = (b - a) / seg_len if seg_len > 1e-9 else np.array([1.0, 0.0])
        t = (station - self.cum_length[idx]) / seg_len if seg_len > 1e-9 else 0.0
        point = a + t * (b - a)
        return point, direction

    def intersect_ray(self, origin: np.ndarray, direction: np.ndarray) -> Point | None:
        """Cast an infinite ray (both directions, i.e. a line) from `origin` along
        `direction` and return the closest intersection with this polyline, or
        None if the ray direction is parallel to every segment / no crossing."""
        pts = self.points
        best_point = None
        best_t = np.inf
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            seg_dir = b - a
            denom = direction[0] * seg_dir[1] - direction[1] * seg_dir[0]
            if abs(denom) < 1e-9:
                continue
            diff = a - origin
            t_ray = (diff[0] * seg_dir[1] - diff[1] * seg_dir[0]) / denom
            t_seg = (diff[0] * direction[1] - diff[1] * direction[0]) / denom
            if -1e-6 <= t_seg <= 1 + 1e-6:
                if abs(t_ray) < abs(best_t):
                    best_t = t_ray
                    best_point = origin + t_ray * direction
        if best_point is None:
            return None
        return float(best_point[0]), float(best_point[1])


def perpendicular_direction(direction: np.ndarray) -> np.ndarray:
    return np.array([-direction[1], direction[0]])


def order_lines_by_offset(axis: PolylineIndex, lines: list[list[Point]]) -> list[int]:
    """Return the indices of `lines` ordered by their mean signed offset from
    `axis`, most negative (rightmost) to most positive (leftmost) — or the
    reverse, callers just need a stable left-to-right order across the
    cross-section."""
    mean_offsets = []
    for line in lines:
        idx = PolylineIndex.from_points(line)
        sample_pts = idx.points[:: max(1, len(idx.points) // 20)]
        offsets = [axis.project_point((p[0], p[1]))[1] for p in sample_pts]
        mean_offsets.append(float(np.mean(offsets)))
    return sorted(range(len(lines)), key=lambda i: mean_offsets[i])
