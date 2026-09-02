import { useMemo, useState } from "react";
import "./App.css";
import UploadPanel from "./components/UploadPanel";
import MappingTable from "./components/MappingTable";
import ResultsPanel from "./components/ResultsPanel";
import ComparisonPanel from "./components/ComparisonPanel";
import ThresholdsPanel from "./components/ThresholdsPanel";
import ExportPanel from "./components/ExportPanel";
import { computeRatios } from "./calculations/ratios";
import { compareStates } from "./calculations/comparison";
import { extractInWorker, fileToInput } from "./engine/worker/extractionClient";
import { buildWorkbook } from "./engine/export/excelExport";
import { buildDxf, type DxfExportOptions } from "./engine/export/dxfExport";
import type { Point } from "./engine/geometry";
import type { Band, ElementType, Side, Threshold, UploadRole, WidthSample } from "./types/domain";
import { DEFAULT_DELTA_SEUIL_M, DEFAULT_THRESHOLDS } from "./types/domain";

type Tab = "mapping" | "results" | "comparison" | "thresholds" | "export";

function App() {
  const [files, setFiles] = useState<Partial<Record<UploadRole, File>>>({});
  const [gabarit, setGabarit] = useState("route");
  const [dxfStepM, setDxfStepM] = useState(5.0);
  const [bands, setBands] = useState<Band[]>([]);
  const [samples, setSamples] = useState<WidthSample[]>([]);
  const [axisConfidence, setAxisConfidence] = useState<string | null>(null);
  const [axisPoints, setAxisPoints] = useState<Point[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>(DEFAULT_THRESHOLDS);
  const [deltaSeuilM, setDeltaSeuilM] = useState(DEFAULT_DELTA_SEUIL_M);
  const [tab, setTab] = useState<Tab>("mapping");
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const allThreeUploaded = ["axes_profils", "existant", "projet"].every((r) => files[r as UploadRole]);

  const ratios = useMemo(() => computeRatios(samples, thresholds), [samples, thresholds]);
  const comparisonRows = useMemo(() => compareStates(samples, deltaSeuilM), [samples, deltaSeuilM]);

  const handleFileSelected = (role: UploadRole, file: File) => {
    setFiles((prev) => ({ ...prev, [role]: file }));
    setError(null);
  };

  const handleExtract = async () => {
    if (!files.axes_profils || !files.existant || !files.projet) return;
    setExtracting(true);
    setError(null);
    try {
      const [axesInput, existantInput, projetInput] = await Promise.all([
        fileToInput(files.axes_profils),
        fileToInput(files.existant),
        fileToInput(files.projet),
      ]);
      const res = await extractInWorker(axesInput, existantInput, projetInput, gabarit, dxfStepM);
      setBands(res.bands);
      setSamples(res.samples);
      setAxisConfidence(res.axisConfidence);
      setAxisPoints(res.axisPoints);
      setTab("mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  };

  // Overriding a band's classification is a pure relabel of already-extracted
  // samples, done entirely in the browser — everything downstream (ratios,
  // comparatif, export) runs client-side too, so this never needs the
  // original DXF/IFC files re-parsed, and there is no server to lose state.
  const handleOverride = (bandId: string, side: Side, elementType: ElementType) => {
    setBands((prev) =>
      prev.map((b) =>
        b.band_id === bandId ? { ...b, side, element_type: elementType, source: "menu_deroulant", confidence: 1.0 } : b,
      ),
    );
    setSamples((prev) => prev.map((s) => (s.band_id === bandId ? { ...s, side, element_type: elementType } : s)));
  };

  const handleThresholdsChange = (next: Threshold[], nextDelta: number) => {
    setThresholds(next);
    setDeltaSeuilM(nextDelta);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = async () => {
    try {
      const wb = await buildWorkbook(samples, thresholds, deltaSeuilM, comparisonRows);
      const buffer = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "analyse_gabarit.xlsx");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportDxf = (options: DxfExportOptions) => {
    try {
      const content = buildDxf(samples, thresholds, comparisonRows, options, axisPoints);
      downloadBlob(new Blob([content], { type: "application/dxf" }), "analyse_gabarit.dxf");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Analyse gabarit chaussée</h1>
        <p className="subtitle">Largeurs BAU / voie le long du PK — existant vs projet (DXF / IFC)</p>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <UploadPanel
        onUpload={async (role, file) => handleFileSelected(role, file)}
        uploaded={Object.fromEntries(Object.entries(files).map(([k, f]) => [k, f?.name])) as Partial<Record<UploadRole, string>>}
      />

      <section className="panel">
        <h2>Extraction</h2>
        <div className="extract-controls">
          <label>
            Gabarit routier :
            <select value={gabarit} onChange={(e) => setGabarit(e.target.value)}>
              <option value="route">Route (Accotement/Trottoir/Cycle/Voie)</option>
              <option value="autoroute">Autoroute (Accotement/BAU/Voie/Voie/TPC)</option>
            </select>
          </label>
          <label>
            Pas d'échantillonnage DXF (m) :
            <input
              type="number"
              value={dxfStepM}
              min={1}
              step={1}
              onChange={(e) => setDxfStepM(parseFloat(e.target.value))}
            />
          </label>
          <button disabled={!allThreeUploaded || extracting} onClick={handleExtract}>
            {extracting ? "Extraction en cours…" : "Lancer l'extraction"}
          </button>
        </div>
        {axisConfidence && (
          <p className="help">
            Référence PK : <strong>{axisConfidence}</strong>{" "}
            {axisConfidence === "relative" && "(pas de PK réel trouvé — station relative depuis l'origine)"}
          </p>
        )}
      </section>

      <nav className="tabs">
        {(["mapping", "results", "comparison", "thresholds", "export"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {
              {
                mapping: "Correction manuelle",
                results: "Résultats",
                comparison: "Comparatif",
                thresholds: "Seuils",
                export: "Export",
              }[t]
            }
          </button>
        ))}
      </nav>

      {(tab === "mapping" || tab === "results" || tab === "comparison") && (
        <section className="panel">
          {tab === "mapping" && <MappingTable bands={bands} onOverride={handleOverride} />}
          {tab === "results" && <ResultsPanel ratios={ratios} />}
          {tab === "comparison" && <ComparisonPanel rows={comparisonRows} />}
        </section>
      )}
      {tab === "thresholds" && (
        <ThresholdsPanel thresholds={thresholds} deltaSeuilM={deltaSeuilM} onChange={handleThresholdsChange} />
      )}
      {tab === "export" && <ExportPanel onExportExcel={handleExportExcel} onExportDxf={handleExportDxf} />}
    </div>
  );
}

export default App;
