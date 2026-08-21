import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunRequest, RuntimeWorker, WorkerMessage } from '../../runtime';
import { loadGrammar } from '../../runtime';
import { Benchmark } from './Benchmark';

// Same reasoning as CodeEditor's / Exercise's / PredictOutput's suites:
// CodeMirror's editing surface is not the contract under test here, and its
// contenteditable does not behave in jsdom. The result table, the wire protocol,
// the timeout branch and the authoring guard are what Benchmark promises.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => <textarea readOnly value={value} data-testid="code" />,
}));

const workers: FakeWorker[] = [];

class FakeWorker implements RuntimeWorker {
  readonly posted: RunRequest[] = [];
  private readonly listeners = new Set<(event: MessageEvent<WorkerMessage>) => void>();

  postMessage(message: RunRequest): void {
    this.posted.push(message);
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<WorkerMessage>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent<WorkerMessage>) => void,
  ): void {
    this.listeners.delete(listener);
  }
  terminate(): void {}

  reply(message: WorkerMessage): void {
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<WorkerMessage>);
    }
  }
}

vi.mock('../../runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../runtime')>();
  return {
    ...original,
    loadGrammar: vi.fn(async () => []),
    loadRuntime: vi.fn(async () => ({
      descriptor: {
        id: 'java' as const,
        label: 'Java 8',
        fileName: 'Main.java',
        defaultCode: '',
      },
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    })),
  };
});

const IMPLS = [
  { name: 'sumaCiclo', code: 'public class SumaCiclo {}' },
  { name: 'sumaFormula', code: 'public class SumaFormula {}' },
];

/**
 * Presses Run and answers each pending request with the given ns timing (or a
 * compile failure). Handles warmup + measured runs together — one fixed timing
 * per call keeps the median trivial to reason about. Returns the worker so the
 * caller can inspect what was posted.
 *
 * useRuntime reuses ONE worker across every call (`ensureWorker` returns the
 * existing one), so warmup and measured runs share `workers[0]`; each call is a
 * distinct request with its own id.
 */
async function runAndReplyPerImpl(
  timings: Array<number | 'compile-error'>,
  runsPerImpl: number,
): Promise<FakeWorker> {
  const button = screen.getByRole('button', { name: /^run$/i });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(workers).toHaveLength(1));
  const worker = workers[0]!;
  const expectedPosts = timings.length * runsPerImpl;
  await waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(1));
  // Reply to each request as it arrives; the widget awaits each one before
  // posting the next, so the test cannot simply reply in a loop after the
  // click without letting the widget catch up between replies.
  let replied = 0;
  while (replied < expectedPosts) {
    await waitFor(() => expect(worker.posted.length).toBeGreaterThan(replied));
    const request = worker.posted[replied]!;
    const implIndex = Math.floor(replied / runsPerImpl);
    const timing = timings[implIndex]!;
    worker.reply({ id: request.id, type: 'started' });
    if (timing === 'compile-error') {
      worker.reply({
        id: request.id,
        type: 'result',
        compileLog: 'ERROR: cannot find symbol',
        output: '',
        exitCode: null,
        compileMs: 5,
        runMs: 0,
      });
    } else {
      worker.reply({
        id: request.id,
        type: 'result',
        compileLog: '',
        output: `time_ns:${timing}\nresult:5050\n`,
        exitCode: 0,
        compileMs: 5,
        runMs: 1,
      });
    }
    replied++;
  }
  // Wait for the Run button to be enabled again — the widget's own signal that
  // it has finished collecting results and rendered the table.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /run|run de nuevo/i })).toBeEnabled(),
  );
  return worker;
}

afterEach(() => {
  workers.length = 0;
  vi.mocked(loadGrammar).mockClear();
});

describe('Benchmark', () => {
  it('shows an authoring error when implementations is missing', () => {
    render(<Benchmark />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
  });

  it('shows an authoring error when implementations is empty', () => {
    render(<Benchmark implementations={[]} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
  });

  it('renders one editor per implementation, each seeded with the author\'s source', async () => {
    render(<Benchmark implementations={IMPLS} />);

    const codes = await screen.findAllByTestId('code');
    expect(codes).toHaveLength(2);
    await waitFor(() =>
      expect((codes[0] as HTMLTextAreaElement).value).toContain('public class SumaCiclo'),
    );
    await waitFor(() =>
      expect((codes[1] as HTMLTextAreaElement).value).toContain('public class SumaFormula'),
    );
  });

  it('runs every implementation and prints median/min/max from the times the JVM reported', async () => {
    render(
      <Benchmark
        implementations={IMPLS}
        inputs={[100]}
        defaultInput={100}
        warmupRuns={1}
        measuredRuns={3}
      />,
    );

    // Three measured runs per impl. The median of these three should be the
    // middle value (5 ms for impl 1, 15 ms for impl 2), min the smallest,
    // max the largest.
    // (5_000_000 ns = 5 ms; 15_000_000 ns = 15 ms.)
    const _worker = await runAndReplyPerImpl(
      // impl 1 (warmup + 3 measured all at 5 ms), impl 2 (warmup + 3 measured all at 15 ms)
      [5_000_000, 15_000_000],
      1 /* warmup */ + 3 /* measured */,
    );

    const table = screen.getByRole('table');
    // The impl names appear as row headers.
    expect(table).toHaveTextContent('sumaCiclo');
    expect(table).toHaveTextContent('sumaFormula');
    // 5 ms formatted to one decimal.
    expect(table).toHaveTextContent(/5\.0 ms/);
    expect(table).toHaveTextContent(/15\.0 ms/);
  });

  it('passes N to the JVM on stdin, verbatim, so the algorithm can read it', async () => {
    render(
      <Benchmark
        implementations={[IMPLS[0]!]}
        inputs={[42]}
        defaultInput={42}
        warmupRuns={0}
        measuredRuns={1}
      />,
    );

    const worker = await runAndReplyPerImpl([1_000_000], 1);
    // Every request the widget posts carries `${n}\n` as stdin.
    expect(worker.posted.length).toBeGreaterThan(0);
    for (const request of worker.posted) {
      expect(request.stdin).toBe('42\n');
    }
  });

  it('marks TIMEOUT and continues with the next implementation when a run does not resolve in time', async () => {
    render(
      <Benchmark
        implementations={IMPLS}
        inputs={[100]}
        defaultInput={100}
        warmupRuns={0}
        measuredRuns={1}
        // Long enough that a prompt reply beats it easily, short enough that a
        // test can wait for it in reasonable time.
        timeoutMs={200}
      />,
    );

    const button = screen.getByRole('button', { name: /^run$/i });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    // Deliberately do NOT reply to impl 1's post — let the timeout race win.
    await waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(1));
    // Wait for the widget to give up on impl 1 and post for impl 2 (the timeout
    // is 200 ms so this arrives in the same order of magnitude).
    await waitFor(() => expect(worker.posted.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    // Reply to impl 2 immediately — the widget's timer beats us for impl 1
    // but this reply beats the timer for impl 2.
    const secondRequest = worker.posted[1]!;
    worker.reply({ id: secondRequest.id, type: 'started' });
    worker.reply({
      id: secondRequest.id,
      type: 'result',
      compileLog: '',
      output: 'time_ns:2000000\nresult:5050\n',
      exitCode: 0,
      compileMs: 5,
      runMs: 1,
    });
    await waitFor(() => expect(button).toBeEnabled(), { timeout: 3000 });

    const table = screen.getByRole('table');
    // impl 1 shows TIMEOUT (the row's message column carries the number).
    expect(table).toHaveTextContent(/TIMEOUT/);
    // impl 2 still shows its timing — a timed-out impl does not poison the rest.
    expect(table).toHaveTextContent(/2\.0 ms/);
  });

  it('reports a compile failure on the row itself, instead of hanging or leaving it blank', async () => {
    render(
      <Benchmark
        implementations={[IMPLS[0]!]}
        inputs={[100]}
        defaultInput={100}
        warmupRuns={0}
        measuredRuns={1}
      />,
    );

    await runAndReplyPerImpl(['compile-error'], 1);

    const table = screen.getByRole('table');
    // The compile log the runtime reported reaches the reader — a silent
    // "sin datos" would hide the reason the row is blank.
    expect(table).toHaveTextContent(/ERROR: cannot find symbol/);
  });

  it('lets the reader pick N from the presets, and highlights the chosen one', async () => {
    render(
      <Benchmark
        implementations={[IMPLS[0]!]}
        inputs={[100, 10000, 1000000]}
        defaultInput={100}
        warmupRuns={0}
        measuredRuns={1}
      />,
    );

    // The middle preset is unpressed until we click it.
    const midButton = screen.getByRole('button', { name: /10 K/i });
    expect(midButton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(midButton);
    expect(midButton).toHaveAttribute('aria-pressed', 'true');

    const worker = await runAndReplyPerImpl([1_000_000], 1);
    // The picked N reaches the JVM.
    expect(worker.posted[0]!.stdin).toBe('10000\n');
  });
});
