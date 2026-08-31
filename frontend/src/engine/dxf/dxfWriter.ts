/** Minimal hand-rolled DXF (R12/AC1009) writer: layers, POINT and
 * LWPOLYLINE entities — the same shape backend/app/export/dxf_export.py
 * produces via ezdxf. Written by hand for the same reason as dxfReader.ts:
 * full control, no dependency behavior to second-guess, and it's a small,
 * well-documented text format. */

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

export class DxfWriter {
  private layers = new Map<string, LayerDef>();
  private points: PointEntity[] = [];
  private polylines: PolylineEntity[] = [];

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

  get layerNames(): string[] {
    return Array.from(this.layers.keys());
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
    emit(0, "ENDSEC");
    emit(0, "EOF");

    return lines.join("\n") + "\n";
  }
}
