import type { ComparisonRow, ComparisonStatus } from "../types/domain";
import { ELEMENT_TYPE_LABELS, STATE_LABELS } from "../types/domain";

interface Props {
  rows: ComparisonRow[];
}

const STATUS_LABEL: Record<ComparisonStatus, string> = { ameliore: "Amélioré", inchange: "Inchangé", degrade: "Dégradé" };
const STATUS_CLASS: Record<ComparisonStatus, string> = { ameliore: "pct-good", inchange: "", degrade: "pct-bad" };

function DeltaCell({ delta, status }: { delta?: number | null; status?: ComparisonStatus | null }) {
  return (
    <>
      <td>{delta?.toFixed(2) ?? "–"}</td>
      <td className={status ? STATUS_CLASS[status] : ""}>{status ? STATUS_LABEL[status] : "–"}</td>
    </>
  );
}

export default function ComparisonPanel({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="help">Pas de comparatif disponible — nécessite au moins l'existant et le projet V0.</p>;
  }
  const hasV1 = rows.some((r) => r.width_projet_v1 != null);
  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th rowSpan={2}>PK</th>
          <th rowSpan={2}>Côté</th>
          <th rowSpan={2}>Élément</th>
          <th colSpan={3}>Largeurs (m)</th>
          <th colSpan={2}>{STATE_LABELS.existant} → {STATE_LABELS.projet}</th>
          {hasV1 && <th colSpan={2}>{STATE_LABELS.projet} → {STATE_LABELS.projet_v1}</th>}
          {hasV1 && <th colSpan={2}>{STATE_LABELS.existant} → {STATE_LABELS.projet_v1}</th>}
        </tr>
        <tr>
          <th>{STATE_LABELS.existant}</th>
          <th>{STATE_LABELS.projet}</th>
          <th>{STATE_LABELS.projet_v1}</th>
          <th>Delta</th>
          <th>Statut</th>
          {hasV1 && <th>Delta</th>}
          {hasV1 && <th>Statut</th>}
          {hasV1 && <th>Delta</th>}
          {hasV1 && <th>Statut</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.pk.toFixed(1)}</td>
            <td>{r.side === "gauche" ? "Gauche" : "Droite"}</td>
            <td>{ELEMENT_TYPE_LABELS[r.element_type]}</td>
            <td>{r.width_existant?.toFixed(2) ?? "–"}</td>
            <td>{r.width_projet_v0?.toFixed(2) ?? "–"}</td>
            <td>{r.width_projet_v1?.toFixed(2) ?? "–"}</td>
            <DeltaCell delta={r.delta_existant_v0} status={r.status_existant_v0} />
            {hasV1 && <DeltaCell delta={r.delta_v0_v1} status={r.status_v0_v1} />}
            {hasV1 && <DeltaCell delta={r.delta_existant_v1} status={r.status_existant_v1} />}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
