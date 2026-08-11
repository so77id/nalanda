import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { Check, Copy, Expand, Loader, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useMode } from '../../presentation';
import type { RunResult, RuntimeId, RuntimeModule } from '../../runtime';
import { RunAbandonedError, loadRuntime, runtimeDescriptors, useRuntime } from '../../runtime';
import type { EditorFlags, EditorVariant } from './variants';
import { resolveFlags } from './variants';

export interface CodeEditorProps extends Partial<EditorFlags> {
  /** Which runtime compiles and runs this snippet. */
  language: RuntimeId;
  /** Chrome preset; individual flags override it. */
  variant?: EditorVariant;
  /** Starting source. Defaults to the runtime's own sample. */
  defaultValue?: string;
  /** Text fed to the program's standard input. */
  defaultStdin?: string;
}

const PANEL_LABEL =
  'bg-zinc-800 px-3 py-1 font-mono text-3xs uppercase tracking-wide text-zinc-400';
const OUTPUT = 'm-0 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs';
const CHIP = 'rounded px-1.5 py-0.5 font-mono text-3xs';

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-700">
      <h4 className={PANEL_LABEL}>{label}</h4>
      {children}
    </section>
  );
}

/**
 * Editable, runnable source embedded in a document — the component that makes a
 * Nalanda page more than a slide. Compilation and execution happen in the
 * student's browser (ADR-0001); this owns the chrome and the state.
 */
export function CodeEditor({
  language,
  variant = 'exercise',
  defaultValue,
  defaultStdin = '',
  ...overrides
}: CodeEditorProps) {
  const mode = useMode();
  const flags = resolveFlags(variant, overrides);

  const [languageId, setLanguageId] = useState<RuntimeId>(language);
  const [runtimes, setRuntimes] = useState<Partial<Record<RuntimeId, RuntimeModule>>>({});
  const [buffers, setBuffers] = useState<Partial<Record<RuntimeId, string>>>({});
  const [stdin, setStdin] = useState(defaultStdin);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const runtime = runtimes[languageId] ?? null;
  const descriptor = runtime?.descriptor;
  const code = buffers[languageId] ?? '';

  // The grammar is cheap; the compiler behind `createWorker` is not, and is not
  // touched until the student runs something (issue #74 AC6).
  useEffect(() => {
    let cancelled = false;
    void loadRuntime(languageId).then(
      (module) => {
        if (cancelled) return;
        setRuntimes((current) => ({ ...current, [languageId]: module }));
        setBuffers((current) =>
          current[languageId] === undefined
            ? {
                ...current,
                [languageId]:
                  (languageId === language ? defaultValue : undefined) ??
                  module.descriptor.defaultCode,
              }
            : current,
        );
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [languageId, language, defaultValue]);

  const { run, warmUp, warm, warmStats } = useRuntime({
    runtimeId: flags.runnable && runtime ? languageId : null,
    createWorker: () => {
      if (!runtime) throw new Error(`the ${languageId} runtime is still loading`);
      return runtime.createWorker();
    },
  });

  // Booting Java costs ~24s (ADR-0017). A document that exists to be run should
  // spend that while the student is still reading the statement.
  useEffect(() => {
    if (flags.warmOnMount && flags.runnable && runtime) warmUp();
  }, [flags.warmOnMount, flags.runnable, runtime, warmUp]);

  const setCode = useCallback(
    (next: string) => setBuffers((current) => ({ ...current, [languageId]: next })),
    [languageId],
  );

  const doRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setFailure(null);
    try {
      setResult(await run(code, stdin));
    } catch (error) {
      // An abandoned run is the student's own doing — they switched language or
      // left. Reporting it as a diagnostic would blame them for our plumbing.
      if (!(error instanceof RunAbandonedError)) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setRunning(false);
    }
  }, [run, code, stdin]);

  const changeLanguage = useCallback((next: RuntimeId) => {
    setLanguageId(next);
    // Results belong to the language that produced them; leaving them on screen
    // attributes C++ output to the Python editor.
    setResult(null);
    setFailure(null);
  }, []);

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // No clipboard permission or no secure context — the button simply does
        // nothing rather than throwing in a student's face.
      },
    );
  }, [code]);

  // CodeMirror handles keys on its own DOM node, so a bubbled handler cannot stop
  // Enter from inserting a newline first. The keymap runs ahead of it.
  const runShortcut = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              void doRun();
              return true;
            },
          },
        ]),
      ),
    [doRun],
  );

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const diagnostics = failure ?? result?.compileLog ?? '';
  const failedToCompile = result !== null && result.exitCode === null;
  const codeHeight = expanded
    ? 'flex-1 min-h-0 overflow-auto'
    : mode === 'presentation'
      ? 'max-h-[55vh] overflow-auto'
      : 'max-h-64 overflow-auto';

  const shell = (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-50 flex flex-col bg-zinc-900 text-zinc-100'
          : 'not-prose my-6 flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100'
      }
    >
      <header className="flex items-center gap-2 bg-zinc-800 px-3 py-1.5">
        {flags.showFileName ? (
          <span className="font-mono text-xs text-zinc-400">
            {descriptor?.fileName ?? `${languageId}…`}
          </span>
        ) : null}

        {flags.showLanguage && flags.editable ? (
          <select
            aria-label="Lenguaje"
            value={languageId}
            onChange={(event) => changeLanguage(event.target.value as RuntimeId)}
            className="rounded bg-zinc-700 px-1.5 py-0.5 font-mono text-2xs text-zinc-100"
          >
            {runtimeDescriptors.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-3xs text-zinc-500">{descriptor?.label}</span>
        )}

        {flags.showWarmStatus && flags.runnable ? (
          <span
            className={`${CHIP} ${warm ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}
          >
            {warm ? 'listo' : 'frío'}
          </span>
        ) : null}

        <span className="flex-1" />

        {flags.showCopy ? (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-zinc-300 hover:bg-zinc-700"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        ) : null}

        {flags.showExpand && mode !== 'presentation' ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? 'Cerrar pantalla completa' : 'Expandir a pantalla completa'}
            className="rounded p-1 text-zinc-300 hover:bg-zinc-700"
          >
            {expanded ? <X size={14} /> : <Expand size={14} />}
          </button>
        ) : null}
      </header>

      <div className={codeHeight}>
        <CodeMirror
          value={code}
          onChange={setCode}
          theme="dark"
          editable={flags.editable}
          readOnly={!flags.editable}
          height={expanded ? '100%' : undefined}
          extensions={[
            ...(runtime ? [runtime.codeMirrorLanguage()] : []),
            ...(flags.runnable ? [runShortcut] : []),
          ]}
          basicSetup={{ lineNumbers: flags.showLineNumbers, foldGutter: flags.showFoldGutter }}
        />
      </div>

      {flags.showStdin ? (
        <Panel label="stdin">
          <textarea
            aria-label="Entrada estándar"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            className="block h-14 w-full resize-none bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 outline-none"
          />
        </Panel>
      ) : null}

      {flags.showDiagnostics && diagnostics ? (
        <Panel label={failedToCompile ? 'errores de compilación' : 'diagnósticos'}>
          <pre className={`${OUTPUT} max-h-40 bg-zinc-800 text-amber-300`}>{diagnostics}</pre>
        </Panel>
      ) : null}

      {flags.showOutput && (result?.output || running) ? (
        <Panel label="salida">
          <pre
            className={`${OUTPUT} ${expanded ? 'flex-1' : 'max-h-48'} bg-zinc-800 text-zinc-200`}
          >
            {result?.output || '…'}
          </pre>
        </Panel>
      ) : null}

      {flags.runnable ? (
        <footer className="flex items-center gap-3 border-t border-zinc-700 bg-zinc-800 px-3 py-2">
          <button
            type="button"
            onClick={() => void doRun()}
            disabled={running || !runtime}
            title="Ctrl/Cmd + Enter"
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Ejecutando…' : 'Ejecutar'}
          </button>

          {running && !warm ? (
            <span className="font-mono text-3xs text-zinc-400">preparando el runtime…</span>
          ) : null}

          {flags.showTimings && result ? (
            <span className="font-mono text-3xs text-zinc-400">
              {result.compileMs === null ? '' : `compila ${result.compileMs}ms · `}
              ejecuta {result.runMs ?? '—'}ms
            </span>
          ) : null}

          {flags.showWarmStatus && warmStats && descriptor?.formatWarmStats ? (
            <span className="font-mono text-3xs text-zinc-500">
              {descriptor.formatWarmStats(warmStats.detail)}
            </span>
          ) : null}

          <span className="flex-1" />

          {flags.showExitCode && result !== null && result.exitCode !== null ? (
            <span
              className={`${CHIP} ${
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

  return expanded ? createPortal(shell, document.body) : shell;
}
