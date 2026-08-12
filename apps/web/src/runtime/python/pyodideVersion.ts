/**
 * The Pyodide build the worker downloads at runtime. The `pyodide` package is a
 * devDependency here for its types only — the runtime itself comes from the CDN
 * — so nothing but `pyodideVersion.test.ts` keeps the two from drifting apart.
 */
// Bumping this is a supply-chain decision, not a routine upgrade: the exact pin
// IS the control (npm cannot republish a version). Re-check the publisher and
// update the accepted-invariant entry in docs/security-notes.md, trigger (b).
export const PYODIDE_VERSION = '314.0.3';

export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
