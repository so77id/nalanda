const PYODIDE_VERSION = '0.27.0'
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let pyodide = null

async function warmUp() {
  const t0 = performance.now()
  const mod = await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)
  const loadMs = performance.now() - t0

  const tI = performance.now()
  pyodide = await mod.loadPyodide({ indexURL: PYODIDE_CDN })
  const initMs = performance.now() - tI

  postMessage({
    type: 'warm',
    stats: {
      scriptMs: Math.round(loadMs),
      initMs: Math.round(initMs),
    },
  })
}

const warmPromise = warmUp()

function setupIO(stdin) {
  let output = ''
  pyodide.setStdout({
    batched: (s) => {
      output += s + '\n'
    },
  })
  pyodide.setStderr({
    batched: (s) => {
      output += s + '\n'
    },
  })
  if (stdin) {
    const lines = stdin.split('\n')
    let i = 0
    pyodide.setStdin({
      stdin: () => {
        if (i >= lines.length) return null
        return lines[i++]
      },
    })
  } else {
    pyodide.setStdin({ stdin: () => null })
  }
  return () => output
}

addEventListener('message', async (e) => {
  const { id, source, stdin } = e.data
  try {
    await warmPromise

    const getOutput = setupIO(stdin)

    const tR = performance.now()
    let exitCode = 0
    let compileLog = ''
    try {
      await pyodide.runPythonAsync(source)
    } catch (err) {
      compileLog = err.message ?? String(err)
      exitCode = 1
    }
    const runMs = Math.round(performance.now() - tR)

    postMessage({
      id,
      type: 'result',
      compileLog,
      output: getOutput(),
      exitCode,
      compileMs: 0,
      runMs,
    })
  } catch (err) {
    postMessage({
      id,
      type: 'error',
      message: err.message ?? String(err),
    })
  }
})
