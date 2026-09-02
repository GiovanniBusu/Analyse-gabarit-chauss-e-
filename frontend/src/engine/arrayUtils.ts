/** Stack-safe replacements for `Math.min(...arr)` / `Math.max(...arr)` / `arr.push(...other)`.
 * Spreading a large array into function arguments throws "Maximum call
 * stack size exceeded" once it exceeds the JS engine's argument-count limit
 * (observed in practice on real cadwork-exported IFC files with tens of
 * thousands of vertices per pavement solid — synthetic test fixtures never
 * had enough points to hit this). */

export function minOf(values: number[]): number {
  let m = Infinity;
  for (const v of values) if (v < m) m = v;
  return m;
}

export function maxOf(values: number[]): number {
  let m = -Infinity;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function pushAll<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}
