import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  ResultMessage,
  RunRequest,
  RuntimeId,
  RuntimeWorker,
  WorkerMessage,
} from './contract';
import { RunAbandonedError, useRuntime } from './useRuntime';

class FakeWorker implements RuntimeWorker {
  readonly posted: RunRequest[] = [];
  terminated = false;
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

  terminate(): void {
    this.terminated = true;
  }

  /** Drive the hook the way a real worker would. */
  emit(message: WorkerMessage): void {
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<WorkerMessage>);
    }
  }
}

function resultFor(id: number, overrides: Partial<ResultMessage> = {}): ResultMessage {
  return {
    id,
    type: 'result',
    compileLog: '',
    output: 'ok',
    exitCode: 0,
    compileMs: 1,
    runMs: 2,
    ...overrides,
  };
}

/** Spawns fake workers and records every one it made. */
/**
 * A pause longer than any short budget a test hands the hook.
 *
 * The flake this guards was not a race in the code: it was a test that asked a
 * loaded machine to answer inside a 20ms real timer. Waiting here on purpose
 * makes that dependency explicit — a test that survives this survives a busy
 * CI box, and one that does not fails on every machine instead of one in
 * however many (#98).
 */
const underLoad = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

function workerFactory() {
  const created: FakeWorker[] = [];
  return {
    created,
    createWorker: () => {
      const worker = new FakeWorker();
      created.push(worker);
      return worker;
    },
    last: () => created[created.length - 1]!,
  };
}

describe('useRuntime', () => {
  it('creates no worker until the runtime is actually needed', () => {
    const factory = workerFactory();

    renderHook(() => useRuntime({ runtimeId: 'cpp', createWorker: factory.createWorker }));

    // AC6: a read-only snippet must not download a compiler.
    expect(factory.created).toHaveLength(0);
  });

  it('creates exactly one worker on warmUp and reports it warm', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({ runtimeId: 'cpp', createWorker: factory.createWorker }),
    );

    act(() => result.current.warmUp());
    act(() => result.current.warmUp());

    expect(factory.created).toHaveLength(1);
    expect(result.current.warm).toBe(false);

    act(() => factory.last().emit({ type: 'warm', detail: { bootMs: 42 } }));

    await waitFor(() => expect(result.current.warm).toBe(true));
    expect(result.current.warmStats?.detail).toEqual({ bootMs: 42 });
  });

  it('runs source through the worker and resolves with its result', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({ runtimeId: 'cpp', createWorker: factory.createWorker }),
    );

    let run!: Promise<unknown>;
    act(() => {
      run = result.current.run('int main(){}', 'in');
    });

    await waitFor(() => expect(factory.created).toHaveLength(1));
    const worker = factory.last();
    await waitFor(() => expect(worker.posted).toHaveLength(1));
    expect(worker.posted[0]).toMatchObject({ source: 'int main(){}', stdin: 'in' });

    act(() => worker.emit(resultFor(worker.posted[0]!.id, { output: 'hello' })));

    await expect(run).resolves.toMatchObject({ output: 'hello', exitCode: 0 });
  });

  it('correlates concurrent runs with their own results', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({ runtimeId: 'cpp', createWorker: factory.createWorker }),
    );

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.run('a', '');
      second = result.current.run('b', '');
    });

    const worker = await waitFor(() => {
      const w = factory.last();
      expect(w.posted).toHaveLength(2);
      return w;
    });

    // Answer out of order: correlation must be by id, not arrival.
    act(() => {
      worker.emit(resultFor(worker.posted[1]!.id, { output: 'second' }));
      worker.emit(resultFor(worker.posted[0]!.id, { output: 'first' }));
    });

    await expect(first).resolves.toMatchObject({ output: 'first' });
    await expect(second).resolves.toMatchObject({ output: 'second' });
  });

  it('rejects the run when the runtime itself errors', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({ runtimeId: 'cpp', createWorker: factory.createWorker }),
    );

    let run!: Promise<unknown>;
    act(() => {
      run = result.current.run('boom', '');
    });

    const worker = await waitFor(() => {
      const w = factory.last();
      expect(w.posted).toHaveLength(1);
      return w;
    });

    act(() => worker.emit({ id: worker.posted[0]!.id, type: 'error', message: 'worker died' }));

    await expect(run).rejects.toThrow('worker died');
  });

  it('terminates the worker and rejects pending runs when the language changes', async () => {
    const factory = workerFactory();
    const { result, rerender } = renderHook(
      ({ runtimeId }: { runtimeId: 'cpp' | 'python' }) =>
        useRuntime({ runtimeId, createWorker: factory.createWorker }),
      { initialProps: { runtimeId: 'cpp' } as { runtimeId: 'cpp' | 'python' } },
    );

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run('a', '');
    });
    await waitFor(() => expect(factory.created).toHaveLength(1));
    act(() => factory.last().emit({ type: 'warm' }));
    await waitFor(() => expect(result.current.warm).toBe(true));

    rerender({ runtimeId: 'python' });

    // Abandoned, not failed: the caller swallows this instead of showing the
    // student a diagnostic that is really our own plumbing.
    await expect(pending).rejects.toBeInstanceOf(RunAbandonedError);
    expect(factory.created[0]!.terminated).toBe(true);
    // Warmth belongs to the terminated worker, not to the hook.
    expect(result.current.warm).toBe(false);
  });

  it('terminates the worker on unmount', async () => {
    const factory = workerFactory();
    const { result, unmount } = renderHook(() =>
      useRuntime({ runtimeId: 'cpp', createWorker: factory.createWorker }),
    );

    act(() => result.current.warmUp());
    await waitFor(() => expect(factory.created).toHaveLength(1));

    unmount();

    expect(factory.last().terminated).toBe(true);
  });

  it('does not blame the program for a slow start', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({
        runtimeId: 'cpp',
        createWorker: factory.createWorker,
        // The program gets almost no budget; getting started gets plenty.
        timeoutMs: 10_000,
        startTimeoutMs: 30,
      }),
    );

    let slowStart!: Promise<unknown>;
    act(() => {
      slowStart = result.current.run('int main(){}', '');
    });
    await waitFor(() => expect(factory.created).toHaveLength(1));

    // Downloading a toolchain, booting a JVM or queueing behind another editor
    // is not an infinite loop, and must not be reported as one.
    await expect(slowStart).rejects.toThrow(/runtime no estuvo listo/i);
  });

  it('starts measuring the program only once the runtime says it has started', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({
        runtimeId: 'cpp',
        createWorker: factory.createWorker,
        timeoutMs: 30,
        startTimeoutMs: 10_000,
      }),
    );

    let stuck!: Promise<unknown>;
    act(() => {
      stuck = result.current.run('while(true){}', '');
    });
    await waitFor(() => expect(factory.created).toHaveLength(1));
    const worker = factory.last();
    await waitFor(() => expect(worker.posted).toHaveLength(1));

    act(() => worker.emit({ id: worker.posted[0]!.id, type: 'started' }));

    await expect(stuck).rejects.toThrow(/bucle infinito/i);
    expect(factory.created[0]!.terminated).toBe(true);
  });

  it('reports a run as queued until the runtime picks it up', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({ runtimeId: 'java', createWorker: factory.createWorker }),
    );

    expect(result.current.queued).toBe(false);

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run('class A {}', '');
    });
    await waitFor(() => expect(factory.last().posted).toHaveLength(1));

    // Posted and not yet picked up. This is the silence PER-2 measured: 4.8s of
    // it, on a warm runtime, with nothing on screen saying the run was waiting
    // behind another editor rather than simply not working.
    await waitFor(() => expect(result.current.queued).toBe(true));

    const id = factory.last().posted[0]!.id;
    act(() => factory.last().emit({ id, type: 'started' }));
    await waitFor(() => expect(result.current.queued).toBe(false));

    act(() => factory.last().emit(resultFor(id)));
    await pending;
    expect(result.current.queued).toBe(false);
  });

  it('stops calling a run queued once it is abandoned', async () => {
    const factory = workerFactory();
    const { result, rerender } = renderHook(
      ({ id }: { id: RuntimeId }) =>
        useRuntime({ runtimeId: id, createWorker: factory.createWorker }),
      { initialProps: { id: 'java' as RuntimeId } },
    );

    let abandoned!: Promise<unknown>;
    act(() => {
      abandoned = result.current.run('class A {}', '');
    });
    await waitFor(() => expect(result.current.queued).toBe(true));

    // Switching language abandons the run. The hint has to go with it, or the
    // fresh runtime opens claiming to be waiting for something nobody sent.
    rerender({ id: 'python' });

    await expect(abandoned).rejects.toBeInstanceOf(RunAbandonedError);
    expect(result.current.queued).toBe(false);
  });

  it('abandons a run that never finishes and frees its toolchain', async () => {
    const factory = workerFactory();
    // Two budgets, because the two halves of this test want opposite things:
    // the abandoned run needs a deadline it will actually hit, and the run
    // after it needs one the machine cannot blow through. Handing both halves
    // 20ms made the second one a race against whatever else the box was doing
    // (#98).
    const { result, rerender } = renderHook(
      ({ startTimeoutMs }: { startTimeoutMs: number }) =>
        useRuntime({
          runtimeId: 'cpp',
          createWorker: factory.createWorker,
          timeoutMs: 20,
          startTimeoutMs,
        }),
      { initialProps: { startTimeoutMs: 20 } },
    );

    let stuck!: Promise<unknown>;
    act(() => {
      // The student's `while (true)`: the worker never replies.
      stuck = result.current.run('while(true){}', '');
    });
    await waitFor(() => expect(factory.created).toHaveLength(1));

    await expect(stuck).rejects.toThrow(/no estuvo listo|bucle infinito/i);
    // A stranded worker holds a whole compiler in memory, so it must go.
    expect(factory.created[0]!.terminated).toBe(true);

    // Nothing is being timed now — the point of what follows is that a fresh
    // run works after a discard, not how fast it is.
    rerender({ startTimeoutMs: 10_000 });

    let next!: Promise<unknown>;
    act(() => {
      next = result.current.run('int main(){}', '');
    });
    await waitFor(() => expect(factory.created).toHaveLength(2));
    // The second run must not inherit the first run's impatience.
    await underLoad();
    const fresh = factory.last();
    act(() => fresh.emit(resultFor(fresh.posted[0]!.id, { output: 'ok' })));
    await expect(next).resolves.toMatchObject({ output: 'ok' });
  });

  it('never creates a worker when the runtime is disabled', async () => {
    const factory = workerFactory();
    const { result } = renderHook(() =>
      useRuntime({ runtimeId: null, createWorker: factory.createWorker }),
    );

    act(() => result.current.warmUp());

    await expect(result.current.run('a', '')).rejects.toThrow(/no runtime/i);
    expect(factory.created).toHaveLength(0);
  });
});
