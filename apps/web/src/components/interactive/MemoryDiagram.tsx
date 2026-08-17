import { Loader, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { fencesByMeta, withoutFences } from '../../lib/codeFences';
import { AuthoringError } from '../AuthoringError';
import { MemoryPlayer } from './MemoryPlayer';
import { OUTPUT, Panel } from './Panel';
import { RunAbandonedError } from '../../runtime';
import { useLoadedRuntime } from './useLoadedRuntime';
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
 * author marked them (`trace.ts`), so the picture cannot drift from the code.
 *
 * The listing is read-only: the highlight belongs to the player, and driving
 * CodeMirror's line decorations from outside it costs more than it buys here. A
 * document that wants the reader experimenting puts a `<CodeEditor>` with the
 * same program beside the diagram.
 *
 * **Only Java.** The tracer is a Java class using Java reflection; C++ and
 * Python have no equivalent here, and a diagram that silently drew nothing would
 * be worse than one that says so.
 *
 * The CDN toolchain is not fetched until the reader asks — `loadCheerpJ` runs on
 * the first `run`, never on mount. Mounting is not free though: it pulls four
 * lazy chunks — this component, the runtime seam, `useLoadedRuntime` and the java
 * module (33.95 kB raw / 13.12 kB gzip, ADR-0028 §9). It used to pull the java
 * grammar and the CodeMirror core on top of that, ~121.7 kB gzip this component
 * never used because it draws its own listing; #122 moved grammars behind
 * `loadGrammar(id)`, so it no longer does.
 */
export function MemoryDiagram({ title, children }: MemoryDiagramProps) {
  const fences = useMemo(() => fencesByMeta(children), [children]);
  const prose = useMemo(() => withoutFences(children), [children]);
  const authored = fences[TRACE_FENCE] ?? '';

  const prepared = useMemo(() => instrument(authored), [authored]);
  const shown = useMemo(() => stripMarkers(authored), [authored]);

  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState<TraceReading | null>(null);
  const [compileLog, setCompileLog] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const { run, warm, queued, ready, failure: loadFailure } = useLoadedRuntime('java');

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

  const diagnostics = failure ?? loadFailure ?? compileLog;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          memoria
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </header>

      {prose.length === 0 ? null : (
        <div className="prose prose-sm max-w-none px-3 py-2">{prose}</div>
      )}

      {reading === null ? (
        <pre className={`${OUTPUT} max-h-80 border-t border-rule text-ink-soft`}>{shown}</pre>
      ) : (
        <MemoryPlayer steps={reading.steps} source={shown} truncated={reading.truncated} />
      )}

      {diagnostics === '' ? null : (
        <Panel label={failure === null ? 'errores de compilación' : 'error'}>
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-flag`}>{diagnostics}</pre>
        </Panel>
      )}

      {reading !== null && reading.steps.length === 0 && diagnostics === '' ? (
        <Panel label="aviso">
          <p className="m-0 px-3 py-2 font-mono text-xs text-flag">
            El programa corrió pero no reportó ninguna foto. ¿Las marcas
            <code> // foto</code> quedaron dentro de un bloque que no se ejecutó?
          </p>
        </Panel>
      ) : null}

      {reading === null || reading.output === '' ? null : (
        <Panel label="lo que imprimió el programa">
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-ink-soft`}>{reading.output}</pre>
        </Panel>
      )}

      <footer className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
        <button
          type="button"
          onClick={() => void draw()}
          disabled={running || !ready}
          className="inline-flex items-center gap-1.5 rounded bg-keep px-3 py-1 text-xs font-medium text-on-keep disabled:opacity-50"
        >
          {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Dibujando…' : reading === null ? 'Ejecutar y dibujar' : 'Volver a dibujar'}
        </button>

        {running && !warm ? (
          <span className="font-mono text-3xs text-ink-faint">preparando el runtime…</span>
        ) : running && queued ? (
          <span className="font-mono text-3xs text-ink-faint">
            esperando a que termine otro editor…
          </span>
        ) : null}
      </footer>
    </div>
  );
}
