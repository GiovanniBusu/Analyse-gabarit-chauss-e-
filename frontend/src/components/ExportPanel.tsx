import { useState } from "react";
import type { DxfExportOptions } from "../api/client";

interface Props {
  onExportExcel: () => void;
  onExportDxf: (options: DxfExportOptions) => void;
}

export default function ExportPanel({ onExportExcel, onExportDxf }: Props) {
  const [options, setOptions] = useState<DxfExportOptions>({
    include_points: true,
    include_polylines: true,
    include_existant: true,
    include_projet: true,
    include_ratios: false,
    include_comparatif: false,
  });

  const toggle = (key: keyof DxfExportOptions) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  return (
    <section className="panel">
      <h2>Export</h2>
      <div className="export-row">
        <button onClick={onExportExcel}>Exporter Excel (.xlsx)</button>
      </div>
      <div className="export-row">
        <h3>Export DXF</h3>
        <div className="checkbox-grid">
          <label>
            <input type="checkbox" checked={options.include_points} onChange={() => toggle("include_points")} />
            Points
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.include_polylines}
              onChange={() => toggle("include_polylines")}
            />
            Polylignes
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.include_existant}
              onChange={() => toggle("include_existant")}
            />
            Calque Existant
          </label>
          <label>
            <input type="checkbox" checked={options.include_projet} onChange={() => toggle("include_projet")} />
            Calque Projet
          </label>
          <label>
            <input type="checkbox" checked={options.include_ratios} onChange={() => toggle("include_ratios")} />
            Calque Ratios (conformité)
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.include_comparatif}
              onChange={() => toggle("include_comparatif")}
            />
            Calque Comparatif
          </label>
        </div>
        <button onClick={() => onExportDxf(options)}>Exporter DXF</button>
      </div>
    </section>
  );
}
