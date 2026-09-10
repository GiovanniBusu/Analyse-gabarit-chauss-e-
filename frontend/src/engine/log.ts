/** Collector for "something was missing or had to be guessed" notices raised
 * while parsing a file — no real PK markers found, a fallback axis method
 * used, geometry excluded as decorative, a profile with no measurable
 * width, etc. The point isn't to log everything the engine does, only the
 * cases where it had to compensate for the source file lacking something a
 * clean export would have (real IfcAlignment/IfcReferent entities, explicit
 * PK labels, a recognizable band layout) — so the person preparing the next
 * export knows exactly what to fix, the same way the "axes IFC" issues
 * diagnosed earlier in this project's life had to be worked out by hand.
 *
 * The engine processes one extraction at a time inside a single Web Worker
 * (see worker/extraction.worker.ts) — never concurrently — so a
 * module-level collector reset at the start of each run is enough; there is
 * no request to thread an instance through every function call. */

export interface LogEntry {
  /** Which uploaded file this notice is about, e.g. "Axe / profils
   * (axe.ifc)" — set once per file via setLogContext, not passed at every
   * call site. */
  context: string;
  message: string;
}

let entries: LogEntry[] = [];
let currentContext = "";

export function resetLog(): void {
  entries = [];
  currentContext = "";
}

export function setLogContext(context: string): void {
  currentContext = context;
}

export function logIssue(message: string): void {
  entries.push({ context: currentContext, message });
}

export function getLog(): LogEntry[] {
  return entries;
}
