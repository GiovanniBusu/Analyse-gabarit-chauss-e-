/** Port of the AxisReference class in backend/app/extraction/axis_reference.py.
 * Building it (from DXF or IFC) lives in dxf/axisReferenceDxf.ts and
 * ifc/axisReferenceIfc.ts respectively — this file only holds the shared
 * station<->PK conversion and projection used by every extractor. */

import { PolylineIndex, type Point } from "./geometry";

export type AxisConfidence = "pk_labels" | "profile_markers" | "relative";

export class AxisReference {
  axis: PolylineIndex;
  stationToPkScale: number;
  stationToPkOffset: number;
  confidence: AxisConfidence;

  constructor(axis: PolylineIndex, scale: number, offset: number, confidence: AxisConfidence) {
    this.axis = axis;
    this.stationToPkScale = scale;
    this.stationToPkOffset = offset;
    this.confidence = confidence;
  }

  stationToPk(station: number): number {
    return station * this.stationToPkScale + this.stationToPkOffset;
  }

  pkToStation(pk: number): number {
    return (pk - this.stationToPkOffset) / this.stationToPkScale;
  }

  /** Returns [pk, signedOffset]. Positive offset = left side (gauche). */
  project(point: Point): [number, number] {
    const [station, offset] = this.axis.projectPoint(point);
    return [this.stationToPk(station), offset];
  }
}

/** Simple linear regression (least squares), used to fit station->PK from a
 * handful of calibration points — port of numpy.polyfit(x, y, 1). */
export function linearFit(xs: number[], ys: number[]): { scale: number; offset: number } {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  const scale = den < 1e-12 ? 0 : num / den;
  const offset = meanY - scale * meanX;
  return { scale, offset };
}
