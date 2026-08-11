import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunResult, WorkerMessage } from '../contract';

// The JVM, its launcher and the run queue are module state on purpose — one
// page, one machine — so each test re-imports the module to get a fresh page.
type CreateJavaRuntime = typeof import('./runtime').createJavaRuntime;
let createJavaRuntime: CreateJavaRuntime;

// CheerpJ is three global functions, so the whole module is drivable in jsdom
// even though no JVM exists here. What cannot be faked — that Java actually
// compiles — is verified in a browser (ADR-0017).

interface Invocation {
  mainClass: string;
  args: string[];
}

let invocations: Invocation[];
let consoleEl: HTMLElement;
/** Per-invocation behaviour: writes to the console element, returns an exit code. */
let onRun: (invocation: Invocation) => Promise<number>;

function installCheerpJ(): void {
  invocations = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['cheerpjInit'] = vi.fn(async () => {});
  globals['cheerpjCreateDisplay'] = vi.fn(() => {});
  globals['cheerpjAddStringFile'] = vi.fn(() => {});
  globals['cheerpjRunMain'] = vi.fn(
    async (mainClass: string, _classPath: string, ...args: string[]) => {
      const invocation = { mainClass, args };
      invocations.push(invocation);
      return onRun(invocation);
    },
  );
}

function write(text: string): void {
  consoleEl.textContent = `${consoleEl.textContent ?? ''}${text}`;
}

/** Collects everything a runtime instance emits. */
function listen(worker: ReturnType<typeof createJavaRuntime>): WorkerMessage[] {
  const seen: WorkerMessage[] = [];
  worker.addEventListener('message', (event) => seen.push(event.data));
  return seen;
}

const results = (seen: WorkerMessage[]): (RunResult & { id: number })[] =>
  seen.filter(
    (message): message is Extract<WorkerMessage, { type: 'result' }> => message.type === 'result',
  );

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '';
  installCheerpJ();
  // The launcher compile succeeds and prints nothing by default.
  onRun = async () => 0;
  consoleEl = document.createElement('div');
  consoleEl.id = 'console';
  document.body.appendChild(consoleEl);
  ({ createJavaRuntime } = await import('./runtime'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createJavaRuntime', () => {
  it('reports a failed compile as a result, not as a broken runtime', async () => {
    // Only the student's compile fails — the launcher's warm-up compile must
    // still succeed, or we would be testing a broken runtime instead.
    onRun = async ({ mainClass, args }) => {
      const compilingStudentCode =
        mainClass.includes('jdt') && !args.some((arg) => arg.endsWith('NalandaLauncher.java'));
      if (compilingStudentCode) {
        write('ERROR: cannot convert from String to int');
        return -1;
      }
      return 0;
    };

    const worker = createJavaRuntime('/');
    const seen = listen(worker);
    worker.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });

    await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
    const result = results(seen)[0]!;
    // ADR-0017: exitCode null means "the program never ran", and the compiler's
    // own message is what the student needs to read.
    expect(result.exitCode).toBeNull();
    expect(result.compileLog).toContain('cannot convert');
    expect(result.runMs).toBeNull();
    expect(seen.some((message) => message.type === 'error')).toBe(false);
  });

  it('returns the program output and exit code of a successful run', async () => {
    onRun = async ({ mainClass }) => {
      if (mainClass === 'NalandaLauncher') {
        write('hola');
        return 0;
      }
      return 0;
    };

    const worker = createJavaRuntime('/');
    const seen = listen(worker);
    worker.postMessage({ id: 7, source: 'public class Main {}', stdin: '' });

    await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
    expect(results(seen)[0]).toMatchObject({ id: 7, output: 'hola', exitCode: 0 });
  });

  it('serialises runs across editors so their output never crosses', async () => {
    // The regression that motivated this file: with a per-editor queue, editor A
    // received editor B's output.
    onRun = async ({ mainClass, args }) => {
      if (mainClass !== 'NalandaLauncher') return 0;
      const tag = args[0] ?? '?';
      write(`<${tag}`);
      await Promise.resolve();
      await Promise.resolve();
      write(`${tag}>`);
      return 0;
    };

    const a = createJavaRuntime('/');
    const b = createJavaRuntime('/');
    const seenA = listen(a);
    const seenB = listen(b);

    a.postMessage({ id: 1, source: 'public class Alpha { }', stdin: '' });
    b.postMessage({ id: 2, source: 'public class Beta { }', stdin: '' });

    await vi.waitFor(() => {
      expect(results(seenA)).toHaveLength(1);
      expect(results(seenB)).toHaveLength(1);
    });

    expect(results(seenA)[0]!.output).toBe('<AlphaAlpha>');
    expect(results(seenB)[0]!.output).toBe('<BetaBeta>');
  });

  it('boots the JVM once for every editor on the page', async () => {
    const a = createJavaRuntime('/');
    const b = createJavaRuntime('/');
    listen(a);
    listen(b);

    a.postMessage({ id: 1, source: 'public class A {}', stdin: '' });
    b.postMessage({ id: 2, source: 'public class B {}', stdin: '' });

    await vi.waitFor(() =>
      expect(invocations.filter((i) => i.mainClass === 'NalandaLauncher')).toHaveLength(2),
    );
    const launcherCompiles = invocations.filter((i) =>
      i.args.some((arg) => arg.endsWith('NalandaLauncher.java')),
    );
    expect(launcherCompiles).toHaveLength(1);
  });

  it('retries a failed boot instead of remembering it forever', async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    let attempts = 0;
    globals['cheerpjInit'] = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('CDN unreachable');
    });

    const worker = createJavaRuntime('/');
    const seen = listen(worker);

    worker.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'error')).toBe(true));

    // A transient CDN failure must not poison the page until a reload.
    worker.postMessage({ id: 2, source: 'public class Main {}', stdin: '' });
    await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
    expect(attempts).toBe(2);
  });

  it('stops emitting once terminated', async () => {
    const worker = createJavaRuntime('/');
    const seen = listen(worker);
    worker.terminate();

    worker.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toHaveLength(0);
  });
});
