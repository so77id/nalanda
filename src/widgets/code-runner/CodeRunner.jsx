import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { Play, Loader, Expand, X } from 'lucide-react'
import { useRuntime } from './useRuntime.js'
import { useLanguage } from './LanguageContext.jsx'
import { runtimeList, getRuntime } from './runtimes/index.js'

export default function CodeRunner({ samples = {}, initialStdin = '' }) {
  const { languageId, setLanguageId } = useLanguage()

  const [codeByLang, setCodeByLang] = useState(() => {
    const init = {}
    for (const r of runtimeList) {
      init[r.meta.id] = samples[r.meta.id] ?? r.meta.defaultCode ?? ''
    }
    return init
  })

  const [stdin, setStdin] = useState(initialStdin)
  const [compileLog, setCompileLog] = useState('')
  const [output, setOutput] = useState('')
  const [exitCode, setExitCode] = useState(null)
  const [timings, setTimings] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [expanded, setExpanded] = useState(false)

  const { run, warm, warmStats, runtime } = useRuntime(languageId)

  const code = codeByLang[languageId] ?? ''
  const setCode = useCallback(
    (newCode) => {
      setCodeByLang((prev) => ({ ...prev, [languageId]: newCode }))
    },
    [languageId]
  )

  useEffect(() => {
    setCompileLog('')
    setOutput('')
    setExitCode(null)
    setTimings(null)
  }, [languageId])

  const handleRun = useCallback(async () => {
    setPhase('running')
    setCompileLog('')
    setOutput('')
    setExitCode(null)
    try {
      const r = await run(code, stdin)
      setCompileLog(r.compileLog || '(sin diagnósticos)')
      setOutput(r.output || (r.exitCode == null ? '' : '(sin salida)'))
      setExitCode(r.exitCode)
      setTimings({ compile: r.compileMs, run: r.runMs })
    } catch (err) {
      setCompileLog(`[worker] ${err.message}`)
    } finally {
      setPhase('idle')
    }
  }, [code, stdin, run])

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

  const running = phase === 'running'
  const disabled = !warm || running
  const buttonLabel = !warm ? 'Calentando…' : running ? 'Ejecutando…' : 'Ejecutar'
  const buttonIcon = !warm ? (
    <Loader size={14} className="animate-spin" />
  ) : running ? (
    <Loader size={14} className="animate-spin" />
  ) : (
    <Play size={14} />
  )

  const state = useMemo(
    () => ({
      languageId,
      onLanguageChange: setLanguageId,
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
      buttonLabel,
      buttonIcon,
      handleRun,
      runtime,
    }),
    [
      languageId,
      setLanguageId,
      code,
      setCode,
      stdin,
      output,
      compileLog,
      exitCode,
      timings,
      warm,
      warmStats,
      running,
      disabled,
      buttonLabel,
      buttonIcon,
      handleRun,
      runtime,
    ]
  )

  return (
    <>
      <EmbedView {...state} onExpand={() => setExpanded(true)} />
      {expanded &&
        createPortal(
          <FullscreenView {...state} onClose={() => setExpanded(false)} />,
          document.body
        )}
    </>
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

function EmbedView({
  languageId,
  onLanguageChange,
  code,
  setCode,
  output,
  compileLog,
  exitCode,
  timings,
  warm,
  running,
  disabled,
  buttonLabel,
  buttonIcon,
  handleRun,
  runtime,
  onExpand,
}) {
  const showError = exitCode !== null && exitCode !== 0 && compileLog
  const bodyText = showError ? compileLog : output

  return (
    <div className="nalanda not-prose my-6">
      <div className="card">
        <div className="card__header" style={{ gap: 10 }}>
          <LanguagePicker
            languageId={languageId}
            onLanguageChange={onLanguageChange}
            compact
          />
          <span className="chrome-label">{runtime?.meta.fileName}</span>
          <WarmChip warm={warm} />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onExpand}
            className="btn btn--ghost btn--icon"
            aria-label="Expandir a pantalla completa"
            title="Pantalla completa"
          >
            <Expand size={14} />
          </button>
        </div>

        <div
          style={{
            maxHeight: '14rem',
            overflow: 'auto',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <CodeMirror
            key={languageId}
            value={code}
            onChange={setCode}
            extensions={runtime ? [runtime.meta.codeMirrorLanguage] : []}
            theme="dark"
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>

        <div className="card__footer">
          <button
            type="button"
            onClick={handleRun}
            disabled={disabled}
            className="btn btn--primary"
          >
            {buttonIcon}
            {buttonLabel}
          </button>
          {timings && (
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
          {exitCode !== null && (
            <span
              className={`chip chip--${exitCode === 0 ? 'ok' : 'err'}`}
            >
              exit {exitCode}
            </span>
          )}
        </div>

        {(bodyText || running) && (
          <pre
            style={{
              maxHeight: '10rem',
              overflow: 'auto',
              background: 'var(--bg-code)',
              borderTop: '1px solid var(--border-subtle)',
              margin: 0,
              padding: '8px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              whiteSpace: 'pre-wrap',
              color: showError ? 'var(--warn-fg)' : 'var(--fg-2)',
            }}
          >
            {bodyText || '…'}
          </pre>
        )}
      </div>
    </div>
  )
}

function FullscreenView({
  languageId,
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
  buttonLabel,
  buttonIcon,
  handleRun,
  runtime,
  onClose,
}) {
  return (
    <div
      className="nalanda fixed inset-0 z-50 flex flex-col gap-3 p-4"
      style={{ background: 'var(--bg-page)', color: 'var(--fg-1)' }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 600,
            color: 'var(--accent-fg)',
            margin: 0,
          }}
        >
          Code Runner · Nalanda
        </h1>

        <LanguagePicker
          languageId={languageId}
          onLanguageChange={onLanguageChange}
        />

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

        {timings && (
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
        <PanelFrame label={runtime?.meta.fileName}>
          <CodeMirror
            key={languageId}
            value={code}
            onChange={setCode}
            extensions={runtime ? [runtime.meta.codeMirrorLanguage] : []}
            theme="dark"
            height="100%"
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </PanelFrame>

        <div className="flex flex-col min-h-0 gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={disabled}
            className="btn btn--primary"
            style={{ padding: '8px 16px', justifyContent: 'center' }}
          >
            {buttonIcon}
            {buttonLabel}
          </button>

          <PanelFrame label="stdin">
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="(entrada opcional)"
              style={{
                height: '4rem',
                resize: 'none',
                background: 'var(--bg-panel)',
                color: 'var(--fg-1)',
                padding: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                border: 'none',
              }}
            />
          </PanelFrame>

          <PanelFrame
            label={runtime?.meta.id === 'cpp' ? 'diagnósticos' : 'errores'}
          >
            <pre
              style={{
                flex: 1,
                overflow: 'auto',
                background: 'var(--bg-panel)',
                padding: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--warn-fg)',
                whiteSpace: 'pre-wrap',
                maxHeight: '10rem',
                margin: 0,
              }}
            >
              {compileLog || '—'}
            </pre>
          </PanelFrame>

          <PanelFrame
            grow
            label={
              <>
                stdout
                {exitCode !== null && (
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
            <pre
              style={{
                flex: 1,
                overflow: 'auto',
                background: 'var(--bg-panel)',
                padding: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--fg-1)',
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}
            >
              {output || (running ? '…' : '(sin salida — pulsá Ejecutar)')}
            </pre>
          </PanelFrame>
        </div>
      </div>
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
