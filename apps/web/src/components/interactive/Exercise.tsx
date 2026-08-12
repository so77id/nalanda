import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { Check, Loader, Play, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fencesByMeta, withoutFences } from '../../lib/codeFences';
import { AuthoringError } from '../AuthoringError';
import { clearDraft, draftKey, readDraft, saveDraft } from '../../lib/draft';
import type { RuntimeId, RuntimeModule } from '../../runtime';
import { RunAbandonedError, loadRuntime, useRuntime } from '../../runtime';
import type { RunReading } from './harness';
import { STARTER_FENCE, TEST_FENCE, buildHarness, readRun } from './harness';

export interface ExerciseProps {
  /** Shown as the exercise's heading. */
  title?: string;
  /** Which runtime compiles and runs it. Only Java validates today. */
  language?: RuntimeId;
  /** Statement as prose, plus a ```<lang> starter``` and a ```<lang> test``` fence. */
  children?: ReactNode;
}

const PANEL_LABEL =
  'bg-zinc-800 px-3 py-1 font-mono text-3xs uppercase tracking-wide text-zinc-400';
const OUTPUT = 'm-0 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs';

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-t border-zinc-700">
      <h4 className={PANEL_LABEL}>{label}</h4>
      {children}
    </section>
  );
}

function Verdict({ reading }: { reading: RunReading }) {
  const passed = reading.cases.filter((one) => one.ok).length;
  const total = reading.cases.length;
  const allPassed = total > 0 && passed === total;

  return (
    <Panel label="casos">
      <div className="px-3 py-2">
        <p className={`m-0 font-mono text-xs ${allPassed ? 'text-emerald-300' : 'text-amber-300'}`}>
          {total === 0
            ? 'el programa no reportó ningún caso'
            : `${passed} de ${total} ${total === 1 ? 'caso' : 'casos'}`}
        </p>

        <ul className="not-prose mt-1.5 mb-0 list-none space-y-0.5 p-0">
          {reading.cases.map((one) => (
            <li key={one.n} className="flex items-start gap-1.5 font-mono text-xs">
              {one.ok ? (
                <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <X size={13} className="mt-0.5 shrink-0 text-red-400" />
              )}
              <span className={one.ok ? 'text-zinc-400' : 'text-zinc-200'}>
                caso {one.n}
                {one.ok ? null : (
                  <>
                    {' — esperaba '}
                    <span className="text-emerald-300">{one.expected}</span>
                    {', obtuvo '}
                    <span className="text-red-300">{one.actual}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>

        {reading.crash === null ? null : (
          <p className="m-0 mt-2 font-mono text-xs text-red-300">
            el programa lanzó una excepción: {reading.crash}
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * A problem the student solves in place, checked automatically.
 *
 * What it checks is the *method*, not what the program printed: the cases are
 * compiled into a separate harness class that calls the student's code
 * (`harness.ts`), so nobody fails for formatting their output differently, and
 * the code that decides the verdict is not in a file the student can edit.
 *
 * The cases stay hidden until the first run. They are readable in the page
 * source either way — everything under `content/` is published — so this is
 * about pacing, not secrecy.
 */
export function Exercise({ title, language = 'java', children }: ExerciseProps) {
  const fences = useMemo(() => fencesByMeta(children), [children]);
  const statement = useMemo(() => withoutFences(children), [children]);
  const starter = fences[STARTER_FENCE] ?? '';
  const cases = fences[TEST_FENCE] ?? '';

  const key = useMemo(() => draftKey(globalThis.location?.pathname ?? '', starter), [starter]);

  const [runtime, setRuntime] = useState<RuntimeModule | null>(null);
  const [code, setCode] = useState(() => readDraft(key) ?? starter);
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState<RunReading | null>(null);
  const [compileLog, setCompileLog] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  // The grammar is cheap; the compiler behind `createWorker` is not, and stays
  // untouched until the student presses Comprobar (issue #74 AC6).
  useEffect(() => {
    let cancelled = false;
    void loadRuntime(language).then(
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
  }, [language]);

  const { run, warm } = useRuntime({
    runtimeId: runtime ? language : null,
    createWorker: () => {
      if (!runtime) throw new Error(`the ${language} runtime is still loading`);
      return runtime.createWorker();
    },
  });

  const check = useCallback(async () => {
    // Before the run, not after: a Java loop that never ends freezes this tab
    // for good (ADR-0017), and this is the last moment we are still alive to
    // save what the student wrote.
    saveDraft(key, code);
    setRunning(true);
    setReading(null);
    setFailure(null);
    setCompileLog('');
    try {
      const result = await run(code, '', buildHarness(cases));
      setCompileLog(result.compileLog);
      // A rejected program has no output to read; the compiler's message is the
      // whole answer.
      setReading(result.exitCode === null ? null : readRun(result.output));
      setRevealed(true);
    } catch (error) {
      if (!(error instanceof RunAbandonedError)) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setRunning(false);
    }
  }, [run, code, cases, key]);

  const checkShortcut = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              void check();
              return true;
            },
          },
        ]),
      ),
    [check],
  );

  // Both fences, not just the starter. Without `test` the exercise compiled and
  // ran, and told the STUDENT their program reported no cases — the author's
  // typo, blamed on the reader, in the one component that must not misreport.
  const missing = starter === '' ? STARTER_FENCE : cases === '' ? TEST_FENCE : null;
  if (missing !== null) {
    return (
      <AuthoringError component="Exercise">
        sin bloque <code>{missing}</code>: agrega una cerca de código marcada{' '}
        <code>
          ```{language} {missing}
        </code>
        .
      </AuthoringError>
    );
  }

  const diagnostics = failure ?? compileLog;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100">
      <header className="flex items-center gap-2 bg-zinc-800 px-3 py-1.5">
        <span className="rounded bg-sky-900 px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-sky-200">
          ejercicio
        </span>
        {title === undefined ? null : (
          <h4 className="m-0 text-sm font-medium text-zinc-100">{title}</h4>
        )}
      </header>

      {statement.length === 0 ? null : (
        <div className="prose prose-invert prose-sm max-w-none px-3 py-2">{statement}</div>
      )}

      <div className="max-h-80 overflow-auto border-t border-zinc-700">
        <CodeMirror
          value={code}
          onChange={setCode}
          theme="dark"
          extensions={[...(runtime ? [runtime.codeMirrorLanguage()] : []), checkShortcut]}
          basicSetup={{ lineNumbers: true, foldGutter: false }}
        />
      </div>

      {diagnostics === '' ? null : (
        <Panel label={failure === null ? 'errores de compilación' : 'error'}>
          <pre className={`${OUTPUT} max-h-40 bg-zinc-800 text-amber-300`}>{diagnostics}</pre>
        </Panel>
      )}

      {reading === null ? null : <Verdict reading={reading} />}

      {reading === null || reading.output === '' ? null : (
        <Panel label="lo que imprimiste">
          <pre className={`${OUTPUT} max-h-40 bg-zinc-800 text-zinc-200`}>{reading.output}</pre>
        </Panel>
      )}

      {revealed && cases !== '' ? (
        <Panel label="los casos que se probaron">
          <pre className={`${OUTPUT} max-h-40 bg-zinc-800 text-zinc-400`}>{cases.trim()}</pre>
        </Panel>
      ) : null}

      <footer className="flex items-center gap-3 border-t border-zinc-700 bg-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={running || !runtime}
          title="Ctrl/Cmd + Enter"
          className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Comprobando…' : 'Comprobar'}
        </button>

        <button
          type="button"
          onClick={() => {
            clearDraft(key);
            setCode(starter);
          }}
          disabled={running || code === starter}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-2xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
        >
          <RotateCcw size={13} />
          Reiniciar
        </button>

        {running && !warm ? (
          <span className="font-mono text-3xs text-zinc-400">preparando el runtime…</span>
        ) : null}
      </footer>
    </div>
  );
}
