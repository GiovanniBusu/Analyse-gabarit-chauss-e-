/** Client-side port of backend/app/export/excel_export.py using exceljs.
 * Only raw values are written; every ratio and comparatif delta/statut is a
 * live Excel formula referencing the Seuils tab, exactly like the Python
 * version — editing a threshold recalculates the whole workbook. */

import ExcelJS from "exceljs";
import type { ComparisonRow, ElementType, Side, StateKind, Threshold, WidthSample } from "../../types/domain";
import { STATE_LABELS } from "../../types/domain";
import { ACI, ACI_STATUS, SERIES_COLOR, aciToArgb, contrastTextArgb } from "./colorScheme";
import type { LogEntry } from "../log";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
const INPUT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const AMELIORE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
const DEGRADE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
// Same rouge/orange/vert convention as the DXF Ratios layer (dxfExport.ts'
// classify()): < réduit / [réduit, standard) / >= standard.
const SOUS_REDUIT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
const ENTRE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
const STANDARD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true };

/** Header cell colored to match a state/ratio/statut's own DXF color — a
 * solid fill instead of colored text on a plain background, since text-only
 * coloring was hard to tell apart between close hues ("je ne vois pas la
 * différence entre les couleurs trop proches"). */
function colorFill(cell: ExcelJS.Cell, aci: number): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: aciToArgb(aci) } };
  cell.font = { ...HEADER_FONT, color: { argb: contrastTextArgb(aci) } };
}

const SIDE_LABEL: Record<Side, string> = { gauche: "Gauche", droite: "Droite" };
const TYPE_LABEL: Record<ElementType, string> = {
  non_utilise: "Non utilisé",
  accotement: "Accotement",
  trottoir: "Trottoir",
  bau: "BAU",
  cycle: "Cycle",
  voie: "Voie",
  tpc: "TPC",
};

const ELEMENT_ORDER: ElementType[] = ["accotement", "trottoir", "bau", "cycle", "voie", "tpc"];

function groupKeyLabel(side: Side, elementType: ElementType, state: StateKind): string {
  return `${SIDE_LABEL[side]} - ${TYPE_LABEL[elementType]} - ${STATE_LABELS[state]}`;
}

function colLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

export async function buildWorkbook(
  samples: WidthSample[],
  thresholds: Threshold[],
  deltaSeuilM: number,
  comparisonRows: ComparisonRow[],
  log: LogEntry[] = [],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();

  // "Non utilisé" bands are explicitly outside the gabarit analysis scope
  // (see dxfExport.ts) — excluded here for the same reason, so they don't
  // clutter Données/Résultats/Comparatif with columns nobody asked to see.
  const relevantSamples = samples.filter((s) => s.element_type !== "non_utilise");

  // Row of each element type on the Seuils sheet, fixed by ELEMENT_ORDER —
  // computed up front (independent of the sheet itself) so Données' per-cell
  // color coding can reference the same threshold cells the Seuils sheet
  // will contain, without having to build that sheet first.
  const thresholdCellByType = new Map<ElementType, [string, string]>();
  ELEMENT_ORDER.forEach((et, i) => {
    const row = 2 + i;
    thresholdCellByType.set(et, [`Seuils!$B$${row}`, `Seuils!$C$${row}`]);
  });

  const groups = new Map<string, Map<number, number>>();
  const groupMeta = new Map<string, [Side, ElementType, StateKind]>();
  for (const s of relevantSamples) {
    if (s.width_m == null) continue;
    const key = `${s.side}|${s.element_type}|${s.state}`;
    if (!groups.has(key)) {
      groups.set(key, new Map());
      groupMeta.set(key, [s.side, s.element_type, s.state]);
    }
    groups.get(key)!.set(s.pk, s.width_m);
  }
  const masterPks = Array.from(new Set(Array.from(groups.values()).flatMap((m) => Array.from(m.keys())))).sort(
    (a, b) => a - b,
  );
  const groupKeys = Array.from(groups.keys()).sort();

  const donneesWs = wb.addWorksheet("Données");
  const columnOfGroup = new Map<string, number>();
  {
    const headerCell = donneesWs.getCell(1, 1);
    headerCell.value = "PK";
    headerCell.font = HEADER_FONT;
    headerCell.fill = HEADER_FILL;
    groupKeys.forEach((key, i) => {
      const col = 2 + i;
      columnOfGroup.set(key, col);
      const [side, et, state] = groupMeta.get(key)!;
      const cell = donneesWs.getCell(1, col);
      cell.value = groupKeyLabel(side, et, state);
      // Same color as this band's DXF layer (SERIES_COLOR), so the two
      // exports read as one system instead of two independent palettes.
      colorFill(cell, SERIES_COLOR[state]);
      donneesWs.getColumn(col).width = 22;
    });
    masterPks.forEach((pk, rowIdx) => {
      const row = rowIdx + 2;
      donneesWs.getCell(row, 1).value = pk;
      for (const key of groupKeys) {
        const width = groups.get(key)!.get(pk);
        if (width !== undefined) donneesWs.getCell(row, columnOfGroup.get(key)!).value = width;
      }
    });
    donneesWs.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

    // Same rouge/orange/vert code as the DXF Ratios layer, applied directly
    // to each width cell so the two exports read the same way at a glance.
    if (masterPks.length > 0) {
      const lastRow = 1 + masterPks.length;
      for (const key of groupKeys) {
        const [, et] = groupMeta.get(key)!;
        const thresholdCells = thresholdCellByType.get(et);
        if (!thresholdCells) continue;
        const [reduitCell, standardCell] = thresholdCells;
        const col = colLetter(columnOfGroup.get(key)!);
        const ref = `${col}2:${col}${lastRow}`;
        donneesWs.addConditionalFormatting({
          ref,
          rules: [
            { type: "expression", formulae: [`AND($${col}2<>"",$${col}2<${reduitCell})`], style: { fill: SOUS_REDUIT_FILL }, priority: 1 },
            {
              type: "expression",
              formulae: [`AND($${col}2<>"",$${col}2>=${reduitCell},$${col}2<${standardCell})`],
              style: { fill: ENTRE_FILL },
              priority: 2,
            },
            { type: "expression", formulae: [`AND($${col}2<>"",$${col}2>=${standardCell})`], style: { fill: STANDARD_FILL }, priority: 3 },
          ],
        });
      }
    }
  }

  const seuilsWs = wb.addWorksheet("Seuils");
  let deltaCell = "Seuils!$B$1";
  {
    seuilsWs.getCell(1, 1).value = "Élément";
    seuilsWs.getCell(1, 2).value = "Réduit (m)";
    seuilsWs.getCell(1, 3).value = "Standard (m)";
    for (let c = 1; c <= 3; c++) seuilsWs.getCell(1, c).font = HEADER_FONT;
    const thresholdByType = new Map(thresholds.map((t) => [t.element_type, t]));
    let row = 2;
    for (const et of ELEMENT_ORDER) {
      const t = thresholdByType.get(et);
      seuilsWs.getCell(row, 1).value = TYPE_LABEL[et];
      const reduitCell = seuilsWs.getCell(row, 2);
      const standardCell = seuilsWs.getCell(row, 3);
      reduitCell.value = t ? t.reduit_m : null;
      standardCell.value = t ? t.standard_m : null;
      reduitCell.fill = INPUT_FILL;
      standardCell.fill = INPUT_FILL;
      thresholdCellByType.set(et, [`Seuils!$B$${row}`, `Seuils!$C$${row}`]);
      row++;
    }
    row++;
    seuilsWs.getCell(row, 1).value = "Seuil de variation significative (m)";
    const deltaInput = seuilsWs.getCell(row, 2);
    deltaInput.value = deltaSeuilM;
    deltaInput.fill = INPUT_FILL;
    deltaCell = `Seuils!$B$${row}`;
    seuilsWs.getColumn(1).width = 32;
    seuilsWs.getColumn(2).width = 14;
    seuilsWs.getColumn(3).width = 14;
  }

  const resultatsWs = wb.addWorksheet("Résultats");
  {
    const headers = ["Côté", "Élément", "État", "N", "< Réduit %", "≥ Réduit < Standard %", "≥ Standard %"];
    // The last three headers are literally the Ratios classification (see
    // dxfExport.ts's classify()) — same colors as that DXF layer.
    const headerColor: Record<number, number> = {
      4: ACI.RATIO_SOUS_REDUIT,
      5: ACI.RATIO_ENTRE,
      6: ACI.RATIO_STANDARD,
    };
    headers.forEach((h, i) => {
      const cell = resultatsWs.getCell(1, i + 1);
      cell.value = h;
      if (i in headerColor) colorFill(cell, headerColor[i]);
      else {
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
      }
    });
    let row = 2;
    for (const key of groupKeys) {
      const [side, et, state] = groupMeta.get(key)!;
      const thresholdCells = thresholdCellByType.get(et);
      if (!thresholdCells || masterPks.length === 0) continue;
      const col = colLetter(columnOfGroup.get(key)!);
      const dataRange = `Données!$${col}$2:$${col}$${1 + masterPks.length}`;
      const [reduitCell, standardCell] = thresholdCells;

      resultatsWs.getCell(row, 1).value = SIDE_LABEL[side];
      resultatsWs.getCell(row, 2).value = TYPE_LABEL[et];
      resultatsWs.getCell(row, 3).value = STATE_LABELS[state];
      resultatsWs.getCell(row, 4).value = { formula: `COUNT(${dataRange})` };
      resultatsWs.getCell(row, 5).value = {
        formula: `IFERROR(COUNTIFS(${dataRange},"<"&${reduitCell})/COUNT(${dataRange})*100,0)`,
      };
      resultatsWs.getCell(row, 6).value = {
        formula: `IFERROR(COUNTIFS(${dataRange},">="&${reduitCell},${dataRange},"<"&${standardCell})/COUNT(${dataRange})*100,0)`,
      };
      resultatsWs.getCell(row, 7).value = {
        formula: `IFERROR(COUNTIFS(${dataRange},">="&${standardCell})/COUNT(${dataRange})*100,0)`,
      };
      row++;
    }
    for (let c = 1; c <= 7; c++) resultatsWs.getColumn(c).width = 18;
  }

  if (comparisonRows.length > 0) {
    const comparatifWs = wb.addWorksheet("Comparatif");
    // Two header rows: row 1 groups columns (which pair of states a delta
    // compares, or "Largeurs" for the three raw widths), row 2 names the
    // individual column — spelling out "PK/Côté/Élément" once each spanning
    // both rows so an apprentice reading left to right sees "Existant vs
    // Projet V0" as one block instead of guessing which delta pairs with
    // which statut from bare column headers.
    const fixedCols: [string, number][] = [
      ["PK", 1],
      ["Côté", 2],
      ["Élément", 3],
    ];
    fixedCols.forEach(([label, col]) => {
      comparatifWs.mergeCells(1, col, 2, col);
      const cell = comparatifWs.getCell(1, col);
      cell.value = label;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
    });

    comparatifWs.mergeCells(1, 4, 1, 6);
    const largeursHeader = comparatifWs.getCell(1, 4);
    largeursHeader.value = "Largeurs (m)";
    largeursHeader.font = HEADER_FONT;
    largeursHeader.fill = HEADER_FILL;
    const widthSubHeaders: [number, StateKind][] = [
      [4, "existant"],
      [5, "projet"],
      [6, "projet_v1"],
    ];
    widthSubHeaders.forEach(([col, state]) => {
      const cell = comparatifWs.getCell(2, col);
      cell.value = STATE_LABELS[state];
      colorFill(cell, SERIES_COLOR[state]);
    });

    const pairGroups: [string, number, number][] = [
      [`${STATE_LABELS.existant} → ${STATE_LABELS.projet}`, 7, 8],
      [`${STATE_LABELS.projet} → ${STATE_LABELS.projet_v1}`, 9, 10],
      [`${STATE_LABELS.existant} → ${STATE_LABELS.projet_v1}`, 11, 12],
    ];
    pairGroups.forEach(([label, colStart, colEnd]) => {
      comparatifWs.mergeCells(1, colStart, 1, colEnd);
      const groupCell = comparatifWs.getCell(1, colStart);
      groupCell.value = label;
      groupCell.font = HEADER_FONT;
      groupCell.fill = HEADER_FILL;
      const deltaCellHeader = comparatifWs.getCell(2, colStart);
      deltaCellHeader.value = "Delta (m)";
      deltaCellHeader.font = HEADER_FONT;
      deltaCellHeader.fill = HEADER_FILL;
      const statutCellHeader = comparatifWs.getCell(2, colEnd);
      statutCellHeader.value = "Statut";
      statutCellHeader.font = HEADER_FONT;
      statutCellHeader.fill = HEADER_FILL;
    });

    const sorted = [...comparisonRows].sort((a, b) => (a.side + a.element_type).localeCompare(b.side + b.element_type) || a.pk - b.pk);
    const statutFormula = (deltaColLetter: string, r: number) =>
      `IF(${deltaColLetter}${r}="","",IF(${deltaColLetter}${r}>${deltaCell},"Amélioré",IF(${deltaColLetter}${r}<-${deltaCell},"Dégradé","Inchangé")))`;
    sorted.forEach((row, i) => {
      const r = i + 3;
      comparatifWs.getCell(r, 1).value = row.pk;
      comparatifWs.getCell(r, 2).value = SIDE_LABEL[row.side];
      comparatifWs.getCell(r, 3).value = TYPE_LABEL[row.element_type];
      comparatifWs.getCell(r, 4).value = row.width_existant ?? null;
      comparatifWs.getCell(r, 5).value = row.width_projet_v0 ?? null;
      comparatifWs.getCell(r, 6).value = row.width_projet_v1 ?? null;
      // D=Existant, E=Projet V0, F=Projet V1.
      comparatifWs.getCell(r, 7).value = { formula: `IF(OR(D${r}="",E${r}=""),"",E${r}-D${r})` };
      comparatifWs.getCell(r, 8).value = { formula: statutFormula("G", r) };
      comparatifWs.getCell(r, 9).value = { formula: `IF(OR(E${r}="",F${r}=""),"",F${r}-E${r})` };
      comparatifWs.getCell(r, 10).value = { formula: statutFormula("I", r) };
      comparatifWs.getCell(r, 11).value = { formula: `IF(OR(D${r}="",F${r}=""),"",F${r}-D${r})` };
      comparatifWs.getCell(r, 12).value = { formula: statutFormula("K", r) };
    });

    const lastRow = 2 + sorted.length;
    if (lastRow >= 3) {
      for (const statutCol of ["H", "J", "L"]) {
        comparatifWs.addConditionalFormatting({
          ref: `${statutCol}3:${statutCol}${lastRow}`,
          rules: [
            { type: "expression", formulae: [`$${statutCol}3="Amélioré"`], style: { fill: AMELIORE_FILL }, priority: 1 },
            { type: "expression", formulae: [`$${statutCol}3="Dégradé"`], style: { fill: DEGRADE_FILL }, priority: 2 },
          ],
        });
      }
    }

    // Synthèse par côté + élément — une ligne globale (toutes bandes
    // confondues) ne dit pas si c'est le BAU gauche ou le trottoir droit qui
    // s'est dégradé ; ces COUNTIFS filtrent par Côté (colonne B) et Élément
    // (colonne C) en plus du Statut de chaque comparaison, comme les autres
    // formules de ce classeur — live, pas figées.
    const synthCol = 14;
    comparatifWs.mergeCells(1, synthCol, 2, synthCol);
    comparatifWs.getCell(1, synthCol).value = "Côté";
    comparatifWs.mergeCells(1, synthCol + 1, 2, synthCol + 1);
    comparatifWs.getCell(1, synthCol + 1).value = "Élément";
    [synthCol, synthCol + 1].forEach((c) => {
      const cell = comparatifWs.getCell(1, c);
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
    });

    const statusKeys: ["ameliore", "inchange", "degrade"] = ["ameliore", "inchange", "degrade"];
    const statusLabelOf: Record<(typeof statusKeys)[number], "Amélioré" | "Inchangé" | "Dégradé"> = {
      ameliore: "Amélioré",
      inchange: "Inchangé",
      degrade: "Dégradé",
    };
    const synthPairGroups: [string, string][] = [
      [`${STATE_LABELS.existant} → ${STATE_LABELS.projet}`, "H"],
      [`${STATE_LABELS.projet} → ${STATE_LABELS.projet_v1}`, "J"],
      [`${STATE_LABELS.existant} → ${STATE_LABELS.projet_v1}`, "L"],
    ];
    const sideCol = colLetter(2);
    const typeCol = colLetter(3);
    let synthStart = synthCol + 2;
    for (const [label] of synthPairGroups) {
      comparatifWs.mergeCells(1, synthStart, 1, synthStart + 2);
      const groupCell = comparatifWs.getCell(1, synthStart);
      groupCell.value = label;
      groupCell.font = HEADER_FONT;
      groupCell.fill = HEADER_FILL;
      statusKeys.forEach((statusKey, j) => {
        const cell = comparatifWs.getCell(2, synthStart + j);
        cell.value = statusLabelOf[statusKey];
        colorFill(cell, ACI_STATUS[statusKey]);
      });
      synthStart += 3;
    }

    const synthKeys = Array.from(
      new Set(sorted.map((r) => `${r.side}|${r.element_type}`)),
    ).map((k) => k.split("|") as [Side, ElementType]);
    synthKeys.forEach(([side, et], i) => {
      const r = i + 3;
      comparatifWs.getCell(r, synthCol).value = SIDE_LABEL[side];
      comparatifWs.getCell(r, synthCol + 1).value = TYPE_LABEL[et];
      let col = synthCol + 2;
      for (const [, statutColLetter] of synthPairGroups) {
        statusKeys.forEach((statusKey) => {
          comparatifWs.getCell(r, col).value = {
            formula: `COUNTIFS($${sideCol}$3:$${sideCol}$${lastRow},"${SIDE_LABEL[side]}",$${typeCol}$3:$${typeCol}$${lastRow},"${TYPE_LABEL[et]}",$${statutColLetter}$3:$${statutColLetter}$${lastRow},"${statusLabelOf[statusKey]}")`,
          };
          col++;
        });
      }
    });

    for (let c = 1; c <= synthCol + 1 + synthPairGroups.length * 3; c++) comparatifWs.getColumn(c).width = 16;
    comparatifWs.getColumn(1).width = 10;
  }

  if (log.length > 0) {
    // A persistent, printable record of everything the extraction had to
    // guess or found missing — the DXF/IFC files disappear once the
    // workbook is filed away, this sheet doesn't.
    const journalWs = wb.addWorksheet("Journal");
    const headers = ["Fichier concerné", "Ce que l'outil a dû deviner ou n'a pas trouvé"];
    headers.forEach((h, i) => {
      const cell = journalWs.getCell(1, i + 1);
      cell.value = h;
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
    });
    log.forEach((entry, i) => {
      const r = i + 2;
      journalWs.getCell(r, 1).value = entry.context;
      journalWs.getCell(r, 2).value = entry.message;
      journalWs.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    });
    journalWs.getColumn(1).width = 30;
    journalWs.getColumn(2).width = 110;
  }

  return wb;
}
