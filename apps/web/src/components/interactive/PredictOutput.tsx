import { Eye, Loader, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { fencesByMeta, withoutFences } from '../../lib/codeFences';
import { AuthoringError } from '../AuthoringError';
import { LazyCodeEditor } from './lazyCodeEditor';
import { OUTPUT, Panel } from './Panel';
import type { RuntimeId } from '../../lib/runtimeIds';
import { RunAbandonedError } from '../../runtime';
import { useLoadedRuntime } from './useLoadedRuntime';

/** The fence meta that carries the snippet to run — matches Exercise's `starter`/`test` shape. */
export const PREDICT_FENCE = 'predict';

export interface PredictOutputProps {
  /** Shown as the card's heading. */
  title?: string;
  /** Which runtime compiles and runs it. Only Java validates today. */
  language?: RuntimeId;
  /** Statement as prose, plus a ```<lang> predict``` fence carrying the snippet. */
  children?: ReactNode;
}

/**
 * A snippet the student **predicts the output of before seeing it**.
 *
 * Wraps a read-only `<CodeEditor>` for the listing and executes the same source
 * through the shared runtime seam. The reveal shows what the program **actually
 * printed** side-by-side with the student's prediction: never an author-written
 * answer, because a trap this document teaches (`new String("hola") == new
 * String("hola")`, the Integer cache at 128) is only convincing when the JVM is
 * the one saying so. Same hazard shape ADR-0019 §7 records for exercise
 * fences — an authored answer that lies ships past a green build.
 *
 * **Only Java.** The runtime seam accepts any registered language, but this
 * document is a Java lesson and every trap here is Java's; other languages
 * would need their own reservation of what the point is. Java has the runtime
 * ordering already documented at CodeEditor: main-thread execution, a shared
 * JVM across editors on one page (ADR-0017).
 */
export function PredictOutput({ title, language = 'java', children }: PredictOutputProps) {
  const fences = useMemo(() => fencesByMeta(children), [children]);
  const prose = useMemo(() => withoutFences(children), [children]);
  const source = fences[PREDICT_FENCE] ?? '';

  const [prediction, setPrediction] = useState('');
  const [running, setRunning] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const { run, warm, queued, ready, failure: loadFailure } = useLoadedRuntime(language);

  const reveal = useCallback(async () => {
    setRunning(true);
    setOutput(null);
    setCompileLog('');
    setFailure(null);
    try {
      const result = await run(source, '');
      setCompileLog(result.compileLog);
      // A rejected program has no output to read; the compiler's message is the
      // whole answer, so leave output null and let the diagnostics panel speak.
      setOutput(result.exitCode === null ? null : result.output);
      setCommitted(true);
    } catch (error) {
      if (!(error instanceof RunAbandonedError)) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setRunning(false);
    }
  }, [run, source]);

  if (source === '') {
    return (
      <AuthoringError component="PredictOutput">
        sin bloque <code>{PREDICT_FENCE}</code>: agrega una cerca de código marcada{' '}
        <code>
          ```{language} {PREDICT_FENCE}
        </code>
        .
      </AuthoringError>
    );
  }

  const diagnostics = failure ?? loadFailure ?? compileLog;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          predice
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </header>

      {prose.length === 0 ? null : (
        <div className="prose prose-sm max-w-none px-3 py-2">{prose}</div>
      )}

      {/* The listing goes through the platform's editor deliberately, even
          though the reader cannot edit it here: same colours as every other
          snippet in the course, and the runtime this component drives is loaded
          through the same seam a CodeEditor uses (`useLoadedRuntime`). The
          header is off because this card already has one — two rows of chrome
          would compete for the reader's eye. */}
      <div className="border-t border-rule">
        <LazyCodeEditor
          language={language}
          variant="read"
          showFileName={false}
          defaultValue={source}
        />
      </div>

      <Panel label="tu predicción">
        <textarea
          aria-label="Tu predicción de la salida"
          value={prediction}
          onChange={(event) => setPrediction(event.target.value)}
          placeholder="¿Qué imprimirá el programa? Escríbelo antes de revelar."
          className="block h-20 w-full resize-none bg-sunk px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
        />
      </Panel>

      {diagnostics === '' ? null : (
        <Panel label={failure === null ? 'errores de compilación' : 'error'}>
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-flag`}>{diagnostics}</pre>
        </Panel>
      )}

      {committed && output !== null ? (
        <Panel label="lo que imprimió el programa">
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-ink-soft`}>
            {output === '' ? '(sin salida)' : output}
          </pre>
        </Panel>
      ) : null}

      <footer className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
        <button
          type="button"
          onClick={() => void reveal()}
          disabled={running || !ready}
          className="inline-flex items-center gap-1.5 rounded bg-keep px-3 py-1 text-xs font-medium text-on-keep disabled:opacity-50"
        >
          {running ? (
            <Loader size={14} className="animate-spin" />
          ) : committed ? (
            <Play size={14} />
          ) : (
            <Eye size={14} />
          )}
          {running ? 'Ejecutando…' : committed ? 'Volver a ejecutar' : 'Revelar'}
        </button>

        {/* Same two silences CodeEditor and Exercise report, and for the same
            reason: booting the runtime and waiting behind another editor look
            identical without them (ADR-0017). */}
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
