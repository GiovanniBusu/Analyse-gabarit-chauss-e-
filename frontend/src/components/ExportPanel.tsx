import { useState } from "react";
import type { DxfExportOptions } from "../engine/export/dxfExport";

interface Props {
  onExportExcel: () => void;
  onExportDxf: (options: DxfExportOptions) => void;
}

export default function ExportPanel({ onExportExcel, onExportDxf }: Props) {
  const [options, setOptions] = useState<DxfExportOptions>({
    includePoints: true,
    includePolylines: true,
    includeExistant: true,
    includeProjet: true,
    includeRatios: false,
    includeComparatif: false,
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
            <input type="checkbox" checked={options.includePoints} onChange={() => toggle("includePoints")} />
            Points
          </label>
          <label>
            <input type="checkbox" checked={options.includePolylines} onChange={() => toggle("includePolylines")} />
            Polylignes
          </label>
          <label>
            <input type="checkbox" checked={options.includeExistant} onChange={() => toggle("includeExistant")} />
            Calque Existant
          </label>
          <label>
            <input type="checkbox" checked={options.includeProjet} onChange={() => toggle("includeProjet")} />
            Calque Projet
          </label>
          <label>
            <input type="checkbox" checked={options.includeRatios} onChange={() => toggle("includeRatios")} />
            Calque Ratios (conformité)
          </label>
          <label>
            <input type="checkbox" checked={options.includeComparatif} onChange={() => toggle("includeComparatif")} />
            Calque Comparatif
          </label>
        </div>
        <button onClick={() => onExportDxf(options)}>Exporter DXF</button>
      </div>
    </section>
  );
}
