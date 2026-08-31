import type { Band, ElementType, Side } from "../types/domain";
import { ELEMENT_TYPE_LABELS, SOURCE_COLORS, SOURCE_LABELS } from "../types/domain";

const ELEMENT_OPTIONS: ElementType[] = ["non_utilise", "accotement", "trottoir", "bau", "cycle", "voie", "tpc"];
const SIDE_OPTIONS: Side[] = ["gauche", "droite"];

interface Props {
  bands: Band[];
  onOverride: (bandId: string, side: Side, elementType: ElementType) => void;
}

export default function MappingTable({ bands, onOverride }: Props) {
  if (bands.length === 0) {
    return <p className="help">Aucune bande détectée pour le moment — lancez l'extraction.</p>;
  }

  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th>État</th>
          <th>Repère</th>
          <th>Côté</th>
          <th>Élément</th>
          <th>Confiance</th>
          <th>Largeur min / moy / max (m)</th>
          <th>N</th>
        </tr>
      </thead>
      <tbody>
        {bands.map((band) => (
          <tr key={band.band_id}>
            <td>{band.state === "existant" ? "Existant" : "Projet"}</td>
            <td className="label-hint">{band.label_hint ?? band.band_id}</td>
            <td>
              <select
                value={band.side}
                onChange={(e) => onOverride(band.band_id, e.target.value as Side, band.element_type)}
              >
                {SIDE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s === "gauche" ? "Gauche" : "Droite"}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <select
                value={band.element_type}
                onChange={(e) => onOverride(band.band_id, band.side, e.target.value as ElementType)}
              >
                {ELEMENT_OPTIONS.map((et) => (
                  <option key={et} value={et}>
                    {ELEMENT_TYPE_LABELS[et]}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <span
                className="badge"
                style={{ backgroundColor: SOURCE_COLORS[band.source] }}
                title={SOURCE_LABELS[band.source]}
              >
                {Math.round(band.confidence * 100)}%
              </span>
              <div className="badge-label">{SOURCE_LABELS[band.source]}</div>
            </td>
            <td>
              {band.width_min?.toFixed(2) ?? "–"} / {band.width_mean?.toFixed(2) ?? "–"} /{" "}
              {band.width_max?.toFixed(2) ?? "–"}
            </td>
            <td>{band.sample_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
