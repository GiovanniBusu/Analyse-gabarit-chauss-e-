import type { Threshold } from "../types/domain";
import { ELEMENT_TYPE_LABELS } from "../types/domain";

interface Props {
  thresholds: Threshold[];
  deltaSeuilM: number;
  onChange: (thresholds: Threshold[], deltaSeuilM: number) => void;
}

export default function ThresholdsPanel({ thresholds, deltaSeuilM, onChange }: Props) {
  const updateThreshold = (index: number, field: "reduit_m" | "standard_m", value: number) => {
    const next = thresholds.map((t, i) => (i === index ? { ...t, [field]: value } : t));
    onChange(next, deltaSeuilM);
  };

  return (
    <section className="panel">
      <h2>Seuils (éditables)</h2>
      <table className="mapping-table">
        <thead>
          <tr>
            <th>Élément</th>
            <th>Réduit (m)</th>
            <th>Standard (m)</th>
          </tr>
        </thead>
        <tbody>
          {thresholds.map((t, i) => (
            <tr key={t.element_type}>
              <td>{ELEMENT_TYPE_LABELS[t.element_type]}</td>
              <td>
                <input
                  type="number"
                  step="0.05"
                  value={t.reduit_m}
                  onChange={(e) => updateThreshold(i, "reduit_m", parseFloat(e.target.value))}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.05"
                  value={t.standard_m}
                  onChange={(e) => updateThreshold(i, "standard_m", parseFloat(e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="delta-input">
        Seuil de variation significative (m) :
        <input
          type="number"
          step="0.01"
          value={deltaSeuilM}
          onChange={(e) => onChange(thresholds, parseFloat(e.target.value))}
        />
      </label>
    </section>
  );
}
