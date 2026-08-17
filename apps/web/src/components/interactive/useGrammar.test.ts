import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeId } from '../../lib/runtimeIds';
import { useGrammar } from './useGrammar';

// The grammar arrives from its own chunk (#122), so every case here drives a
// DEFERRED promise rather than an already-resolved one: what this hook is for is
// the window between mount and arrival, and a resolved mock skips it entirely.
// That window is exactly what shipped untested — the whole consumer side of the
// split survived deleting the grammar from both editors with 989 tests green.
const { loadGrammar } = vi.hoisted(() => ({ loadGrammar: vi.fn() }));

vi.mock('../../runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../runtime')>()),
  loadGrammar,
}));

/** A promise plus the handles to settle it, so a test owns the timing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const JAVA = ['java-grammar'];
const PYTHON = ['python-grammar'];

beforeEach(() => {
  loadGrammar.mockReset();
});

describe('useGrammar', () => {
  it('is null until the grammar lands, then hands it over', async () => {
    const java = deferred<unknown>();
    loadGrammar.mockReturnValue(java.promise);

    const { result } = renderHook(() => useGrammar('java'));
    expect(result.current, 'an editor renders unhighlighted while the chunk is in flight').toBe(
      null,
    );
    expect(loadGrammar).toHaveBeenCalledWith('java');

    await act(async () => {
      java.resolve(JAVA);
    });
    expect(result.current).toBe(JAVA);
  });

  it('clears the previous grammar the moment the language changes', async () => {
    const java = deferred<unknown>();
    const python = deferred<unknown>();
    loadGrammar.mockReturnValueOnce(java.promise).mockReturnValueOnce(python.promise);

    const { result, rerender } = renderHook(({ id }: { id: RuntimeId }) => useGrammar(id), {
      initialProps: { id: 'java' as RuntimeId },
    });
    await act(async () => {
      java.resolve(JAVA);
    });
    expect(result.current).toBe(JAVA);

    rerender({ id: 'python' });
    // Not "still Java until Python lands": that highlights Python source with
    // Java's grammar, which is worse than not highlighting it at all.
    expect(result.current).toBe(null);

    await act(async () => {
      python.resolve(PYTHON);
    });
    expect(result.current).toBe(PYTHON);
  });

  it('ignores a stale grammar that resolves after a newer one', async () => {
    const java = deferred<unknown>();
    const python = deferred<unknown>();
    loadGrammar.mockReturnValueOnce(java.promise).mockReturnValueOnce(python.promise);

    const { result, rerender } = renderHook(({ id }: { id: RuntimeId }) => useGrammar(id), {
      initialProps: { id: 'java' as RuntimeId },
    });
    rerender({ id: 'python' });

    await act(async () => {
      python.resolve(PYTHON);
      java.resolve(JAVA); // the abandoned request answers last
    });

    expect(result.current, 'the abandoned java load must not overwrite python').toBe(PYTHON);
  });

  it('stays null when the grammar chunk never arrives, and does not throw', async () => {
    const failed = deferred<unknown>();
    loadGrammar.mockReturnValue(failed.promise);

    const { result } = renderHook(() => useGrammar('java'));
    await act(async () => {
      failed.reject(new Error('Failed to fetch dynamically imported module'));
    });

    // Deliberate: a missing grammar costs colour, and whatever the reader came to
    // RUN is governed by loadRuntime, which reports its own failures.
    expect(result.current).toBe(null);
  });

  it('asks for a grammar once per language, not once per render', async () => {
    const java = deferred<unknown>();
    loadGrammar.mockReturnValue(java.promise);

    const { rerender } = renderHook(({ id }: { id: RuntimeId }) => useGrammar(id), {
      initialProps: { id: 'java' as RuntimeId },
    });
    rerender({ id: 'java' });
    rerender({ id: 'java' });

    await waitFor(() => expect(loadGrammar).toHaveBeenCalledTimes(1));
  });
});
