import { Loader, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fencesByMeta, withoutFences } from '../../lib/codeFences';
import { AuthoringError } from '../AuthoringError';
import { MemoryPlayer } from './MemoryPlayer';
import { OUTPUT, Panel } from './Panel';
import type { RuntimeModule } from '../../runtime';
import { RunAbandonedError, loadRuntime, useRuntime } from '../../runtime';
import type { TraceReading } from './trace';
import { TRACE_FENCE, TRACE_SOURCE, instrument, readTrace, stripMarkers } from './trace';

export interface MemoryDiagramProps {
  /** Shown as the diagram's heading. */
  title?: string;
  /** Prose, plus a ```java trace``` fence carrying `// foto` markers. */
  children?: ReactNode;
}

/**
 * A drawing of the heap, taken from the snippet beside it actually running.
 *
 * The values are never authored. `NalandaTrace` is compiled next to the
 * snippet as a `library` unit and photographs the named variables where the
 * author marked them (`trace.ts`), so the picture cannot drift from the code and
 * follows the reader's own edits when they run it again.
 *
 * **Only Java.** The tracer is a Java class using Java reflection; C++ and
 * Python have no equivalent here, and a diagram that silently drew nothing would
 * be worse than one that says so.
 *
 * Nothing is fetched until the reader asks. A diagram that ran on mount would
 * pull the whole toolchain from the CDN on page load, three times over on a page
 * with three diagrams (ADR-0018 §the runtime is paid when requested).
 */
export function MemoryDiagram({ title, children }: MemoryDiagramProps) {
  const fences = useMemo(() => fencesByMeta(children), [children]);
  const prose = useMemo(() => withoutFences(children), [children]);
  const authored = fences[TRACE_FENCE] ?? '';

  const prepared = useMemo(() => instrument(authored), [authored]);
  const shown = useMemo(() => stripMarkers(authored), [authored]);

  const [runtime, setRuntime] = useState<RuntimeModule | null>(null);
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState<TraceReading | null>(null);
  const [compileLog, setCompileLog] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRuntime('java').then(
      (module) => {
        if (!cancelled) setRuntime(module);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const { run, warm, queued } = useRuntime({
    runtimeId: runtime ? 'java' : null,
    createWorker: () => {
      if (!runtime) throw new Error('the java runtime is still loading');
      return runtime.createWorker();
    },
  });

  const draw = useCallback(async () => {
    setRunning(true);
    setReading(null);
    setFailure(null);
    setCompileLog('');
    try {
      const result = await run(prepared.code, '', { library: TRACE_SOURCE });
      setCompileLog(result.compileLog);
      setReading(result.exitCode === null ? null : readTrace(result.output));
    } catch (error) {
      if (!(error instanceof RunAbandonedError)) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setRunning(false);
    }
  }, [run, prepared.code]);

  if (authored === '') {
    return (
      <AuthoringError component="MemoryDiagram">
        sin bloque <code>{TRACE_FENCE}</code>: agrega una cerca de código marcada{' '}
        <code>```java {TRACE_FENCE}</code>.
      </AuthoringError>
    );
  }

  if (prepared.errors.length > 0) {
    return (
      <AuthoringError component="MemoryDiagram">
        <ul className="m-0 list-disc pl-5">
          {prepared.errors.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </AuthoringError>
    );
  }

  const diagnostics = failure ?? compileLog;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100">
      <header className="flex items-center gap-2 bg-zinc-800 px-3 py-1.5">
        <span className="rounded bg-violet-900 px-1.5 py-0.5 font-mono text-3xs tracking-wide text-violet-200 uppercase">
          memoria
        </span>
        {title === undefined ? null : (
          <h4 className="m-0 text-sm font-medium text-zinc-100">{title}</h4>
        )}
      </header>

      {prose.length === 0 ? null : (
        <div className="prose prose-invert prose-sm max-w-none px-3 py-2">{prose}</div>
      )}

      {reading === null ? (
        <pre className={`${OUTPUT} max-h-80 border-t border-zinc-700 text-zinc-300`}>{shown}</pre>
      ) : (
        <MemoryPlayer steps={reading.steps} source={shown} truncated={reading.truncated} />
      )}

      {diagnostics === '' ? null : (
        <Panel label={failure === null ? 'errores de compilación' : 'error'}>
          <pre className={`${OUTPUT} max-h-40 bg-zinc-800 text-amber-300`}>{diagnostics}</pre>
        </Panel>
      )}

      {reading !== null && reading.steps.length === 0 && diagnostics === '' ? (
        <Panel label="aviso">
          <p className="m-0 px-3 py-2 font-mono text-xs text-amber-300">
            El programa corrió pero no reportó ninguna foto. ¿Las marcas
            <code> // foto</code> quedaron dentro de un bloque que no se ejecutó?
          </p>
        </Panel>
      ) : null}

      {reading === null || reading.output === '' ? null : (
        <Panel label="lo que imprimió el programa">
          <pre className={`${OUTPUT} max-h-40 bg-zinc-800 text-zinc-200`}>{reading.output}</pre>
        </Panel>
      )}

      <footer className="flex items-center gap-3 border-t border-zinc-700 bg-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={() => void draw()}
          disabled={running || !runtime}
          className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Dibujando…' : reading === null ? 'Ejecutar y dibujar' : 'Volver a dibujar'}
        </button>

        {running && !warm ? (
          <span className="font-mono text-3xs text-zinc-400">preparando el runtime…</span>
        ) : running && queued ? (
          <span className="font-mono text-3xs text-zinc-400">
            esperando a que termine otro editor…
          </span>
        ) : null}
      </footer>
    </div>
  );
}
