import { useState } from "react";
import type { UploadRole } from "../types/domain";

interface Props {
  onUpload: (role: UploadRole, file: File) => Promise<void>;
  uploaded: Partial<Record<UploadRole, string>>;
}

const SLOTS: { role: UploadRole; label: string; help: string }[] = [
  {
    role: "axes_profils",
    label: "1. Axes + profils",
    help: "Base de calcul obligatoire : axe et calibration PK (DXF ou IFC)",
  },
  { role: "existant", label: "2. Existant", help: "État actuel de la route (DXF ou IFC)" },
  { role: "projet", label: "3. Projet", help: "État projeté à comparer (DXF ou IFC)" },
];

export default function UploadPanel({ onUpload, uploaded }: Props) {
  const [busy, setBusy] = useState<UploadRole | null>(null);

  const handleChange = async (role: UploadRole, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(role);
    try {
      await onUpload(role, file);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel">
      <h2>Fichiers obligatoires</h2>
      <div className="upload-grid">
        {SLOTS.map((slot) => (
          <div key={slot.role} className={`upload-slot ${uploaded[slot.role] ? "filled" : ""}`}>
            <strong>{slot.label}</strong>
            <p className="help">{slot.help}</p>
            <input
              type="file"
              accept=".dxf,.ifc"
              disabled={busy === slot.role}
              onChange={(e) => handleChange(slot.role, e)}
            />
            {uploaded[slot.role] && <span className="filename">✓ {uploaded[slot.role]}</span>}
            {busy === slot.role && <span className="filename">Envoi…</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
