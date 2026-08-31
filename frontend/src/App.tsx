import { useEffect, useState } from "react";
import "./App.css";
import * as api from "./api/client";
import type { DxfExportOptions } from "./api/client";
import UploadPanel from "./components/UploadPanel";
import MappingTable from "./components/MappingTable";
import ResultsPanel from "./components/ResultsPanel";
import ComparisonPanel from "./components/ComparisonPanel";
import ThresholdsPanel from "./components/ThresholdsPanel";
import ExportPanel from "./components/ExportPanel";
import type { Band, ComparisonRow, ElementType, RatioResult, Side, Threshold, UploadRole } from "./types/domain";

type Tab = "mapping" | "results" | "comparison" | "thresholds" | "export";

function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Partial<Record<UploadRole, string>>>({});
  const [gabarit, setGabarit] = useState("route");
  const [dxfStepM, setDxfStepM] = useState(5.0);
  const [bands, setBands] = useState<Band[]>([]);
  const [axisConfidence, setAxisConfidence] = useState<string | null>(null);
  const [ratios, setRatios] = useState<RatioResult[]>([]);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [deltaSeuilM, setDeltaSeuilM] = useState(0.05);
  const [tab, setTab] = useState<Tab>("mapping");
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    api
      .createProject()
      .then((id) => {
        setProjectId(id);
        return api.getThresholds(id);
      })
      .then((t) => {
        setThresholds(t.thresholds);
        setDeltaSeuilM(t.delta_seuil_m);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const allThreeUploaded = ["axes_profils", "existant", "projet"].every((r) => uploaded[r as UploadRole]);

  const handleUpload = async (role: UploadRole, file: File) => {
    if (!projectId) return;
    try {
      await api.uploadFile(projectId, role, file);
      setUploaded((prev) => ({ ...prev, [role]: file.name }));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleExtract = async () => {
    if (!projectId) return;
    setExtracting(true);
    setError(null);
    try {
      const res = await api.extract(projectId, gabarit, dxfStepM);
      setBands(res.bands);
      setAxisConfidence(res.axis_confidence);
      const [resultsRes, comparisonRes] = await Promise.all([
        api.getResults(projectId),
        api.getComparison(projectId),
      ]);
      setRatios(resultsRes.ratios);
      setComparisonRows(comparisonRes.rows);
      setTab("mapping");
    } catch (e) {
      setError(String(e));
    } finally {
      setExtracting(false);
    }
  };

  const handleOverride = async (bandId: string, side: Side, elementType: ElementType) => {
    if (!projectId) return;
    try {
      const updatedBands = await api.overrideBand(projectId, bandId, side, elementType);
      setBands(updatedBands);
      const [resultsRes, comparisonRes] = await Promise.all([
        api.getResults(projectId),
        api.getComparison(projectId),
      ]);
      setRatios(resultsRes.ratios);
      setComparisonRows(comparisonRes.rows);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleThresholdsChange = async (next: Threshold[], nextDelta: number) => {
    setThresholds(next);
    setDeltaSeuilM(nextDelta);
    if (!projectId) return;
    try {
      await api.updateThresholds(projectId, next, nextDelta);
      const [resultsRes, comparisonRes] = await Promise.all([
        api.getResults(projectId),
        api.getComparison(projectId),
      ]);
      setRatios(resultsRes.ratios);
      setComparisonRows(comparisonRes.rows);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleExportExcel = () => {
    if (!projectId) return;
    window.open(api.exportExcelUrl(projectId), "_blank");
  };

  const handleExportDxf = async (options: DxfExportOptions) => {
    if (!projectId) return;
    try {
      const blob = await api.exportDxf(projectId, options);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "analyse_gabarit.dxf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Analyse gabarit chaussée</h1>
        <p className="subtitle">Largeurs BAU / voie le long du PK — existant vs projet (DXF / IFC)</p>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <UploadPanel onUpload={handleUpload} uploaded={uploaded} />

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
