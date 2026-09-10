/** Minimal hand-rolled DXF (R12/AC1009) writer: layers, POINT and
 * LWPOLYLINE entities — the same shape backend/app/export/dxf_export.py
 * produces via ezdxf. Written by hand for the same reason as dxfReader.ts:
 * full control, no dependency behavior to second-guess, and it's a small,
 * well-documented text format. */

/** DXF R12 text values predate UTF-8 (readers expect ASCII/ANSI), so
 * writing an accented or non-ASCII character straight through comes back
 * as mojibake in most viewers (confirmed: "réduit" round-tripped through
 * ezdxf as "rÃ©duit"). Transliterating to plain ASCII sidesteps needing
 * either party to agree on an encoding or escape convention. */
function toDxfAscii(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks left behind by NFD (é -> e + ´ -> e)
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=");
}

interface LayerDef {
  name: string;
  color: number;
}

interface PointEntity {
  layer: string;
  x: number;
  y: number;
  color?: number;
}

interface PolylineEntity {
  layer: string;
  points: [number, number][];
  color?: number;
}

interface TextEntity {
  layer: string;
  x: number;
  y: number;
  height: number;
  text: string;
  color?: number;
}

export class DxfWriter {
  private layers = new Map<string, LayerDef>();
  private points: PointEntity[] = [];
  private polylines: PolylineEntity[] = [];
  private texts: TextEntity[] = [];

  ensureLayer(name: string, color = 7): string {
    const safe = name.replace(/[^A-Za-z0-9_-]+/g, "_");
    if (!this.layers.has(safe)) this.layers.set(safe, { name: safe, color });
    return safe;
  }

  addPoint(layer: string, x: number, y: number, color?: number): void {
    this.points.push({ layer, x, y, color });
  }

  /** Legacy POLYLINE (R12), not LWPOLYLINE — the latter is an R2000+ entity
   * requiring AcDbEntity/AcDbPolyline subclass markers this writer doesn't
   * emit. Old-style POLYLINE is also what the rest of this app treats as
   * the robust, unfragmented line entity (see dxfReader.ts / the brief). */
  addPolyline(layer: string, points: [number, number][], color?: number): void {
    if (points.length < 2) return;
    this.polylines.push({ layer, points, color });
  }

  addText(layer: string, x: number, y: number, height: number, text: string, color?: number): void {
    this.texts.push({ layer, x, y, height, text: toDxfAscii(text), color });
  }

  get layerNames(): string[] {
    return Array.from(this.layers.keys());
  }

  /** Extent of every point/polyline vertex written so far — used to anchor
   * the legend below the drawing's own bottom-left corner rather than a
   * fixed, arbitrary coordinate that wouldn't line up with the actual
   * geometry (every export can cover a different area). Text isn't
   * included: the legend's own placement depends on this box, so folding
   * it in would make the anchor shift depending on whether a legend was
   * already added. */
  boundingBox(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    for (const pl of this.polylines) {
      for (const [x, y] of pl.points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }

  toString(): string {
    const lines: string[] = [];
    const emit = (code: number, value: string | number) => {
      lines.push(String(code), String(value));
    };

    emit(0, "SECTION");
    emit(2, "HEADER");
    emit(9, "$ACADVER");
    emit(1, "AC1009");
    emit(0, "ENDSEC");

    emit(0, "SECTION");
    emit(2, "TABLES");
    emit(0, "TABLE");
    emit(2, "LAYER");
    emit(70, this.layers.size);
    for (const { name, color } of this.layers.values()) {
      emit(0, "LAYER");
      emit(2, name);
      emit(70, 0);
      emit(62, color);
      emit(6, "CONTINUOUS");
    }
    emit(0, "ENDTAB");
    emit(0, "ENDSEC");

    emit(0, "SECTION");
    emit(2, "BLOCKS");
    emit(0, "ENDSEC");

    emit(0, "SECTION");
    emit(2, "ENTITIES");
    for (const p of this.points) {
      emit(0, "POINT");
      emit(8, p.layer);
      if (p.color !== undefined) emit(62, p.color);
      emit(10, p.x);
      emit(20, p.y);
      emit(30, 0.0);
    }
    for (const pl of this.polylines) {
      emit(0, "POLYLINE");
      emit(8, pl.layer);
      if (pl.color !== undefined) emit(62, pl.color);
      emit(66, 1); // "entities follow" flag
      emit(70, 0);
      for (const [x, y] of pl.points) {
        emit(0, "VERTEX");
        emit(8, pl.layer);
        emit(10, x);
        emit(20, y);
        emit(30, 0.0);
      }
      emit(0, "SEQEND");
    }
    for (const t of this.texts) {
      emit(0, "TEXT");
      emit(8, t.layer);
      if (t.color !== undefined) emit(62, t.color);
      emit(10, t.x);
      emit(20, t.y);
      emit(30, 0.0);
      emit(40, t.height);
      emit(1, t.text);
    }
    emit(0, "ENDSEC");
    emit(0, "EOF");

    return lines.join("\n") + "\n";
  }
}
