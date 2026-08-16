import CodeMirror from '@uiw/react-codemirror';
import { Check, Copy, Expand, Loader, Play, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { draftKey, readDraft, saveDraft } from './draft';
import { useEmbedded } from '../embedded';
import { OUTPUT, Panel } from './Panel';
import { useMode } from '../../presentation';
import type { RunResult, RuntimeModule } from '../../runtime';
import type { RuntimeId } from '../../lib/runtimeIds';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { RunAbandonedError, loadRuntime, runtimeDescriptors, useRuntime } from '../../runtime';
import { useGrammar } from './useGrammar';
import { useRunShortcut } from './useRunShortcut';
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

const CHIP = 'rounded px-1.5 py-0.5 font-mono text-3xs';

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
  const theme = useResolvedTheme();
  // A container that already frames and labels this listing (a SideBySide
  // column). The frame is dropped rather than drawn twice, and the filename
  // goes with it: the column's own label already says which language this is.
  const embedded = useEmbedded();
  const flags = resolveFlags(variant, overrides);
  // Inside a column the line-number gutter costs 20px of the ~376px the
  // listing gets, and that is exactly the margin the #76 fix lives on: with the
  // gutter, `System.out.println("Bienvenidos a EDA");` loses its closing `);`
  // again — measured at 1440px in the book. Numbers are chrome; a complete line
  // is the lesson.
  const gutter = flags.showLineNumbers && !embedded;
  // Code to read, not a surface to type on. ONE definition, because two rules
  // depend on it and they must never drift: how tall it may grow (below), and
  // whether it consults the draft store (the effect further down). The second
  // is a security guard — a listing that reads a draft lets same-origin storage
  // replace what the reader copies.
  const listing = !flags.editable && !flags.runnable;

  const [languageId, setLanguageId] = useState<RuntimeId>(language);
  const [runtimes, setRuntimes] = useState<Partial<Record<RuntimeId, RuntimeModule>>>({});
  const [buffers, setBuffers] = useState<Partial<Record<RuntimeId, string>>>({});
  // One draft key per language, fixed when that language's seed is known.
  const [draftKeys, setDraftKeys] = useState<Partial<Record<RuntimeId, string>>>({});
  const [stdin, setStdin] = useState(defaultStdin);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const runtime = runtimes[languageId] ?? null;
  const descriptor = runtime?.descriptor;
  const code = buffers[languageId] ?? '';
  // Asked for separately from the runtime, and earlier: highlighting a listing
  // does not wait on a compiler it may never use (#122).
  const grammar = useGrammar(languageId);

  // The descriptor is cheap — a label, a file name, a seed — and this effect is
  // what fetches it. The compiler behind `createWorker` is not, and is not
  // touched until the student runs something (issue #74 AC6). The grammar used
  // to arrive here too and no longer does (#122): highlighting a listing is not
  // a reason to load a toolchain, nor the reverse.
  useEffect(() => {
    let cancelled = false;
    void loadRuntime(languageId).then(
      (module) => {
        if (cancelled) return;
        setRuntimes((current) => ({ ...current, [languageId]: module }));
        const seed =
          (languageId === language ? defaultValue : undefined) ?? module.descriptor.defaultCode;
        // Seeded with this editor's OWN starting source as well as the language's:
        // for any language other than the initial one the seed is the runtime's
        // sample, so two editors switched to the same language shared a draft and
        // one editor's code loaded into the other.
        const key = draftKey(
          `${globalThis.location?.pathname ?? ''}#${languageId}#${defaultValue ?? ''}`,
          seed,
        );
        setDraftKeys((current) => ({ ...current, [languageId]: key }));
        setBuffers((current) => {
          // A draft only exists if the student ran something here before, and it
          // is what they had when the tab froze — so only an editor they could
          // have typed in reads one. Once every markdown fence became an editor
          // (#85), an unguarded read meant same-origin storage could replace an
          // authored listing AND what its copy button hands the reader; on a
          // GitHub Pages user site that origin is shared with every other repo
          // of the account. A listing has no draft because it cannot be edited.
          const restored = listing ? null : readDraft(key);
          return current[languageId] === undefined
            ? { ...current, [languageId]: restored ?? seed }
            : current;
        });
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [languageId, language, defaultValue, listing]);

  const { run, warmUp, warm, queued, warmStats } = useRuntime({
    runtimeId: flags.runnable && runtime ? languageId : null,
    createWorker: () => {
      if (!runtime) throw new Error(`the ${languageId} runtime is still loading`);
      return runtime.createWorker();
    },
  });

  // Booting Java costs ~12s on a warm CDN and ~29s on a cold one (ADR-0017).
  // A document that exists to be run should
  // spend that while the student is still reading the statement.
  useEffect(() => {
    if (flags.warmOnMount && flags.runnable && runtime) warmUp();
  }, [flags.warmOnMount, flags.runnable, runtime, warmUp]);

  const setCode = useCallback(
    (next: string) => setBuffers((current) => ({ ...current, [languageId]: next })),
    [languageId],
  );

  const doRun = useCallback(async () => {
    // Before the run, not after: a Java loop that never ends freezes this tab
    // for good (ADR-0017), and this is the last moment we are still alive to
    // save what the student wrote.
    const key = draftKeys[languageId];
    if (key !== undefined) saveDraft(key, code);
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
  }, [run, code, stdin, draftKeys, languageId]);

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

  const runShortcut = useRunShortcut(useCallback(() => void doRun(), [doRun]));

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
  // Height: in the book a listing takes whatever it needs and the PAGE scrolls;
  // a box that scrolls inside a document that also scrolls is the most
  // irritating thing a long listing can do. On a slide the screen does not
  // grow, so the internal scroll is the only way through code that does not fit
  // without shrinking the type past legibility on a projector. An editable
  // editor keeps its cap in both, or a long exercise pushes its Run button out
  // of view.
  const codeHeight = expanded
    ? 'flex-1 min-h-0 overflow-auto'
    : mode === 'presentation'
      ? 'max-h-[55vh] overflow-auto'
      : listing
        ? ''
        : 'max-h-64 overflow-auto';

  const shell = (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-50 flex flex-col bg-surface text-ink'
          : embedded
            ? 'not-prose flex flex-col overflow-hidden bg-surface text-ink'
            : 'not-prose my-6 flex flex-col overflow-hidden rounded-lg border border-rule bg-surface text-ink'
      }
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        {flags.showFileName && !embedded ? (
          <span className="font-mono text-xs text-ink-faint">
            {descriptor?.fileName ?? `${languageId}…`}
          </span>
        ) : null}

        {flags.showLanguage && flags.editable ? (
          <select
            aria-label="Lenguaje"
            value={languageId}
            onChange={(event) => changeLanguage(event.target.value as RuntimeId)}
            className="rounded bg-sunk px-1.5 py-0.5 font-mono text-2xs text-ink"
          >
            {runtimeDescriptors.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : embedded ? null : (
          <span className="font-mono text-3xs text-ink-faint">{descriptor?.label}</span>
        )}

        {flags.showWarmStatus && flags.runnable ? (
          <span className={`${CHIP} ${warm ? 'bg-keep-soft text-keep' : 'bg-sunk text-ink-faint'}`}>
            {warm ? 'listo' : 'frío'}
          </span>
        ) : null}

        <span className="flex-1" />

        {flags.showCopy ? (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-ink-soft hover:bg-sunk"
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
            className="rounded p-1 text-ink-soft hover:bg-sunk"
          >
            {expanded ? <X size={14} /> : <Expand size={14} />}
          </button>
        ) : null}
      </header>

      <div className={codeHeight}>
        <CodeMirror
          value={code}
          onChange={setCode}
          // CodeMirror takes its theme as a prop instead of reading the
          // cascade, so this is one of the few places that has to ask which
          // theme is in force. Pinned to "dark" it was a dark editor sitting
          // inside a light panel (#109).
          theme={theme}
          editable={flags.editable}
          readOnly={!flags.editable}
          height={expanded ? '100%' : undefined}
          extensions={[...(grammar ? [grammar] : []), ...(flags.runnable ? [runShortcut] : [])]}
          basicSetup={{ lineNumbers: gutter, foldGutter: flags.showFoldGutter }}
        />
      </div>

      {flags.showStdin ? (
        <Panel label="stdin">
          <textarea
            aria-label="Entrada estándar"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            className="block h-14 w-full resize-none bg-sunk px-3 py-2 font-mono text-xs text-ink outline-none"
          />
        </Panel>
      ) : null}

      {flags.showDiagnostics && diagnostics ? (
        <Panel label={failedToCompile ? 'errores de compilación' : 'diagnósticos'}>
          <pre className={`${OUTPUT} max-h-40 bg-sunk text-flag`}>{diagnostics}</pre>
        </Panel>
      ) : null}

      {flags.showOutput && (result?.output || running) ? (
        <Panel label="salida">
          <pre className={`${OUTPUT} ${expanded ? 'flex-1' : 'max-h-48'} bg-sunk text-ink-soft`}>
            {result?.output || '…'}
          </pre>
        </Panel>
      ) : null}

      {flags.runnable ? (
        <footer className="flex items-center gap-3 border-t border-rule bg-sunk px-3 py-2">
          <button
            type="button"
            onClick={() => void doRun()}
            disabled={running || !runtime}
            title="Ctrl/Cmd + Enter"
            className="inline-flex items-center gap-1.5 rounded bg-keep px-3 py-1 text-xs font-medium text-on-keep disabled:opacity-50"
          >
            {running ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Ejecutando…' : 'Ejecutar'}
          </button>

          {/* Two silences, two honest explanations: booting the runtime, or
              waiting for the editor above this one to release the single JVM
              the page shares (ADR-0017). Both used to look like a spinner. */}
          {running && !warm ? (
            <span className="font-mono text-3xs text-ink-faint">preparando el runtime…</span>
          ) : running && queued ? (
            <span className="font-mono text-3xs text-ink-faint">
              esperando a que termine otro editor…
            </span>
          ) : null}

          {flags.showTimings && result ? (
            <span className="font-mono text-3xs text-ink-faint">
              {result.compileMs === null ? '' : `compila ${result.compileMs}ms · `}
              ejecuta {result.runMs ?? '—'}ms
            </span>
          ) : null}

          {flags.showWarmStatus && warmStats && descriptor?.formatWarmStats ? (
            <span className="font-mono text-3xs text-ink-faint">
              {descriptor.formatWarmStats(warmStats.detail)}
            </span>
          ) : null}

          <span className="flex-1" />

          {flags.showExitCode && result !== null && result.exitCode !== null ? (
            <span
              className={`${CHIP} ${
                result.exitCode === 0 ? 'bg-keep-soft text-keep' : 'bg-flag-soft text-flag'
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
