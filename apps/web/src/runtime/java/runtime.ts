import type { RunRequest, RuntimeWorker, WorkerMessage } from '../contract';
import { OUTPUT_DIR, javaClassPath } from './classPath';
import { LAUNCHER_CLASS, LAUNCHER_SOURCE, deriveEntryClass, sourceFileName } from './launcher';

// Java is the one runtime that does NOT live in a Web Worker.
//
// CheerpJ delivers a console program's stdout by writing into a DOM element,
// and a worker has no DOM. Measured in a browser spike (2026-08-11): the page
// stays responsive while Java runs — timers keep firing during a blocked
// program — so the main thread is a fair place for it. `RuntimeWorker` is our
// own interface, not `Worker`, precisely so this fits behind the same contract.

const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';
const ECJ_MAIN = 'org.eclipse.jdt.internal.compiler.batch.Main';
const STDIN_PATH = '/str/stdin.txt';
/** Java 8 is the only runtime that can compile at all: CheerpJ's 11 and 17
 *  images ship no `jrt-fs.jar`, so no compiler of any version can resolve the
 *  system modules there (measured 2026-08-11; ADR-0017). */
const JAVA_VERSION = 8;
const SOURCE_LEVEL = '-1.8';

const encoder = new TextEncoder();

interface Host {
  /** CheerpJ writes program output into the element with this exact id. */
  console: HTMLElement;
  display: HTMLElement;
}

/**
 * CheerpJ initialises once per page and cannot be unloaded, so the boot is a
 * module-level singleton: two editors on one document share one JVM.
 */
let bootPromise: Promise<Host> | null = null;

function offscreen(id: string): HTMLElement {
  const existing = document.getElementById(id);
  if (existing) return existing;

  const element = document.createElement('div');
  element.id = id;
  // Off-screen rather than display:none — `innerText` needs a rendered element
  // to preserve the line breaks CheerpJ writes.
  element.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;';
  document.body.appendChild(element);
  return element;
}

async function loadCheerpJ(): Promise<void> {
  if (typeof cheerpjInit === 'function') return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHEERPJ_LOADER;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`could not load the Java runtime from ${CHEERPJ_LOADER}`));
    document.head.appendChild(script);
  });
}

async function boot(): Promise<Host> {
  await loadCheerpJ();
  await cheerpjInit({ version: JAVA_VERSION, status: 'none' });

  const host: Host = { console: offscreen('console'), display: offscreen('cheerpjDisplay') };
  cheerpjCreateDisplay(-1, -1, host.display);
  return host;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createJavaRuntime(baseUrl: string): RuntimeWorker {
  const listeners = new Set<(event: MessageEvent<WorkerMessage>) => void>();
  const classPath = javaClassPath(baseUrl);
  let terminated = false;
  // The JVM is one shared machine: runs are serialised so two editors never
  // interleave their output in the console element.
  let queue: Promise<void> = Promise.resolve();

  const emit = (message: WorkerMessage): void => {
    if (terminated) return;
    const event = { data: message } as MessageEvent<WorkerMessage>;
    for (const listener of listeners) listener(event);
  };

  const drain = (host: Host): string => {
    // `textContent`, not `innerText`: the latter reports *rendered* text, which
    // collapses the newlines the compiler uses to line its caret up under the
    // offending token — a diagnostic flattened to one line is useless to a
    // student learning to read them.
    const text = host.console.textContent ?? '';
    host.console.innerHTML = '';
    return text.trim();
  };

  const warmUp = async (): Promise<Host> => {
    const startedAt = performance.now();
    bootPromise ??= boot();
    const host = await bootPromise;
    const initMs = Math.round(performance.now() - startedAt);

    // Compiling the launcher is the warm-up: it pays the compiler's one-off
    // load (~27s measured) before the student ever presses Run, and leaves the
    // launcher class ready for every later run.
    const compileStartedAt = performance.now();
    cheerpjAddStringFile(`/str/${LAUNCHER_CLASS}.java`, encoder.encode(LAUNCHER_SOURCE));
    const exitCode = await cheerpjRunMain(
      ECJ_MAIN,
      classPath,
      `/str/${LAUNCHER_CLASS}.java`,
      '-d',
      OUTPUT_DIR,
      SOURCE_LEVEL,
      '-nowarn',
    );
    const compileMs = Math.round(performance.now() - compileStartedAt);
    const log = drain(host);
    if (exitCode !== 0) {
      throw new Error(`the Java launcher failed to compile: ${log}`);
    }

    emit({ type: 'warm', detail: { initMs, compileMs } });
    return host;
  };

  let warmPromise: Promise<Host> | null = null;

  const execute = async ({ id, source, stdin }: RunRequest): Promise<void> => {
    try {
      warmPromise ??= warmUp();
      const host = await warmPromise;

      const entryClass = deriveEntryClass(source);
      const sourcePath = `/str/${sourceFileName(entryClass)}`;
      cheerpjAddStringFile(sourcePath, encoder.encode(source));
      cheerpjAddStringFile(STDIN_PATH, encoder.encode(stdin));

      const compileStartedAt = performance.now();
      const compileExit = await cheerpjRunMain(
        ECJ_MAIN,
        classPath,
        sourcePath,
        '-d',
        OUTPUT_DIR,
        SOURCE_LEVEL,
        '-nowarn',
      );
      const compileMs = Math.round(performance.now() - compileStartedAt);
      const compileLog = drain(host);

      if (compileExit !== 0) {
        // A rejected program is a result, not a broken runtime.
        emit({
          id,
          type: 'result',
          compileLog,
          output: '',
          exitCode: null,
          compileMs,
          runMs: null,
        });
        return;
      }

      const runStartedAt = performance.now();
      const exitCode = await cheerpjRunMain(LAUNCHER_CLASS, classPath, entryClass);
      const runMs = Math.round(performance.now() - runStartedAt);

      emit({ id, type: 'result', compileLog, output: drain(host), exitCode, compileMs, runMs });
    } catch (error) {
      emit({ id, type: 'error', message: describe(error) });
    }
  };

  return {
    postMessage(message: RunRequest): void {
      queue = queue.then(() => execute(message));
    },
    addEventListener(_type, listener): void {
      listeners.add(listener);
    },
    removeEventListener(_type, listener): void {
      listeners.delete(listener);
    },
    terminate(): void {
      // CheerpJ cannot be unloaded, so this detaches rather than tears down:
      // a later editor reuses the same JVM through `bootPromise`.
      terminated = true;
      listeners.clear();
    },
  };
}
