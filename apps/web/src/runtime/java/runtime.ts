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

// One JVM per page, so ALL of its state is module-scoped — including the run
// queue. Scoping the queue per editor (as this file first did) leaves two
// editors compiling and running concurrently against one `#console` element and
// one `/files/`, which silently crosses their output: measured, editor A
// printed editor B's result.
let bootPromise: Promise<Host> | null = null;
let launcherPromise: Promise<Host> | null = null;
let queue: Promise<void> = Promise.resolve();
/** What booting actually cost, kept so later editors report it honestly. */
let readyMs = 0;
/** A run was abandoned while the JVM was busy: CheerpJ cannot be interrupted. */
let wedged = false;
let running = false;

/** Memoises a promise but never a rejection, so a transient CDN failure is retried. */
function retryable<T>(
  read: () => Promise<T> | null,
  write: (value: Promise<T> | null) => void,
  start: () => Promise<T>,
): Promise<T> {
  const existing = read();
  if (existing) return existing;
  const started = start().catch((error: unknown) => {
    write(null);
    throw error;
  });
  write(started);
  return started;
}

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

/** Reads and clears whatever the JVM has printed since the last drain. */
function drain(host: Host): string {
  // `textContent`, not `innerText`: the latter reports *rendered* text, which
  // collapses the newlines the compiler uses to line its caret up under the
  // offending token — a diagnostic flattened to one line is useless to a
  // student learning to read them.
  const text = host.console.textContent ?? '';
  host.console.innerHTML = '';
  return text.trim();
}

/**
 * Boots the JVM and compiles the launcher — the one-off ~24s the compiler costs
 * to load. Shared by every editor on the page, and retried rather than
 * remembered if it fails.
 */
async function ensureReady(classPath: string): Promise<Host> {
  const startedAt = performance.now();
  const host = await retryable(
    () => bootPromise,
    (value) => {
      bootPromise = value;
    },
    boot,
  );

  return retryable(
    () => launcherPromise,
    (value) => {
      launcherPromise = value;
    },
    async () => {
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
      const log = drain(host);
      if (exitCode !== 0) {
        throw new Error(`the Java launcher failed to compile: ${log}`);
      }
      readyMs = Math.round(performance.now() - startedAt);
      return host;
    },
  );
}

export function createJavaRuntime(baseUrl: string): RuntimeWorker {
  const listeners = new Set<(event: MessageEvent<WorkerMessage>) => void>();
  const classPath = javaClassPath(baseUrl);
  let terminated = false;

  const emit = (message: WorkerMessage): void => {
    if (terminated) return;
    const event = { data: message } as MessageEvent<WorkerMessage>;
    for (const listener of listeners) listener(event);
  };

  let announced = false;

  const warmUp = async (): Promise<Host> => {
    const host = await ensureReady(classPath);
    // Once per editor, reporting what booting actually cost — not the ~0ms a
    // later editor waits for an already-warm JVM.
    if (!announced) {
      announced = true;
      emit({ type: 'warm', detail: { readyMs } });
    }
    return host;
  };

  const execute = async ({ id, source, stdin }: RunRequest): Promise<void> => {
    if (terminated) return;
    running = true;
    try {
      const host = await warmUp();

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
    } finally {
      running = false;
    }
  };

  return {
    postMessage(message: RunRequest): void {
      if (wedged) {
        // Say so at once rather than making every later run wait out its own
        // deadline and blame an innocent program.
        emit({
          id: message.id,
          type: 'error',
          message:
            'un programa anterior no terminó y dejó ocupada la máquina de Java — recarga la página para volver a ejecutar',
        });
        return;
      }
      // Onto the PAGE's queue, not this editor's: one JVM, one console element,
      // one `/files/` — concurrent runs cross their output.
      queue = queue.then(() => execute(message));
    },
    addEventListener(_type, listener): void {
      listeners.add(listener);
    },
    removeEventListener(_type, listener): void {
      listeners.delete(listener);
    },
    terminate(): void {
      // CheerpJ cannot be unloaded and offers no interrupt, so this detaches
      // rather than tears down. If a run was still going, it holds the page's
      // only JVM forever — record that so later runs fail fast and honestly
      // instead of queueing behind a program that will never finish.
      terminated = true;
      if (running) wedged = true;
      listeners.clear();
    },
  };
}
