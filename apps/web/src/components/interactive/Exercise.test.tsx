import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { draftKey, readDraft, saveDraft } from './draft';
import type { RunRequest, RuntimeWorker, WorkerMessage } from '../../runtime';
import { Exercise } from './Exercise';

// Same reasoning as CodeEditor's suite: CodeMirror's contenteditable does not
// behave in jsdom, and it is not the contract under test. What Exercise promises
// is the verdict — which cases ran, which passed, and what stays hidden until
// they do.
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
    loadRuntime: vi.fn(async () => ({
      descriptor: {
        id: 'java' as const,
        label: 'Java 8',
        fileName: 'Main.java',
        defaultCode: '',
      },
      codeMirrorLanguage: () => [],
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    })),
  };
});

/** What the MDX pipeline hands the component for ```` ```java <meta> ````. */
function fence(meta: string, code: string): ReactNode {
  return (
    <pre>
      <code className="language-java" data-meta={meta}>
        {code}
      </code>
    </pre>
  );
}

const STARTER = 'class Solution { static boolean esPar(int n) { return false; } }';
const CASES = 'check(Solution.esPar(4), true);\ncheck(Solution.esPar(7), false);';

function renderExercise(children?: ReactNode) {
  return render(
    <Exercise title="¿Es par?">
      {children ?? (
        <>
          <p>Devuelve true si el número es par.</p>
          {fence('starter', STARTER)}
          {fence('test', CASES)}
        </>
      )}
    </Exercise>,
  );
}

/** Presses Comprobar and answers with what the harness printed. */
async function checkWith(output: string, exitCode: number | null = 0) {
  // Comprobar stays disabled until the runtime module has loaded, and clicking a
  // disabled button silently does nothing.
  const button = screen.getByRole('button', { name: /comprobar/i });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(workers).toHaveLength(1));
  const worker = workers[0]!;
  await waitFor(() => expect(worker.posted).toHaveLength(1));
  worker.reply({ id: worker.posted[0]!.id, type: 'started' });
  worker.reply({
    id: worker.posted[0]!.id,
    type: 'result',
    compileLog: exitCode === null ? 'ERROR: cannot find symbol' : '',
    output,
    exitCode,
    compileMs: 10,
    runMs: 5,
  });
  // The result arrives through a promise, so the render it causes lands a tick
  // later; asserting before that reads the DOM mid-run.
  await waitFor(() => expect(screen.getByRole('button', { name: /comprobar/i })).toBeEnabled());
  return worker;
}

/** This environment has no usable localStorage of its own; drafts need one. */
function fakeStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Exercise', () => {
  it('renders the statement and seeds the editor with the starter', async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue(STARTER));
    expect(screen.getByText('Devuelve true si el número es par.')).toBeInTheDocument();
    expect(screen.getByText('¿Es par?')).toBeInTheDocument();
  });

  it('never renders the starter twice — the fence itself is not shown', async () => {
    const { container } = renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toHaveValue(STARTER));
    // The code belongs in the editor. A fence left in the flow would show the
    // starter a second time and, worse, the cases before the student has run.
    expect(container.querySelector('code[data-meta]')).toBeNull();
  });

  it('hides the cases until the first run, then shows them', async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    expect(screen.queryByText(/los casos que se probaron/i)).not.toBeInTheDocument();

    await checkWith('[nalanda] PASS 1\n[nalanda] PASS 2\n');
    expect(screen.getByText(/los casos que se probaron/i)).toBeInTheDocument();
  });

  it("sends the student's code as the source and the cases as the harness", async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    const worker = await checkWith('[nalanda] PASS 1\n');

    const request = worker.posted[0]!;
    expect(request.source).toBe(STARTER);
    // The cases must reach the compiler inside the generated class, never as
    // part of the file the student can edit.
    expect(request.harness).toContain('check(Solution.esPar(4), true);');
    expect(request.source).not.toContain('check(');
  });

  it('reports how many cases passed', async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    await checkWith('[nalanda] PASS 1\n[nalanda] FAIL 2 :: false :: true\n');

    expect(screen.getByText('1 de 2 casos')).toBeInTheDocument();
    expect(screen.getByText(/caso 2/)).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it("keeps the student's own printing separate from the verdicts", async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    await checkWith('estoy depurando\n[nalanda] PASS 1\n');

    expect(screen.getByText('estoy depurando')).toBeInTheDocument();
    expect(screen.getByText('1 de 1 caso')).toBeInTheDocument();
  });

  it('shows a compile error as diagnostics and reports no cases', async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    await checkWith('', null);

    expect(screen.getByText(/cannot find symbol/)).toBeInTheDocument();
    expect(screen.queryByText(/de 2 casos/)).not.toBeInTheDocument();
  });

  it('surfaces an exception without losing the cases that ran first', async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    await checkWith('[nalanda] PASS 1\n[nalanda] ERROR :: java.lang.ArithmeticException\n');

    expect(screen.getByText('1 de 1 caso')).toBeInTheDocument();
    expect(screen.getByText(/ArithmeticException/)).toBeInTheDocument();
  });

  it('tells the author when the starter fence is missing', () => {
    renderExercise(<p>enunciado sin código</p>);
    expect(screen.getByText(/sin bloque/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comprobar/i })).not.toBeInTheDocument();
  });

  // A Java loop that never ends freezes the tab for good (ADR-0017). The freeze
  // is accepted; losing the student's work to it is not.
  describe('draft', () => {
    const key = () => draftKey(`${globalThis.location?.pathname ?? ''}#¿Es par?`, STARTER);

    it('restores what the student had, instead of the starter', async () => {
      saveDraft(key(), 'class Solution { /* mi intento */ }');
      renderExercise();
      await waitFor(() =>
        expect(screen.getByTestId('code')).toHaveValue('class Solution { /* mi intento */ }'),
      );
    });

    it('saves the editor before the run, not after it', async () => {
      renderExercise();
      await waitFor(() => expect(screen.getByTestId('code')).toHaveValue(STARTER));
      expect(readDraft(key())).toBeNull();

      const button = screen.getByRole('button', { name: /comprobar/i });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);

      // Posted and never answered: that IS the frozen tab. Asserting after the
      // round trip proves nothing, because by then both orderings have saved —
      // the earlier version of this test passed with the save moved after the
      // run, which is the one placement that never happens when Java hangs.
      await waitFor(() => expect(workers).toHaveLength(1));
      await waitFor(() => expect(workers[0]!.posted).toHaveLength(1));
      expect(readDraft(key())).toBe(STARTER);
    });

    it('forgets the draft when the student resets', async () => {
      saveDraft(key(), 'un intento anterior');
      renderExercise();
      await waitFor(() => expect(screen.getByTestId('code')).toHaveValue('un intento anterior'));

      await userEvent.click(screen.getByRole('button', { name: /reiniciar/i }));
      expect(readDraft(key())).toBeNull();
      expect(screen.getByTestId('code')).toHaveValue(STARTER);
    });
  });

  it('says the run is waiting for another editor rather than standing silent', async () => {
    renderExercise();
    const button = screen.getByRole('button', { name: /comprobar/i });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    await waitFor(() => expect(worker.posted).toHaveLength(1));

    // Warm: the JVM booted for an editor above this one, so "preparando el
    // runtime" would be a lie. The run is behind that editor's — 4.8s of
    // measured silence with a spinner and no explanation (PER-2).
    worker.reply({ type: 'warm', detail: {} });
    expect(await screen.findByText(/esperando/i)).toBeInTheDocument();

    worker.reply({ id: worker.posted[0]!.id, type: 'started' });
    await waitFor(() => expect(screen.queryByText(/esperando/i)).not.toBeInTheDocument());
  });

  it('loads no runtime until the student asks for one', async () => {
    renderExercise();
    await waitFor(() => expect(screen.getByTestId('code')).toBeInTheDocument());
    // ADR-0001 pays for laziness with multi-megabyte toolchains: rendering an
    // exercise must not download a compiler.
    expect(workers).toHaveLength(0);
  });
});
