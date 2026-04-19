import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { useRuntime } from './useRuntime.js'
import { runtimeList, getRuntime } from './runtimes/index.js'

export default function CodeRunner({
  language = 'cpp',
  initialCode,
  initialStdin = '',
}) {
  const [languageId, setLanguageId] = useState(language)
  const [code, setCode] = useState(
    initialCode ?? getRuntime(language)?.meta.defaultCode ?? ''
  )
  const [stdin, setStdin] = useState(initialStdin)
  const [compileLog, setCompileLog] = useState('')
  const [output, setOutput] = useState('')
  const [exitCode, setExitCode] = useState(null)
  const [timings, setTimings] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [expanded, setExpanded] = useState(false)

  const { run, warm, warmStats, runtime } = useRuntime(languageId)

  const handleLanguageChange = useCallback(
    (newId) => {
      if (newId === languageId) return
      setLanguageId(newId)
      setCode(getRuntime(newId)?.meta.defaultCode ?? '')
      setCompileLog('')
      setOutput('')
      setExitCode(null)
      setTimings(null)
    },
    [languageId]
  )

  const handleRun = useCallback(async () => {
    setPhase('running')
    setCompileLog('')
    setOutput('')
    setExitCode(null)
    try {
      const r = await run(code, stdin)
      setCompileLog(r.compileLog || '(no diagnostics)')
      setOutput(r.output || (r.exitCode == null ? '' : '(no output)'))
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
  const buttonLabel = !warm ? 'Warming up…' : running ? 'Running…' : '▶ Run'

  const state = {
    languageId,
    onLanguageChange: handleLanguageChange,
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
    handleRun,
    runtime,
  }

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
      className={`rounded border border-slate-700 bg-slate-900 font-mono text-slate-200 outline-none hover:border-fuchsia-500 focus:border-fuchsia-500 transition ${
        compact ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      }`}
    >
      {runtimeList.map((r) => (
        <option key={r.meta.id} value={r.meta.id}>
          {r.meta.label}
        </option>
      ))}
    </select>
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
  handleRun,
  runtime,
  onExpand,
}) {
  const showError = exitCode !== null && exitCode !== 0 && compileLog
  const bodyText = showError ? compileLog : output

  return (
    <div className="not-prose my-6 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 overflow-hidden shadow-lg shadow-slate-950/20">
      <div className="flex items-center gap-2 bg-slate-800/60 px-3 py-1.5 text-xs">
        <LanguagePicker
          languageId={languageId}
          onLanguageChange={onLanguageChange}
          compact
        />
        <span className="font-mono uppercase tracking-wide text-slate-400">
          {runtime?.meta.fileName}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            warm
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-amber-500/20 text-amber-300 animate-pulse'
          }`}
        >
          {warm ? '● warm' : '○ warming'}
        </span>
        <button
          onClick={onExpand}
          className="ml-auto rounded px-2 py-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100 transition"
          aria-label="Expand to fullscreen"
          title="Expand (fullscreen)"
        >
          ⤢
        </button>
      </div>

      <div className="max-h-56 overflow-auto border-b border-slate-800">
        <CodeMirror
          key={languageId}
          value={code}
          onChange={setCode}
          extensions={runtime ? [runtime.meta.codeMirrorLanguage] : []}
          theme="dark"
          basicSetup={{ lineNumbers: true, foldGutter: false }}
        />
      </div>

      <div className="flex items-center gap-3 bg-slate-900 px-3 py-2">
        <button
          onClick={handleRun}
          disabled={disabled}
          className="rounded-md bg-fuchsia-500 px-3 py-1 text-sm font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50 transition"
        >
          {buttonLabel}
        </button>
        {timings && (
          <span className="text-xs text-slate-400">
            {timings.compile > 0 ? `compile ${timings.compile}ms · ` : ''}
            exec {timings.run ?? '—'}ms
          </span>
        )}
        {exitCode !== null && (
          <span
            className={`ml-auto text-xs font-mono ${
              exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            exit {exitCode}
          </span>
        )}
      </div>

      {(bodyText || running) && (
        <pre
          className={`max-h-40 overflow-auto bg-slate-900/50 px-3 py-2 font-mono text-xs whitespace-pre-wrap ${
            showError ? 'text-amber-200' : 'text-slate-200'
          }`}
        >
          {bodyText || '…'}
        </pre>
      )}
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
  handleRun,
  runtime,
  onClose,
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 bg-slate-950 p-4 text-slate-100">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-fuchsia-300">
          Code Runner · Nalanda
        </h1>

        <LanguagePicker
          languageId={languageId}
          onLanguageChange={onLanguageChange}
        />

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 ${
              warm
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-amber-500/20 text-amber-300 animate-pulse'
            }`}
          >
            {warm ? '● warm' : '○ warming'}
          </span>
          {warmStats && runtime?.meta.statsLabel && (
            <span className="text-slate-400">
              boot {warmStats.totalMs}ms · {runtime.meta.statsLabel(warmStats)}
            </span>
          )}
        </div>

        {timings && (
          <span className="text-xs text-slate-300">
            · last run →
            {timings.compile > 0 ? ` compile ${timings.compile}ms ·` : ''}
            {' '}exec {timings.run ?? '—'}ms
          </span>
        )}

        <button
          onClick={onClose}
          className="ml-auto rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 transition"
          title="Close (Esc)"
        >
          ✕ Close
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 min-h-0">
        <div className="flex flex-col min-h-0 rounded-md overflow-hidden border border-slate-800">
          <div className="bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
            {runtime?.meta.fileName}
          </div>
          <div className="flex-1 overflow-auto">
            <CodeMirror
              key={languageId}
              value={code}
              onChange={setCode}
              extensions={runtime ? [runtime.meta.codeMirrorLanguage] : []}
              theme="dark"
              height="100%"
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        </div>

        <div className="flex flex-col min-h-0 gap-3">
          <button
            onClick={handleRun}
            disabled={disabled}
            className="rounded-md bg-fuchsia-500 px-4 py-2 font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50 transition shadow-lg shadow-fuchsia-500/20"
          >
            {buttonLabel}
          </button>

          <div className="flex flex-col rounded-md overflow-hidden border border-slate-800">
            <div className="bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
              stdin
            </div>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="(optional program input)"
              className="h-16 resize-none bg-slate-900 p-2 font-mono text-sm text-slate-200 outline-none"
            />
          </div>

          <div className="flex flex-col rounded-md overflow-hidden border border-slate-800 min-h-[6rem]">
            <div className="bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
              {runtime?.meta.id === 'cpp' ? 'compile diagnostics' : 'errors'}
            </div>
            <pre className="flex-1 overflow-auto bg-slate-900 p-2 font-mono text-xs text-amber-200 whitespace-pre-wrap max-h-40">
              {compileLog || '—'}
            </pre>
          </div>

          <div className="flex flex-1 flex-col min-h-0 rounded-md overflow-hidden border border-slate-800">
            <div className="flex items-center bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
              <span>stdout</span>
              {exitCode !== null && (
                <span
                  className={`ml-auto ${
                    exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  exit {exitCode}
                </span>
              )}
            </div>
            <pre className="flex-1 overflow-auto bg-slate-900 p-2 font-mono text-sm text-slate-200 whitespace-pre-wrap">
              {output || (running ? '…' : '(no output yet — click Run)')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
