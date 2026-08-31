import type { ComparisonRow } from "../types/domain";
import { ELEMENT_TYPE_LABELS } from "../types/domain";

interface Props {
  rows: ComparisonRow[];
}

const STATUS_LABEL: Record<string, string> = { ameliore: "Amélioré", inchange: "Inchangé", degrade: "Dégradé" };
const STATUS_CLASS: Record<string, string> = { ameliore: "pct-good", inchange: "", degrade: "pct-bad" };

export default function ComparisonPanel({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="help">Pas de comparatif disponible — nécessite l'existant et le projet.</p>;
  }
  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th>PK</th>
          <th>Côté</th>
          <th>Élément</th>
          <th>Existant (m)</th>
          <th>Projet (m)</th>
          <th>Delta (m)</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.pk.toFixed(1)}</td>
            <td>{r.side === "gauche" ? "Gauche" : "Droite"}</td>
            <td>{ELEMENT_TYPE_LABELS[r.element_type]}</td>
            <td>{r.width_existant?.toFixed(2) ?? "–"}</td>
            <td>{r.width_projet?.toFixed(2) ?? "–"}</td>
            <td>{r.delta?.toFixed(2) ?? "–"}</td>
            <td className={r.status ? STATUS_CLASS[r.status] : ""}>{r.status ? STATUS_LABEL[r.status] : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
