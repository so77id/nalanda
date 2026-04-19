import { useState, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { cpp } from '@codemirror/lang-cpp'
import { useCompiler } from './useCompiler.js'

export default function CppRunner({ initialCode = '', initialStdin = '' }) {
  const [code, setCode] = useState(initialCode)
  const [stdin, setStdin] = useState(initialStdin)
  const [compileLog, setCompileLog] = useState('')
  const [output, setOutput] = useState('')
  const [exitCode, setExitCode] = useState(null)
  const [timings, setTimings] = useState(null)
  const [phase, setPhase] = useState('idle') // idle | running

  const { run, warm, warmStats } = useCompiler()

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

  const running = phase === 'running'
  const disabled = !warm || running

  const buttonLabel = !warm ? 'Warming up…' : running ? 'Running…' : '▶ Run'

  return (
    <div className="flex h-full flex-col gap-3 p-4 bg-slate-950 text-slate-100">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-fuchsia-300">
          C++ Runner · browsercc (worker + PCH + warm-up)
        </h1>

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
          {warmStats && (
            <span className="text-slate-400">
              boot {warmStats.totalMs}ms · pch {warmStats.pchFetchMs}ms · cold compile{' '}
              {warmStats.warmCompileMs}ms
            </span>
          )}
        </div>

        {timings && (
          <span className="text-xs text-slate-300">
            · last run → compile {timings.compile}ms · exec {timings.run ?? '—'}ms
          </span>
        )}

        <button
          onClick={handleRun}
          disabled={disabled}
          className="ml-auto rounded-md bg-fuchsia-500 px-4 py-1.5 font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50 transition"
        >
          {buttonLabel}
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 min-h-0">
        <div className="flex flex-col min-h-0 rounded-md overflow-hidden border border-slate-800">
          <div className="bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
            main.cpp
          </div>
          <div className="flex-1 overflow-auto">
            <CodeMirror
              value={code}
              onChange={setCode}
              extensions={[cpp()]}
              theme="dark"
              height="100%"
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        </div>

        <div className="flex flex-col min-h-0 gap-3">
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
              compile diagnostics
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
