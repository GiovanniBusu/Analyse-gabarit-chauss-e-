import type { RatioResult } from "../types/domain";
import { ELEMENT_TYPE_LABELS } from "../types/domain";

interface Props {
  ratios: RatioResult[];
}

export default function ResultsPanel({ ratios }: Props) {
  if (ratios.length === 0) {
    return <p className="help">Pas encore de résultats — lancez l'extraction puis revenez ici.</p>;
  }
  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th>Côté</th>
          <th>Élément</th>
          <th>État</th>
          <th>N</th>
          <th>&lt; Réduit %</th>
          <th>Réduit–Standard %</th>
          <th>&ge; Standard %</th>
        </tr>
      </thead>
      <tbody>
        {ratios.map((r, i) => (
          <tr key={i}>
            <td>{r.side === "gauche" ? "Gauche" : "Droite"}</td>
            <td>{ELEMENT_TYPE_LABELS[r.element_type]}</td>
            <td>{r.state === "existant" ? "Existant" : "Projet"}</td>
            <td>{r.n_samples}</td>
            <td className="pct-bad">{r.pct_sous_reduit.toFixed(1)}%</td>
            <td className="pct-mid">{r.pct_entre.toFixed(1)}%</td>
            <td className="pct-good">{r.pct_sur_standard.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
