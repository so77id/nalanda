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

  it('announces the boot cost once per editor, not on every run', async () => {
    const worker = createJavaRuntime('/');
    const seen = listen(worker);

    worker.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });
    await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
    worker.postMessage({ id: 2, source: 'public class Main {}', stdin: '' });
    await vi.waitFor(() => expect(results(seen)).toHaveLength(2));

    // Re-announcing would overwrite the real cost with the ~0ms a warm JVM takes.
    expect(seen.filter((message) => message.type === 'warm')).toHaveLength(1);
  });

  it('fails fast once a run has been abandoned mid-flight', async () => {
    // CheerpJ has no interrupt: an abandoned run keeps the page's only JVM, so
    // every later run must say so instead of waiting out its own deadline.
    const gate: { release: (() => void) | null } = { release: null };
    onRun = async ({ mainClass }) => {
      if (mainClass !== 'NalandaLauncher') return 0;
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return 0;
    };

    const stuck = createJavaRuntime('/');
    listen(stuck);
    stuck.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });
    await vi.waitFor(() => expect(gate.release).not.toBeNull());

    stuck.terminate();

    const later = createJavaRuntime('/');
    const seen = listen(later);
    later.postMessage({ id: 2, source: 'public class Main {}', stdin: '' });

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ type: 'error' });
    expect((seen[0] as { message: string }).message).toMatch(/recarga la página/i);
    gate.release?.();
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

  // An exercise validates a *method*, so the code that calls it cannot live in
  // the student's file: it must compile beside it and own the entry point.
  describe('with a harness', () => {
    const solution = 'class Solution { static int doble(int n) { return n * 2; } }';
    const harness = 'public class NalandaCheck { public static void main(String[] a) {} }';

    /** The ECJ invocation that compiled the student's code. */
    const studentCompile = () =>
      invocations.find(
        (invocation) =>
          invocation.mainClass.includes('jdt') &&
          invocation.args.some((arg) => arg.endsWith('Solution.java')),
      );

    it('compiles the harness alongside the student source', async () => {
      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({ id: 1, source: solution, stdin: '', harness });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      expect(studentCompile()?.args).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Solution.java'),
          expect.stringContaining('NalandaCheck.java'),
        ]),
      );
    });

    it('runs the harness, not the student class', async () => {
      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({ id: 1, source: solution, stdin: '', harness });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      const run = invocations.find((invocation) => invocation.mainClass === 'NalandaLauncher');
      expect(run?.args[0]).toBe('NalandaCheck');
    });

    it('still runs the student class when no harness is given', async () => {
      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      const run = invocations.find((invocation) => invocation.mainClass === 'NalandaLauncher');
      expect(run?.args[0]).toBe('Main');
    });

    it('refuses a student class that would overwrite a platform one', async () => {
      // Both units compile into one output directory, so `public class
      // NalandaLauncher` used to replace the launcher built at warm-up — and
      // since that build is memoised, every editor on the page then ran the
      // student's main. Untouched exercises reported a full pass.
      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({
        id: 1,
        source: 'public class NalandaLauncher { public static void main(String[] a) {} }',
        stdin: '',
        harness,
      });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      expect(results(seen)[0]).toMatchObject({ exitCode: null });
      expect(results(seen)[0]!.compileLog).toMatch(/reservado/i);
      // Nothing was compiled or run: the refusal happens before either.
      expect(invocations.some((one) => one.mainClass === 'NalandaLauncher')).toBe(false);
    });

    it('refuses a student class named after the harness', async () => {
      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({ id: 1, source: 'public class NalandaCheck {}', stdin: '', harness });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      expect(results(seen)[0]!.compileLog).toMatch(/reservado/i);
    });

    it('refuses a student class named after the tracer', async () => {
      // Same hazard as the other two, reached through a different door: a memory
      // diagram compiles NalandaTrace beside the snippet, so a snippet declaring
      // that name would overwrite the class collecting the trace and the diagram
      // would draw whatever the student's version emitted.
      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({ id: 1, source: 'public class NalandaTrace {}', stdin: '', harness });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      expect(results(seen)[0]!.compileLog).toMatch(/reservado/i);
    });

    it('does not wedge the page when an abandoned run finishes anyway', async () => {
      // A route change unmounts every editor, which terminates their workers. If
      // a run was in flight — the ~12s boot is easy to wander off during — that
      // used to mark the JVM wedged forever, though the run completed fine and
      // left it free. Every editor on every document then refused to run.
      const gate: { release: (() => void) | null } = { release: null };
      onRun = async ({ mainClass }) => {
        if (mainClass !== 'NalandaLauncher') return 0;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        return 0;
      };

      const abandoned = createJavaRuntime('/');
      listen(abandoned);
      abandoned.postMessage({ id: 1, source: 'public class Main {}', stdin: '' });
      await vi.waitFor(() => expect(gate.release).not.toBeNull());
      abandoned.terminate();

      // Unlike the wedge case above, this program does finish.
      gate.release?.();
      onRun = async () => 0;

      // `wedged` is read when a run is ENQUEUED, so the abandoned one has to
      // have finished before the next student presses anything.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const later = createJavaRuntime('/');
      const seen = listen(later);
      later.postMessage({ id: 2, source: 'public class Otro {}', stdin: '' });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      expect(seen.some((message) => message.type === 'error')).toBe(false);
    });

    it('reports a harness that fails to compile as a result', async () => {
      // The student renamed their class, so the harness no longer resolves it.
      // That is a compile error to read, not a broken runtime.
      onRun = async ({ mainClass, args }) => {
        if (mainClass.includes('jdt') && args.some((arg) => arg.endsWith('NalandaCheck.java'))) {
          write('ERROR: Solution cannot be resolved');
          return -1;
        }
        return 0;
      };

      const worker = createJavaRuntime('/');
      const seen = listen(worker);
      worker.postMessage({ id: 1, source: 'class Renombrada {}', stdin: '', harness });

      await vi.waitFor(() => expect(results(seen)).toHaveLength(1));
      expect(results(seen)[0]).toMatchObject({ exitCode: null });
      expect(results(seen)[0]!.compileLog).toContain('cannot be resolved');
      expect(seen.some((message) => message.type === 'error')).toBe(false);
    });
  });
});
