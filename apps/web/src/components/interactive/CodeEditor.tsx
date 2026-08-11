import CodeMirror from '@uiw/react-codemirror';
import { Loader, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useMode } from '../../presentation';
import type { RunResult, RuntimeId, RuntimeModule } from '../../runtime';
import { loadRuntime, useRuntime } from '../../runtime';

export interface CodeEditorProps {
  /** Which runtime compiles and runs this snippet. */
  language: RuntimeId;
  /** Starting source. Defaults to the runtime's own sample. */
  defaultValue?: string;
  /** Text fed to the program's standard input. */
  defaultStdin?: string;
  editable?: boolean;
  runnable?: boolean;
  showStdin?: boolean;
  showDiagnostics?: boolean;
  showOutput?: boolean;
  showTimings?: boolean;
  showExitCode?: boolean;
  showLineNumbers?: boolean;
}

type Phase = 'idle' | 'running';

const PANEL = 'border-t border-zinc-700';
const PANEL_LABEL =
  'bg-zinc-800 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-wide text-zinc-400';
const OUTPUT = 'm-0 whitespace-pre-wrap px-3 py-2 font-mono text-xs';

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className={PANEL}>
      <h4 className={PANEL_LABEL}>{label}</h4>
      {children}
    </section>
  );
}

/**
 * Editable, runnable source embedded in a document — the component that makes a
 * Nalanda page more than a slide. Compilation and execution happen in the
 * student's browser (ADR-0001); this only owns the chrome and the state.
 */
export function CodeEditor({
  language,
  defaultValue,
  defaultStdin = '',
  editable = true,
  runnable = true,
  showStdin = false,
  showDiagnostics = true,
  showOutput = true,
  showTimings = true,
  showExitCode = true,
  showLineNumbers = true,
}: CodeEditorProps) {
  const mode = useMode();
  const [runtime, setRuntime] = useState<RuntimeModule | null>(null);
  const [code, setCode] = useState(defaultValue ?? '');
  const [stdin, setStdin] = useState(defaultStdin);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<RunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The grammar is cheap; the compiler behind `createWorker` is not, and is not
  // touched until the student actually runs something (issue #74 AC6).
  useEffect(() => {
    let cancelled = false;
    void loadRuntime(language).then(
      (module) => {
        if (cancelled) return;
        setRuntime(module);
        setCode((current) => current || defaultValue || module.descriptor.defaultCode);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [language, defaultValue]);

  const { run, warm, warmStats } = useRuntime({
    runtimeId: runnable && runtime ? language : null,
    createWorker: () => {
      if (!runtime) throw new Error(`the ${language} runtime is still loading`);
      return runtime.createWorker();
    },
  });

  const doRun = useCallback(async () => {
    setPhase('running');
    setResult(null);
    setFailure(null);
    try {
      setResult(await run(code, stdin));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setPhase('idle');
    }
  }, [run, code, stdin]);

  const running = phase === 'running';
  const descriptor = runtime?.descriptor;
  const diagnostics = failure ?? result?.compileLog ?? '';
  const failedToCompile = result !== null && result.exitCode === null;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100">
      <header className="flex items-center gap-2 bg-zinc-800 px-3 py-1.5">
        <span className="font-mono text-xs text-zinc-400">
          {descriptor?.fileName ?? `${language}…`}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[0.65rem] text-zinc-500">{descriptor?.label}</span>
      </header>

      <div
        className={
          mode === 'presentation' ? 'max-h-[55vh] overflow-auto' : 'max-h-64 overflow-auto'
        }
      >
        <CodeMirror
          value={code}
          onChange={setCode}
          theme="dark"
          editable={editable}
          readOnly={!editable}
          extensions={runtime ? [runtime.codeMirrorLanguage()] : []}
          basicSetup={{ lineNumbers: showLineNumbers, foldGutter: false }}
        />
      </div>

      {showStdin ? (
        <Panel label="stdin">
          <textarea
            aria-label="Entrada estándar"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            className="block h-14 w-full resize-none bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 outline-none"
          />
        </Panel>
      ) : null}

      {showDiagnostics && diagnostics ? (
        <Panel label={failedToCompile ? 'errores de compilación' : 'diagnósticos'}>
          <pre className={`${OUTPUT} bg-zinc-800 text-amber-300`}>{diagnostics}</pre>
        </Panel>
      ) : null}

      {showOutput && (result?.output || running) ? (
        <Panel label="salida">
          <pre className={`${OUTPUT} bg-zinc-800 text-zinc-200`}>{result?.output || '…'}</pre>
        </Panel>
      ) : null}

      {runnable ? (
        <footer className="flex items-center gap-3 border-t border-zinc-700 bg-zinc-800 px-3 py-2">
          <button
            type="button"
            onClick={() => void doRun()}
            disabled={running || !runtime}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Ejecutando…' : 'Ejecutar'}
          </button>

          {!warm && running ? (
            <span className="font-mono text-[0.65rem] text-zinc-400">preparando el runtime…</span>
          ) : null}

          {showTimings && result ? (
            <span className="font-mono text-[0.65rem] text-zinc-400">
              {result.compileMs === null ? '' : `compila ${result.compileMs}ms · `}
              ejecuta {result.runMs ?? '—'}ms
            </span>
          ) : null}

          {warmStats && descriptor?.formatWarmStats ? (
            <span className="font-mono text-[0.65rem] text-zinc-500">
              {descriptor.formatWarmStats(warmStats.detail)}
            </span>
          ) : null}

          <span className="flex-1" />

          {showExitCode && result?.exitCode !== null && result !== null ? (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[0.65rem] ${
                result.exitCode === 0
                  ? 'bg-emerald-900 text-emerald-200'
                  : 'bg-red-900 text-red-200'
              }`}
            >
              exit {result.exitCode}
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
