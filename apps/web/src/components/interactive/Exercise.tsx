import CodeMirror from '@uiw/react-codemirror';
import { Check, Loader, Play, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { fencesByMeta, withoutFences } from '../../lib/codeFences';
import { AuthoringError } from '../AuthoringError';
import { clearDraft, draftKey, readDraft, saveDraft } from './draft';
import { OUTPUT, Panel } from './Panel';
import type { RuntimeId } from '../../lib/runtimeIds';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { RunAbandonedError } from '../../runtime';
import { useGrammar } from './useGrammar';
import { useLoadedRuntime } from './useLoadedRuntime';
import type { RunReading } from './harness';
import { STARTER_FENCE, TEST_FENCE, buildHarness, readRun } from './harness';
import { useRunShortcut } from './useRunShortcut';

export interface ExerciseProps {
  /** Shown as the exercise's heading. */
  title?: string;
  /** Which runtime compiles and runs it. Only Java validates today. */
  language?: RuntimeId;
  /** Statement as prose, plus a ```<lang> starter``` and a ```<lang> test``` fence. */
  children?: ReactNode;
}

function Verdict({ reading }: { reading: RunReading }) {
  const passed = reading.cases.filter((one) => one.ok).length;
  const total = reading.cases.length;
  const allPassed = total > 0 && passed === total;

  return (
    <Panel label="casos">
      <div className="px-3 py-2">
        <p className={`m-0 font-mono text-xs ${allPassed ? 'text-keep' : 'text-flag'}`}>
          {total === 0
            ? 'el programa no reportó ningún caso'
            : `${passed} de ${total} ${total === 1 ? 'caso' : 'casos'}`}
        </p>

        <ul className="not-prose mt-1.5 mb-0 list-none space-y-0.5 p-0">
          {reading.cases.map((one) => (
            <li key={one.n} className="flex items-start gap-1.5 font-mono text-xs">
              {one.ok ? (
                <Check size={13} className="mt-0.5 shrink-0 text-keep" />
              ) : (
                <X size={13} className="mt-0.5 shrink-0 text-flag" />
              )}
              <span className={one.ok ? 'text-ink-faint' : 'text-ink-soft'}>
                caso {one.n}
                {one.ok ? null : (
                  <>
                    {' — esperaba '}
                    <span className="text-keep">{one.expected}</span>
                    {', obtuvo '}
                    <span className="text-flag">{one.actual}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>

        {reading.crash === null ? null : (
          <p className="m-0 mt-2 font-mono text-xs text-flag">
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
 * (`harness.ts`), so nobody fails for formatting their output differently.
 *
 * **A verdict is feedback, not evidence.** The harness keeps a stuck student
 * from editing the checker by accident; it is not a tamper control. The verdict
 * travels in-band on stdout, so a student who prints `[nalanda] PASS n` and
 * calls `System.exit(0)` gets a clean green board — demonstrated, not theorised.
 * Nothing here may ever back a mark (ADR-0019 §7, `docs/security-notes.md`).
 *
 * The cases stay hidden until the first run. They are readable in the page
 * source either way — everything under `content/` is published — so this is
 * about pacing, not secrecy, and an exercise whose cases must stay private
 * cannot exist here.
 */
export function Exercise({ title, language = 'java', children }: ExerciseProps) {
  const theme = useResolvedTheme();
  const fences = useMemo(() => fencesByMeta(children), [children]);
  const statement = useMemo(() => withoutFences(children), [children]);
  const starter = fences[STARTER_FENCE] ?? '';
  const cases = fences[TEST_FENCE] ?? '';

  // Scoped by title as well as page: keyed on the starting source alone, two
  // exercises built from the same template shared one draft and the last one run
  // won, handing the other student's work to whoever reloaded.
  const key = useMemo(
    () => draftKey(`${globalThis.location?.pathname ?? ''}#${title ?? ''}`, starter),
    [title, starter],
  );

  const [code, setCode] = useState(() => readDraft(key) ?? starter);
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState<RunReading | null>(null);
  const [compileLog, setCompileLog] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const { run, warm, queued, ready, failure: loadFailure } = useLoadedRuntime(language);
  // Separately from the runtime, and earlier: an exercise highlights before —
  // and whether or not — the student ever presses Comprobar (#122).
  const grammar = useGrammar(language);

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
      const result = await run(code, '', { harness: buildHarness(cases) });
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

  const checkShortcut = useRunShortcut(useCallback(() => void check(), [check]));

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

  const diagnostics = failure ?? loadFailure ?? compileLog;

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          ejercicio
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </header>

      {statement.length === 0 ? null : (
        <div className="prose prose-sm max-w-none px-3 py-2">{statement}</div>
      )}

      <div className="max-h-80 overflow-auto border-t border-rule">
        <CodeMirror
          value={code}
          onChange={setCode}
          theme={theme}
          extensions={[...(grammar ? [grammar] : []), checkShortcut]}
          basicSetup={{ lineNumbers: true, foldGutter: false }}
        />
      </div>

      {diagnostics === '' ? null : (
        <Panel label={failure === null ? 'errores de compilación' : 'error'}>
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-flag`}>{diagnostics}</pre>
        </Panel>
      )}

      {reading === null ? null : <Verdict reading={reading} />}

      {reading === null || reading.output === '' ? null : (
        <Panel label="lo que imprimiste">
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-ink-soft`}>{reading.output}</pre>
        </Panel>
      )}

      {revealed && cases !== '' ? (
        <Panel label="los casos que se probaron">
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-ink-faint`}>{cases.trim()}</pre>
        </Panel>
      ) : null}

      <footer className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={running || !ready}
          title="Ctrl/Cmd + Enter"
          className="inline-flex items-center gap-1.5 rounded bg-keep px-3 py-1 text-xs font-medium text-on-keep disabled:opacity-50"
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
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-2xs text-ink-soft hover:bg-sunk disabled:opacity-40"
        >
          <RotateCcw size={13} />
          Reiniciar
        </button>

        {/* Two silences, two honest explanations. Booting is the runtime's
            fault; queueing is the editor above this one holding the single JVM
            the page shares (ADR-0017). Neither is the student's, and until this
            existed both looked identical: a spinner and 4.8s of nothing. */}
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
