/** 2D polyline geometry: direct port of backend/app/extraction/geometry.py.
 * All geometry here is plan-view (x, y) — for IFC, callers must pass (x, z)
 * from web-ifc's Y-up output, since that's the plan plane in that frame. */

export type Point = [number, number];

export class PolylineIndex {
  points: Point[];
  cumLength: number[];

  constructor(points: Point[]) {
    if (points.length < 2) throw new Error("A polyline needs at least 2 points");
    this.points = points;
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    this.cumLength = cum;
  }

  get length(): number {
    return this.cumLength[this.cumLength.length - 1];
  }

  /** Returns [station, signedOffset]. offset > 0 = left of the line direction. */
  projectPoint(point: Point): [number, number] {
    let bestDist2 = Infinity;
    let bestStation = 0;
    let bestOffset = 0;
    const [px, py] = point;
    for (let i = 0; i < this.points.length - 1; i++) {
      const [ax, ay] = this.points[i];
      const [bx, by] = this.points[i + 1];
      const abx = bx - ax;
      const aby = by - ay;
      const segLen2 = abx * abx + aby * aby;
      if (segLen2 < 1e-12) continue;
      let t = ((px - ax) * abx + (py - ay) * aby) / segLen2;
      t = Math.min(1, Math.max(0, t));
      const footX = ax + t * abx;
      const footY = ay + t * aby;
      const dx = px - footX;
      const dy = py - footY;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < bestDist2) {
        bestDist2 = dist2;
        const segLen = Math.sqrt(segLen2);
        bestStation = this.cumLength[i] + t * segLen;
        const cross = abx * (py - ay) - aby * (px - ax);
        bestOffset = cross / segLen;
      }
    }
    return [bestStation, bestOffset];
  }

  pointAndDirectionAtStation(stationIn: number): { point: Point; direction: Point } {
    const station = Math.min(Math.max(stationIn, 0), this.length);
    let idx = 0;
    for (let i = 0; i < this.cumLength.length; i++) {
      if (this.cumLength[i] <= station) idx = i;
    }
    idx = Math.min(Math.max(idx, 0), this.points.length - 2);
    const [ax, ay] = this.points[idx];
    const [bx, by] = this.points[idx + 1];
    const segLen = this.cumLength[idx + 1] - this.cumLength[idx];
    const dir: Point = segLen > 1e-9 ? [(bx - ax) / segLen, (by - ay) / segLen] : [1, 0];
    const t = segLen > 1e-9 ? (station - this.cumLength[idx]) / segLen : 0;
    const point: Point = [ax + t * (bx - ax), ay + t * (by - ay)];
    return { point, direction: dir };
  }

  /** Casts an infinite line through `origin` along `direction` and returns the
   * closest intersection with this polyline, or null. */
  intersectRay(origin: Point, direction: Point): Point | null {
    let bestPoint: Point | null = null;
    let bestT = Infinity;
    const [ox, oy] = origin;
    const [dx, dy] = direction;
    for (let i = 0; i < this.points.length - 1; i++) {
      const [ax, ay] = this.points[i];
      const [bx, by] = this.points[i + 1];
      const segDirX = bx - ax;
      const segDirY = by - ay;
      const denom = dx * segDirY - dy * segDirX;
      if (Math.abs(denom) < 1e-9) continue;
      const diffX = ax - ox;
      const diffY = ay - oy;
      const tRay = (diffX * segDirY - diffY * segDirX) / denom;
      const tSeg = (diffX * dy - diffY * dx) / denom;
      if (tSeg >= -1e-6 && tSeg <= 1 + 1e-6) {
        if (Math.abs(tRay) < Math.abs(bestT)) {
          bestT = tRay;
          bestPoint = [ox + tRay * dx, oy + tRay * dy];
        }
      }
    }
    return bestPoint;
  }
}

export function perpendicularDirection([dx, dy]: Point): Point {
  return [-dy, dx];
}

/** Orders `lines` by their mean signed offset from `axis`, ascending
 * (most negative/rightmost first). Returns the reordered index list. */
export function orderLinesByOffset(axis: PolylineIndex, lines: Point[][]): number[] {
  const meanOffsets = lines.map((line) => {
    const idx = new PolylineIndex(line);
    const step = Math.max(1, Math.floor(idx.points.length / 20));
    const offsets: number[] = [];
    for (let i = 0; i < idx.points.length; i += step) {
      offsets.push(axis.projectPoint(idx.points[i])[1]);
    }
    return offsets.reduce((a, b) => a + b, 0) / offsets.length;
  });
  return lines.map((_, i) => i).sort((a, b) => meanOffsets[a] - meanOffsets[b]);
}
