import { useState, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { cpp } from '@codemirror/lang-cpp'
import JSCPP from 'JSCPP'

export default function CppRunner({ initialCode = '', initialStdin = '' }) {
  const [code, setCode] = useState(initialCode)
  const [stdin, setStdin] = useState(initialStdin)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [exitCode, setExitCode] = useState(null)

  const run = useCallback(() => {
    setRunning(true)
    setOutput('')
    setExitCode(null)

    let buffer = ''
    const config = {
      stdio: {
        write: (s) => {
          buffer += s
        },
      },
    }

    try {
      const ec = JSCPP.run(code, stdin, config)
      setOutput(buffer)
      setExitCode(ec)
    } catch (err) {
      setOutput(buffer + `\n\n[error] ${err.message ?? err}`)
      setExitCode(-1)
    } finally {
      setRunning(false)
    }
  }, [code, stdin])

  return (
    <div className="flex h-full flex-col gap-3 p-4 bg-slate-950 text-slate-100">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-fuchsia-300">
          C++ Runner · JSCPP experiment
        </h1>
        <button
          onClick={run}
          disabled={running}
          className="ml-auto rounded-md bg-fuchsia-500 px-4 py-1.5 font-medium text-white hover:bg-fuchsia-400 disabled:opacity-50 transition"
        >
          {running ? 'Running…' : '▶ Run'}
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3 min-h-0">
        <div className="flex flex-col min-h-0 rounded-md overflow-hidden border border-slate-800">
          <div className="bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
            source.cpp
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
              className="h-20 resize-none bg-slate-900 p-2 font-mono text-sm text-slate-200 outline-none"
            />
          </div>

          <div className="flex flex-1 flex-col min-h-0 rounded-md overflow-hidden border border-slate-800">
            <div className="flex items-center bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-400">
              <span>output</span>
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
