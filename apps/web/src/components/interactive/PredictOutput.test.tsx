import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunRequest, RuntimeWorker, WorkerMessage } from '../../runtime';
import { loadGrammar } from '../../runtime';
import { PredictOutput } from './PredictOutput';

// Same reasoning as CodeEditor's and Exercise's suites: CodeMirror's editing
// surface is not the contract under test here, and its contenteditable does not
// behave in jsdom. Panels, the reveal flow and the authoring guard are what
// PredictOutput promises.
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

const SNIPPET = `class Demo {
    public static void main(String[] args) {
        System.out.println("hola");
    }
}
`;

function renderPredict(children?: ReactNode) {
  return render(
    <PredictOutput title="La trampa">
      {children ?? (
        <>
          <p>¿Qué imprime este programa?</p>
          {fence('predict', SNIPPET)}
        </>
      )}
    </PredictOutput>,
  );
}

/**
 * Presses Revelar and answers with what the runtime printed.
 *
 * useRuntime reuses one worker across every call (`ensureWorker` returns the
 * existing one), so a second reveal posts to the SAME FakeWorker and this
 * helper indexes off the pre-click post count instead of assuming a fresh
 * one — see the "run again" case.
 */
async function revealWith(output: string, exitCode: number | null = 0) {
  const button = screen.getByRole('button', { name: /revelar|volver a ejecutar/i });
  await waitFor(() => expect(button).toBeEnabled());
  const priorPosts = workers[0]?.posted.length ?? 0;
  await userEvent.click(button);
  await waitFor(() => expect(workers).toHaveLength(1));
  const worker = workers[0]!;
  await waitFor(() => expect(worker.posted.length).toBeGreaterThan(priorPosts));
  const request = worker.posted[priorPosts]!;
  worker.reply({ id: request.id, type: 'started' });
  worker.reply({
    id: request.id,
    type: 'result',
    compileLog: exitCode === null ? 'ERROR: cannot find symbol' : '',
    output,
    exitCode,
    compileMs: 10,
    runMs: 5,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /revelar|volver a ejecutar/i })).toBeEnabled(),
  );
  return { worker, request };
}

afterEach(() => {
  workers.length = 0;
  vi.mocked(loadGrammar).mockClear();
});

describe('PredictOutput', () => {
  it('shows the snippet and the prose beside it before anything runs', async () => {
    renderPredict();

    expect(screen.getByText(/¿Qué imprime este programa\?/)).toBeInTheDocument();
    // The code makes it into the editor mock, and it takes two waits to say
    // so: LazyCodeEditor is lazy() and suspends until its module resolves,
    // then the CodeEditor inside seeds its buffer only after its own
    // loadRuntime promise resolves.
    const code = await screen.findByTestId('code');
    await waitFor(() => expect(code).toHaveValue(SNIPPET));
    // Nothing has committed yet, so the reveal panel does not exist.
    expect(screen.queryByText(/lo que imprimió el programa/i)).not.toBeInTheDocument();
  });

  it('offers a textarea for the reader to write their prediction into', async () => {
    renderPredict();

    const textarea = screen.getByLabelText(/tu predicción de la salida/i);
    await userEvent.type(textarea, 'hola');
    expect(textarea).toHaveValue('hola');
  });

  it('reveals what the program actually printed only after the reader presses Revelar', async () => {
    renderPredict();

    // Guard: no panel labelled with the reveal is on the page yet. Cannot look
    // for the OUTPUT text itself — the same word lives in the snippet the
    // editor mock rendered, so it is already on the page and would pass
    // whether the reveal fired or not.
    expect(screen.queryByText(/lo que imprimió el programa/i)).not.toBeInTheDocument();

    // A distinctive output the snippet itself does not print, so the reveal
    // panel is the only place this string can come from.
    await revealWith('el resultado real\n');

    const panel = screen.getByText(/lo que imprimió el programa/i).closest('section')!;
    expect(panel).toHaveTextContent(/el resultado real/);
  });

  it('runs the snippet the fence carries, not something else', async () => {
    renderPredict();

    const { request } = await revealWith('hola\n');
    // The runtime sees the exact source the author put in the fence — a run
    // that silently ran different code would defeat the trap the document is
    // trying to demonstrate. The trailing newline the fence carries is peeled
    // off by fenceOf; this reads the same shape Exercise's harness does.
    expect(request.source).toContain('System.out.println("hola");');
  });

  it('reports a compile error rather than an empty output panel', async () => {
    renderPredict();

    await revealWith('', null);

    expect(screen.getByText(/errores de compilación/i)).toBeInTheDocument();
    expect(screen.getByText(/ERROR: cannot find symbol/)).toBeInTheDocument();
    // A rejected program has no output — the diagnostics panel is the whole
    // answer, and painting an empty "salida" beside it would look like the
    // program printed nothing on purpose.
    expect(screen.queryByText(/lo que imprimió el programa/i)).not.toBeInTheDocument();
  });

  it('says so when the fence is missing, instead of running an empty program', () => {
    render(
      <PredictOutput>
        <p>Sin cerca.</p>
      </PredictOutput>,
    );

    expect(screen.getByText(/sin bloque/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revelar/i })).not.toBeInTheDocument();
  });

  it('paints "(sin salida)" when the program terminates without printing anything', async () => {
    renderPredict();

    await revealWith('');

    const panel = screen.getByText(/lo que imprimió el programa/i).closest('section')!;
    // A run that exits 0 with no output is a legitimate answer to a
    // predict-output question, and an empty <pre> would look identical to
    // "the run has not happened yet". The literal is the difference.
    expect(panel).toHaveTextContent(/\(sin salida\)/);
  });

  it('lets the reader run again — the button renames and the output re-renders', async () => {
    renderPredict();

    await revealWith('primera\n');
    expect(screen.getByText(/primera/)).toBeInTheDocument();
    // The button asks its second question by a new name — the reader who saw
    // the reveal cannot tell what "Revelar" would still mean.
    expect(screen.getByRole('button', { name: /volver a ejecutar/i })).toBeInTheDocument();

    await revealWith('segunda\n');
    expect(screen.queryByText(/primera/)).not.toBeInTheDocument();
    expect(screen.getByText(/segunda/)).toBeInTheDocument();
    // useRuntime reuses one worker across every call (ADR-0017: one JVM per
    // page), so both runs share `workers[0]` — but each is a distinct request
    // with its own id, and the second's output has replaced the first.
    expect(workers).toHaveLength(1);
    expect(workers[0]!.posted).toHaveLength(2);
  });
});
