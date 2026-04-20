import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import {
  Play,
  Loader,
  Expand,
  X,
  Copy,
  Check,
} from 'lucide-react'
import { useRuntime } from './useRuntime.js'
import { useLanguage } from './LanguageContext.jsx'
import { runtimeList } from './runtimes/index.js'
import { useTheme } from '../../theme/ThemeContext.jsx'

/**
 * CodeEditor — one component, fine-grained chrome.
 *
 * Design goals:
 *  - Single component rendered at two sizes (inline embed / portal fullscreen);
 *    the same prop set governs which panels appear in both.
 *  - Props are boolean flags with sensible `variant` presets; overrides wins.
 *  - Execution logic untouched from CodeRunner (useRuntime + workers + LanguageContext).
 *
 * Panel vertical order (consistent in embed and fullscreen columns):
 *    header  →  code  →  stdin  →  diagnostics  →  output  →  footer
 */

const VARIANT_PRESETS = {
  minimal: {},
  snippet: {
    showLanguage: true,
    showLineNumbers: true,
    showCopy: true,
  },
  read: {
    showLanguage: true,
    showLineNumbers: true,
  },
  exercise: {
    editable: true,
    runnable: true,
    showLanguage: true,
    showFileName: true,
    showWarmStatus: true,
    showLineNumbers: true,
    showOutput: true,
    showTimings: true,
    showExitCode: true,
    showExpand: true,
  },
  lab: {
    editable: true,
    runnable: true,
    showLanguage: true,
    showFileName: true,
    showWarmStatus: true,
    showLineNumbers: true,
    showFoldGutter: true,
    showCopy: true,
    showStdin: true,
    showDiagnostics: true,
    showOutput: true,
    showTimings: true,
    showExitCode: true,
    showExpand: true,
  },
}

const FLAG_KEYS = [
  'editable',
  'runnable',
  'showLanguage',
  'showFileName',
  'showWarmStatus',
  'showExpand',
  'showLineNumbers',
  'showFoldGutter',
  'showCopy',
  'showStdin',
  'showDiagnostics',
  'showOutput',
  'showTimings',
  'showExitCode',
]

function resolveFlags(variant, overrides) {
  const preset = VARIANT_PRESETS[variant] ?? VARIANT_PRESETS.exercise
  const flags = {}
  for (const k of FLAG_KEYS) {
    flags[k] = overrides[k] ?? preset[k] ?? false
  }
  // showOutput defaults to runnable if neither variant nor override specifies
  if (overrides.showOutput === undefined && preset.showOutput === undefined) {
    flags.showOutput = flags.runnable
  }
  return flags
}

export default function CodeEditor({
  // data
  language,
  value,
  defaultValue,
  onChange,
  samples = {},
  stdin: stdinProp,
  onStdinChange,

  // variant + per-flag overrides
  variant = 'exercise',
  editable,
  runnable,
  showLanguage,
  showFileName,
  showWarmStatus,
  showExpand,
  showLineNumbers,
  showFoldGutter,
  showCopy,
  showStdin,
  showDiagnostics,
  showOutput,
  showTimings,
  showExitCode,

  // appearance
  height,

  // execution
  onRun,
}) {
  const flags = useMemo(
    () =>
      resolveFlags(variant, {
        editable,
        runnable,
        showLanguage,
        showFileName,
        showWarmStatus,
        showExpand,
        showLineNumbers,
        showFoldGutter,
        showCopy,
        showStdin,
        showDiagnostics,
        showOutput,
        showTimings,
        showExitCode,
      }),
    [
      variant,
      editable,
      runnable,
      showLanguage,
      showFileName,
      showWarmStatus,
      showExpand,
      showLineNumbers,
      showFoldGutter,
      showCopy,
      showStdin,
      showDiagnostics,
      showOutput,
      showTimings,
      showExitCode,
    ]
  )

  // --- theme + language (global via contexts) ---------------------------
  const [themeName] = useTheme()
  const { languageId: ctxLang, setLanguageId } = useLanguage()
  const activeLang = language ?? ctxLang

  // --- code state (controlled OR per-language uncontrolled) -------------
  const isControlled = value !== undefined
  const [codeByLang, setCodeByLang] = useState(() => {
    const init = {}
    for (const r of runtimeList) {
      init[r.meta.id] =
        samples[r.meta.id] ?? defaultValue ?? r.meta.defaultCode ?? ''
    }
    return init
  })
  const code = isControlled ? value : codeByLang[activeLang] ?? ''
  const setCode = useCallback(
    (next) => {
      if (isControlled) {
        onChange?.(next)
      } else {
        setCodeByLang((prev) => ({ ...prev, [activeLang]: next }))
        onChange?.(next)
      }
    },
    [isControlled, onChange, activeLang]
  )

  // --- stdin state (controlled OR internal) -----------------------------
  const isStdinControlled = stdinProp !== undefined
  const [stdinState, setStdinState] = useState('')
  const stdin = isStdinControlled ? stdinProp : stdinState
  const setStdin = useCallback(
    (next) => {
      if (isStdinControlled) onStdinChange?.(next)
      else {
        setStdinState(next)
        onStdinChange?.(next)
      }
    },
    [isStdinControlled, onStdinChange]
  )

  // --- execution state --------------------------------------------------
  const [compileLog, setCompileLog] = useState('')
  const [output, setOutput] = useState('')
  const [exitCode, setExitCode] = useState(null)
  const [timings, setTimings] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  // Only warm up a runtime if we actually need to run
  const needsRuntime = flags.runnable && !onRun
  const { run, warm, warmStats, runtime } = useRuntime(
    needsRuntime ? activeLang : null
  )

  // Clear stale output when language changes (it was from a different run)
  useEffect(() => {
    setCompileLog('')
    setOutput('')
    setExitCode(null)
    setTimings(null)
  }, [activeLang])

  const doRun = useCallback(async () => {
    if (!flags.runnable) return
    setPhase('running')
    setCompileLog('')
    setOutput('')
    setExitCode(null)
    try {
      const r = onRun
        ? await onRun(code, activeLang)
        : await run(code, stdin)
      setCompileLog(r?.compileLog ?? '')
      setOutput(
        r?.output ?? (r?.exitCode == null ? '' : '(sin salida)')
      )
      setExitCode(r?.exitCode ?? null)
      setTimings({ compile: r?.compileMs ?? 0, run: r?.runMs ?? 0 })
    } catch (err) {
      setCompileLog(`[worker] ${err.message}`)
    } finally {
      setPhase('idle')
    }
  }, [flags.runnable, code, stdin, activeLang, run, onRun])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }, [code])

  // --- keyboard shortcuts ----------------------------------------------
  // Esc: only in fullscreen
  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [expanded])

  // Cmd/Ctrl + Enter handling:
  //   - CodeMirror processes keys via its own DOM listener, so a bubbled
  //     onKeyDown can't stop the newline insertion. We inject a CM6 keymap
  //     below that consumes Mod-Enter *before* the default Enter runs.
  //   - For the stdin textarea, button focus, etc., the container-level
  //     handler catches the same shortcut.
  //   - Events that CM already handled arrive here with defaultPrevented,
  //     so we skip them to avoid double-firing.
  const runShortcut = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              doRun()
              return true
            },
          },
        ])
      ),
    [doRun]
  )

  const onContainerKeyDown = useCallback(
    (e) => {
      if (e.defaultPrevented) return
      if (!flags.runnable) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        doRun()
      }
    },
    [flags.runnable, doRun]
  )

  const running = phase === 'running'
  const disabled = (needsRuntime && !warm) || running
  const runLabel = !warm && needsRuntime
    ? 'Calentando…'
    : running
    ? 'Ejecutando…'
    : 'Ejecutar'
  const runIcon =
    (!warm && needsRuntime) || running ? (
      <Loader size={14} className="animate-spin" />
    ) : (
      <Play size={14} />
    )

  const ctx = {
    flags,
    activeLang,
    onLanguageChange: setLanguageId,
    code,
    setCode,
    stdin,
    setStdin,
    output,
    compileLog,
    exitCode,
    timings,
    warm: needsRuntime ? warm : true,
    warmStats,
    running,
    disabled,
    runLabel,
    runIcon,
    doRun,
    runtime,
    copy,
    copied,
    height,
    onKeyDown: onContainerKeyDown,
    cmExtras: flags.runnable ? [runShortcut] : [],
    themeName,
  }

  if (expanded) {
    return createPortal(
      <ExpandedLayout {...ctx} onClose={() => setExpanded(false)} />,
      document.body
    )
  }
  return (
    <EmbedLayout
      {...ctx}
      onExpand={flags.showExpand ? () => setExpanded(true) : null}
    />
  )
}

/* =========================================================================
   Embed layout — stacked panels, inline with surrounding content.
   ========================================================================= */

function EmbedLayout({
  flags,
  activeLang,
  onLanguageChange,
  code,
  setCode,
  stdin,
  setStdin,
  output,
  compileLog,
  exitCode,
  timings,
  warm,
  running,
  disabled,
  runLabel,
  runIcon,
  doRun,
  runtime,
  copy,
  copied,
  onExpand,
  height,
  onKeyDown,
  cmExtras,
  themeName,
}) {
  const hasFooter =
    flags.runnable ||
    flags.showTimings ||
    flags.showExitCode ||
    flags.showCopy

  const showHeader =
    flags.showLanguage ||
    flags.showFileName ||
    flags.showWarmStatus ||
    onExpand

  return (
    <div className="nalanda not-prose my-6" onKeyDown={onKeyDown}>
      <div className="card">
        {showHeader && (
          <Header
            flags={flags}
            activeLang={activeLang}
            onLanguageChange={onLanguageChange}
            runtime={runtime}
            warm={warm}
            onExpand={onExpand}
          />
        )}

        <CodeArea
          code={code}
          setCode={setCode}
          runtime={runtime}
          editable={flags.editable}
          showLineNumbers={flags.showLineNumbers}
          showFoldGutter={flags.showFoldGutter}
          activeLang={activeLang}
          height={height ?? 'embed'}
          extras={cmExtras}
          themeName={themeName}
        />

        {flags.showStdin && (
          <PanelStrip label="stdin">
            <StdinBox stdin={stdin} setStdin={setStdin} />
          </PanelStrip>
        )}

        {flags.showDiagnostics && (
          <PanelStrip
            label={runtime?.meta.id === 'cpp' ? 'diagnósticos' : 'errores'}
          >
            <OutputPre
              text={compileLog || '—'}
              tone={compileLog ? 'warn' : 'muted'}
            />
          </PanelStrip>
        )}

        {flags.showOutput && (output || running) && (
          <PanelStrip label="stdout">
            <OutputPre
              text={output || '…'}
              tone={exitCode && exitCode !== 0 ? 'warn' : 'normal'}
            />
          </PanelStrip>
        )}

        {hasFooter && (
          <div className="card__footer">
            {flags.runnable && (
              <button
                type="button"
                onClick={doRun}
                disabled={disabled}
                className="btn btn--primary"
              >
                {runIcon}
                {runLabel}
              </button>
            )}
            {flags.showTimings && timings && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--fg-3)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {timings.compile > 0 ? `compile ${timings.compile}ms · ` : ''}
                exec {timings.run ?? '—'}ms
              </span>
            )}
            <span style={{ flex: 1 }} />
            {flags.showCopy && (
              <button
                type="button"
                onClick={copy}
                className="btn btn--ghost"
                title="Copiar"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            )}
            {flags.showExitCode && exitCode !== null && (
              <span className={`chip chip--${exitCode === 0 ? 'ok' : 'err'}`}>
                exit {exitCode}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   Expanded layout — fullscreen portal, 2-column split.
   ========================================================================= */

function ExpandedLayout({
  flags,
  activeLang,
  onLanguageChange,
  code,
  setCode,
  stdin,
  setStdin,
  output,
  compileLog,
  exitCode,
  timings,
  warm,
  warmStats,
  running,
  disabled,
  runLabel,
  runIcon,
  doRun,
  runtime,
  copy,
  copied,
  onClose,
  onKeyDown,
  cmExtras,
  themeName,
}) {
  return (
    <div
      className="nalanda fixed inset-0 z-50 flex flex-col gap-3 p-4"
      style={{ background: 'var(--bg-page)', color: 'var(--fg-1)' }}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-wrap items-center gap-3">
        {flags.showLanguage && (
          <LanguagePicker
            languageId={activeLang}
            onLanguageChange={onLanguageChange}
          />
        )}
        {flags.showWarmStatus && (
          <>
            <WarmChip warm={warm} />
            {warmStats && runtime?.meta.statsLabel && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--fg-3)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                boot {warmStats.totalMs}ms · {runtime.meta.statsLabel(warmStats)}
              </span>
            )}
          </>
        )}
        {flags.showTimings && timings && (
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-3)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            · última ejecución →
            {timings.compile > 0 ? ` compile ${timings.compile}ms ·` : ''} exec{' '}
            {timings.run ?? '—'}ms
          </span>
        )}
        {flags.showCopy && (
          <button
            type="button"
            onClick={copy}
            className="btn btn--ghost"
            title="Copiar"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="btn btn--secondary"
          style={{ marginLeft: 'auto' }}
          title="Cerrar (Esc)"
        >
          <X size={14} /> Cerrar
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 min-h-0">
        <PanelFrame label={flags.showFileName ? runtime?.meta.fileName : 'código'}>
          <CodeArea
            code={code}
            setCode={setCode}
            runtime={runtime}
            editable={flags.editable}
            showLineNumbers={flags.showLineNumbers}
            showFoldGutter={flags.showFoldGutter}
            activeLang={activeLang}
            height="100%"
            extras={cmExtras}
            themeName={themeName}
          />
        </PanelFrame>

        <div className="flex flex-col min-h-0 gap-3">
          {flags.runnable && (
            <button
              type="button"
              onClick={doRun}
              disabled={disabled}
              className="btn btn--primary"
              style={{ padding: '8px 16px', justifyContent: 'center' }}
            >
              {runIcon}
              {runLabel}
            </button>
          )}

          {flags.showStdin && (
            <PanelFrame label="stdin">
              <StdinBox stdin={stdin} setStdin={setStdin} tall />
            </PanelFrame>
          )}

          {flags.showDiagnostics && (
            <PanelFrame
              label={runtime?.meta.id === 'cpp' ? 'diagnósticos' : 'errores'}
            >
              <OutputPre
                text={compileLog || '—'}
                tone={compileLog ? 'warn' : 'muted'}
                scroll
                maxHeight="10rem"
              />
            </PanelFrame>
          )}

          {flags.showOutput && (
            <PanelFrame
              grow
              label={
                <>
                  stdout
                  {flags.showExitCode && exitCode !== null && (
                    <span
                      className={`chip chip--${exitCode === 0 ? 'ok' : 'err'}`}
                      style={{ marginLeft: 'auto' }}
                    >
                      exit {exitCode}
                    </span>
                  )}
                </>
              }
            >
              <OutputPre
                text={output || (running ? '…' : '(correr para ver salida)')}
                tone={exitCode && exitCode !== 0 ? 'warn' : 'normal'}
                scroll
              />
            </PanelFrame>
          )}
        </div>
      </div>
    </div>
  )
}

/* =========================================================================
   Shared sub-pieces.
   ========================================================================= */

function Header({
  flags,
  activeLang,
  onLanguageChange,
  runtime,
  warm,
  onExpand,
}) {
  return (
    <div className="card__header" style={{ gap: 10 }}>
      {flags.showLanguage && (
        <LanguagePicker
          languageId={activeLang}
          onLanguageChange={onLanguageChange}
          compact
        />
      )}
      {flags.showFileName && runtime?.meta.fileName && (
        <span className="chrome-label">{runtime.meta.fileName}</span>
      )}
      {flags.showWarmStatus && <WarmChip warm={warm} />}
      <span style={{ flex: 1 }} />
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="btn btn--ghost btn--icon"
          aria-label="Expandir a pantalla completa"
          title="Pantalla completa"
        >
          <Expand size={14} />
        </button>
      )}
    </div>
  )
}

function LanguagePicker({ languageId, onLanguageChange, compact = false }) {
  return (
    <select
      value={languageId}
      onChange={(e) => onLanguageChange(e.target.value)}
      className="input"
      style={{
        fontFamily: 'var(--font-mono)',
        padding: compact ? '2px 8px' : '5px 10px',
        fontSize: compact ? 'var(--text-xs)' : 'var(--text-sm)',
      }}
    >
      {runtimeList.map((r) => (
        <option key={r.meta.id} value={r.meta.id}>
          {r.meta.label}
        </option>
      ))}
    </select>
  )
}

function WarmChip({ warm }) {
  return (
    <span className={`chip chip--${warm ? 'ok' : 'warn'}`}>
      <span style={{ fontSize: 8 }}>●</span>
      {warm ? 'listo' : 'calentando'}
    </span>
  )
}

function CodeArea({
  code,
  setCode,
  runtime,
  editable,
  showLineNumbers,
  showFoldGutter,
  activeLang,
  height,
  extras = [],
  themeName = 'dark',
}) {
  const maxHeight = height === 'embed' ? '14rem' : undefined
  const extensions = [
    ...(runtime ? [runtime.meta.codeMirrorLanguage] : []),
    ...extras,
  ]
  // CodeMirror accepts 'light' | 'dark' | theme object. We map our two
  // themes directly — 'light' uses the default CM6 light palette.
  const cmTheme = themeName === 'light' ? 'light' : 'dark'
  return (
    <div
      style={{
        maxHeight,
        height: typeof height === 'number' ? `${height}px` : height === '100%' ? '100%' : undefined,
        overflow: 'auto',
        borderBottom: height === 'embed' ? '1px solid var(--border-subtle)' : undefined,
      }}
    >
      <CodeMirror
        key={`${activeLang}-${cmTheme}`}
        value={code}
        onChange={setCode}
        extensions={extensions}
        theme={cmTheme}
        editable={editable}
        readOnly={!editable}
        height={height === '100%' ? '100%' : undefined}
        basicSetup={{
          lineNumbers: showLineNumbers,
          foldGutter: showFoldGutter,
        }}
      />
    </div>
  )
}

function StdinBox({ stdin, setStdin, tall = false }) {
  return (
    <textarea
      value={stdin}
      onChange={(e) => setStdin(e.target.value)}
      placeholder="(entrada opcional)"
      style={{
        width: '100%',
        height: tall ? '5rem' : '3.5rem',
        resize: 'none',
        background: 'var(--bg-panel-header)',
        color: 'var(--fg-1)',
        padding: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        outline: 'none',
        border: 'none',
        display: 'block',
      }}
    />
  )
}

function OutputPre({
  text,
  tone = 'normal',
  scroll = false,
  maxHeight,
  bg,
}) {
  const color =
    tone === 'warn'
      ? 'var(--warn-fg)'
      : tone === 'muted'
      ? 'var(--fg-5)'
      : 'var(--fg-2)'
  return (
    <pre
      style={{
        margin: 0,
        padding: '8px 14px',
        background: bg ?? 'var(--bg-panel-header)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        whiteSpace: 'pre-wrap',
        color,
        flex: scroll ? 1 : undefined,
        overflow: scroll ? 'auto' : undefined,
        maxHeight,
      }}
    >
      {text}
    </pre>
  )
}

function PanelStrip({ label, children }) {
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div
        className="chrome-label"
        style={{
          background: 'var(--bg-panel-header)',
          padding: '4px 14px',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function PanelFrame({ label, grow = false, children }) {
  return (
    <div
      className="flex flex-col min-h-0"
      style={{
        flex: grow ? 1 : undefined,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--border-default)',
      }}
    >
      <div
        className="flex items-center"
        style={{
          background: 'var(--bg-panel-header)',
          padding: '4px 12px',
          fontSize: 'var(--text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
          color: 'var(--fg-4)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {label}
      </div>
      <div className="flex-1 overflow-auto flex flex-col">{children}</div>
    </div>
  )
}
