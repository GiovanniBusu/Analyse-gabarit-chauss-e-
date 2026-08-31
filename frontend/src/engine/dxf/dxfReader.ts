/** Minimal hand-rolled DXF ASCII reader: only the group codes and entity
 * types this app needs (TEXT/MTEXT, legacy POLYLINE+VERTEX, LWPOLYLINE,
 * LAYER table). DXF is a flat stream of (group-code, value) line pairs;
 * entities are delimited by group-code 0. Written by hand rather than
 * pulled from a dependency because the extraction logic depends on exact
 * distinctions (old-style POLYLINE vs fragmented LWPOLYLINE, TEXT
 * color/height/style) that a generic parser may not expose the same way. */

export interface DxfToken {
  code: number;
  value: string;
}

export interface DxfTextEntity {
  kind: "TEXT" | "MTEXT";
  content: string;
  x: number;
  y: number;
  height: number;
  color: number;
  style: string;
  layer: string;
}

export interface DxfPolylineEntity {
  kind: "POLYLINE" | "LWPOLYLINE";
  layer: string;
  points: [number, number][];
}

export interface DxfDocument {
  texts: DxfTextEntity[];
  polylines: DxfPolylineEntity[];
  layerNames: string[];
}

function tokenize(content: string): DxfToken[] {
  const lines = content.split(/\r\n|\r|\n/);
  const tokens: DxfToken[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    tokens.push({ code, value: lines[i + 1].trim() });
  }
  return tokens;
}

function num(tokens: DxfToken[], code: number, fallback = 0): number {
  const t = tokens.find((tk) => tk.code === code);
  return t ? parseFloat(t.value) : fallback;
}

function str(tokens: DxfToken[], code: number, fallback = ""): string {
  const t = tokens.find((tk) => tk.code === code);
  return t ? t.value : fallback;
}

/** MTEXT content (group 1, plus continuation group 3 chunks) can contain
 * formatting codes like \\P (paragraph break) or {\\...;text} — strip the
 * common ones enough to get plain text for our numeric/label matching. */
function mtextPlainText(tokens: DxfToken[]): string {
  const chunks = tokens.filter((t) => t.code === 3).map((t) => t.value);
  const main = tokens.find((t) => t.code === 1);
  if (main) chunks.push(main.value);
  return chunks
    .join("")
    .replace(/\\P/g, "\n")
    .replace(/\{|\}/g, "")
    .replace(/\\[A-Za-z][^;]*;/g, "");
}

function sliceSections(tokens: DxfToken[]): Map<string, DxfToken[]> {
  const sections = new Map<string, DxfToken[]>();
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].code === 0 && tokens[i].value === "SECTION") {
      const nameTok = tokens[i + 1];
      if (nameTok && nameTok.code === 2) {
        const name = nameTok.value;
        const start = i + 2;
        let end = start;
        while (end < tokens.length && !(tokens[end].code === 0 && tokens[end].value === "ENDSEC")) end++;
        sections.set(name, tokens.slice(start, end));
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return sections;
}

/** Splits a section's tokens into per-entity chunks, each starting at a
 * group-code-0 marker (the entity type name) up to (not including) the next one. */
function splitEntities(tokens: DxfToken[]): { type: string; tokens: DxfToken[] }[] {
  const entities: { type: string; tokens: DxfToken[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].code === 0) {
      const type = tokens[i].value;
      let end = i + 1;
      while (end < tokens.length && tokens[end].code !== 0) end++;
      entities.push({ type, tokens: tokens.slice(i + 1, end) });
      i = end;
    } else {
      i++;
    }
  }
  return entities;
}

export function parseDxf(content: string): DxfDocument {
  const tokens = tokenize(content);
  const sections = sliceSections(tokens);

  const layerNames: string[] = [];
  const tablesTokens = sections.get("TABLES") ?? [];
  for (const { type, tokens: t } of splitEntities(tablesTokens)) {
    if (type === "LAYER") layerNames.push(str(t, 2));
  }

  const texts: DxfTextEntity[] = [];
  const polylines: DxfPolylineEntity[] = [];
  const entityTokens = sections.get("ENTITIES") ?? [];
  const rawEntities = splitEntities(entityTokens);

  for (let i = 0; i < rawEntities.length; i++) {
    const { type, tokens: t } = rawEntities[i];
    if (type === "TEXT") {
      texts.push({
        kind: "TEXT",
        content: str(t, 1),
        x: num(t, 10),
        y: num(t, 20),
        height: num(t, 40),
        color: num(t, 62, 256),
        style: str(t, 7),
        layer: str(t, 8),
      });
    } else if (type === "MTEXT") {
      texts.push({
        kind: "MTEXT",
        content: mtextPlainText(t),
        x: num(t, 10),
        y: num(t, 20),
        height: num(t, 40),
        color: num(t, 62, 256),
        style: str(t, 7),
        layer: str(t, 8),
      });
    } else if (type === "LWPOLYLINE") {
      const xs = t.filter((tk) => tk.code === 10).map((tk) => parseFloat(tk.value));
      const ys = t.filter((tk) => tk.code === 20).map((tk) => parseFloat(tk.value));
      const points: [number, number][] = xs.map((x, idx) => [x, ys[idx]]);
      if (points.length >= 2) polylines.push({ kind: "LWPOLYLINE", layer: str(t, 8), points });
    } else if (type === "POLYLINE") {
      const layer = str(t, 8);
      const points: [number, number][] = [];
      let j = i + 1;
      while (j < rawEntities.length && rawEntities[j].type === "VERTEX") {
        const vt = rawEntities[j].tokens;
        points.push([num(vt, 10), num(vt, 20)]);
        j++;
      }
      // rawEntities[j] should be SEQEND; skip the VERTEX/SEQEND entities we just consumed
      i = j; // loop's i++ will move past SEQEND
      if (points.length >= 2) polylines.push({ kind: "POLYLINE", layer, points });
    }
  }

  return { texts, polylines, layerNames };
}
