import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunRequest, RuntimeWorker, WorkerMessage } from '../../runtime';
import { MemoryDiagram } from './MemoryDiagram';
import { TRACE_SOURCE } from './trace';

/**
 * The run seam, which the sibling suite deliberately leaves alone.
 *
 * jsdom cannot execute Java, but it can hold everything either side of the
 * execution: what request the component posts, and what it does with a reply.
 * That is where the object-cap bug lived — the parser set a flag nothing read,
 * and no test joined the two halves. Same FakeWorker as `Exercise.test.tsx`.
 */

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
    // No `loadGrammar` fake here, deliberately, and its absence is an assertion:
    // <MemoryDiagram> draws its own listing and is the consumer #122 split the
    // grammar out FOR. If this component ever starts asking for one, these cases
    // reach the real `loadGrammar` and the reason will be visible.
    loadRuntime: vi.fn(async () => ({
      descriptor: { id: 'java' as const, label: 'Java 8', fileName: 'Main.java', defaultCode: '' },
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    })),
  };
});

function fence(meta: string, code: string): ReactNode {
  return (
    <pre>
      <code className="language-java" data-meta={meta}>
        {code}
      </code>
    </pre>
  );
}

const SNIPPET = `public class Demo {
    public static void main(String[] args) {
        Punto a = new Punto(1, 2);   // foto a
    }
}
`;

/** Presses the button and answers with what the tracer printed. */
async function drawWith(output: string, exitCode: number | null = 0) {
  const button = screen.getByRole('button', { name: /Ejecutar y dibujar/ });
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
    compileMs: 1,
    runMs: 1,
  });
  return worker;
}

const ONE_STEP = [
  '[nalanda] T PASO 3 main',
  '[nalanda] T VAR a ref 1',
  '[nalanda] T OBJ 1 Punto',
  '[nalanda] T FLD 1 x int 1',
  '[nalanda] T FINPASO',
].join('\n');

beforeEach(() => {
  workers.length = 0;
});

describe('MemoryDiagram, running', () => {
  it('sends the tracer as a library and the instrumented source as the program', async () => {
    // A regression to the old positional `run(code, '', TRACE_SOURCE)` would send
    // the tracer as a HARNESS, which makes it the entry point — and it has no
    // `main`. It would compile and draw nothing.
    render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
    const worker = await drawWith(ONE_STEP);

    const request = worker.posted[0]!;
    expect(request.library).toBe(TRACE_SOURCE);
    expect(request.harness).toBeUndefined();
    expect(request.source).toContain('NalandaTrace.inicio(');
    // Instrumented, not what the author typed.
    expect(request.source).not.toContain('// foto');
  });

  it('draws what the run reported', async () => {
    render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
    await drawWith(ONE_STEP);

    expect(await screen.findByText('paso 1 de 1')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('a apunta a un Punto'),
    );
  });

  it('shows the compiler and no drawing when the snippet does not compile', async () => {
    render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
    await drawWith('', null);

    expect(await screen.findByText(/cannot find symbol/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says so when the run took no photographs at all', async () => {
    // Markers inside a branch that never executed. Nothing before the run can
    // see this, so the component has to notice afterwards.
    render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
    await drawWith('nada que ver por aquí');

    expect(await screen.findByText(/no reportó ninguna foto/i)).toBeInTheDocument();
  });

  describe('a trace that is not the whole run', () => {
    it('warns when the tracer hit its object cap', async () => {
      // The regression this file exists for: `TOPE objetos` is printed inside
      // `fin()`, so it used to land on the step, where nothing read it — a
      // 30-node list drew 24 boxes and said nothing.
      render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
      await drawWith(
        [
          '[nalanda] T PASO 3 main',
          '[nalanda] T VAR a ref 1',
          '[nalanda] T OBJ 1 Punto',
          '[nalanda] T TOPE objetos',
          '[nalanda] T FINPASO',
        ].join('\n'),
      );

      expect(await screen.findByText(/más objetos de los que caben/i)).toBeInTheDocument();
    });

    it('warns when the tracer hit its photograph cap', async () => {
      render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
      await drawWith([ONE_STEP, '[nalanda] T TOPE pasos'].join('\n'));

      expect(await screen.findByText(/máximo de fotos/i)).toBeInTheDocument();
    });

    it('warns when the launcher cut the output mid-trace', async () => {
      // Measured in Chromium: 40 photographs arrived as 21, and the player
      // announced "paso 21 de 21" — an active claim of completeness.
      render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
      await drawWith(
        [ONE_STEP, '[nalanda] salida truncada: el programa imprimió demasiado'].join('\n'),
      );

      expect(await screen.findByText(/la traza se cortó/i)).toBeInTheDocument();
    });

    it('stays quiet when the run was complete', async () => {
      render(<MemoryDiagram>{fence('trace', SNIPPET)}</MemoryDiagram>);
      await drawWith(ONE_STEP);

      await screen.findByText('paso 1 de 1');
      expect(screen.queryByText(/máximo|se cortó|más objetos/i)).not.toBeInTheDocument();
    });
  });
});
