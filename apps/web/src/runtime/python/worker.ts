/// <reference lib="webworker" />
import type { PyodideInterface } from 'pyodide';

import type { RunRequest, WorkerMessage } from '../contract';
import { PYODIDE_CDN } from './pyodideVersion';

// Pyodide ships as a large WASM bundle served from jsDelivr rather than from
// our own origin: it is MPL-2.0 and self-hostable, but hosting it would add
// ~15MB to every deploy. Revisit if offline use or CDN availability ever bites.

let pyodide: PyodideInterface | null = null;

function post(message: WorkerMessage): void {
  postMessage(message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads Pyodide from the CDN. `import()` of a runtime URL has no types of its
 * own, so the shape we rely on is asserted once, here, against the types the
 * devDependency provides.
 */
async function loadPyodideFromCdn(): Promise<PyodideInterface> {
  const module = (await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)) as {
    loadPyodide?: (options: { indexURL: string }) => Promise<PyodideInterface>;
  };
  if (typeof module.loadPyodide !== 'function') {
    throw new Error(`no loadPyodide export at ${PYODIDE_CDN}pyodide.mjs`);
  }
  return module.loadPyodide({ indexURL: PYODIDE_CDN });
}

async function warmUp(): Promise<void> {
  const scriptStart = performance.now();
  const load = loadPyodideFromCdn();
  const initStart = performance.now();
  pyodide = await load;

  post({
    type: 'warm',
    detail: {
      scriptMs: Math.round(initStart - scriptStart),
      initMs: Math.round(performance.now() - initStart),
    },
  });
}

const warmPromise = warmUp();

/** Wires the interpreter's three streams for one run and returns a reader for what it wrote. */
function captureIO(runtime: PyodideInterface, stdin: string): () => string {
  let output = '';
  const append = (line: string): void => {
    output += `${line}\n`;
  };
  runtime.setStdout({ batched: append });
  runtime.setStderr({ batched: append });

  const lines = stdin ? stdin.split('\n') : [];
  let cursor = 0;
  runtime.setStdin({ stdin: () => (cursor < lines.length ? (lines[cursor++] ?? null) : null) });

  return () => output;
}

addEventListener('message', async (event: MessageEvent<RunRequest>) => {
  const { id, source, stdin } = event.data;
  try {
    await warmPromise;
    if (!pyodide) throw new Error('pyodide failed to initialise');

    const readOutput = captureIO(pyodide, stdin);

    const runStart = performance.now();
    let compileLog = '';
    let exitCode = 0;
    try {
      await pyodide.runPythonAsync(source);
    } catch (error) {
      // Python reports syntax and runtime errors the same way; both belong in
      // the diagnostics panel with a non-zero exit, not as a runtime failure.
      compileLog = describe(error);
      exitCode = 1;
    }

    post({
      id,
      type: 'result',
      compileLog,
      output: readOutput(),
      exitCode,
      compileMs: null,
      runMs: Math.round(performance.now() - runStart),
    });
  } catch (error) {
    post({ id, type: 'error', message: describe(error) });
  }
});
