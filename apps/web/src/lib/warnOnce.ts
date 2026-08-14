// Render-path warnings repeat every re-render (twice under StrictMode) — one
// per key is what makes them readable instead of a wall.
const warned = new Set<string>();

/** Warns the author once per key, from a render path that runs many times. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
