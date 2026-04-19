import { compile, getPrecompiledHeader } from 'browsercc'
import {
  WASI,
  File,
  OpenFile,
  ConsoleStdout,
} from '@bjorn3/browser_wasi_shim'

const DEFAULT_FLAGS = ['-O2', '-std=c++20', '-fno-exceptions']
const PCH_PATH = '/include/bits/stdc++.h.pch'

let cachedPCH = null

async function warmUp() {
  const tPCH = performance.now()
  cachedPCH = await getPrecompiledHeader(DEFAULT_FLAGS)
  const pchMs = performance.now() - tPCH

  const tCold = performance.now()
  try {
    await compile({
      source: 'int main(){return 0;}',
      fileName: '_warmup.cpp',
      flags: DEFAULT_FLAGS,
    })
  } catch {
    // swallow warmup errors — they shouldn't happen but we don't want to block the worker
  }
  const coldMs = performance.now() - tCold

  postMessage({
    type: 'warm',
    pchFetchMs: Math.round(pchMs),
    warmCompileMs: Math.round(coldMs),
  })
}

const warmPromise = warmUp()

function runProgram(wasmModule, stdin) {
  let output = ''
  const stdinBytes = new TextEncoder().encode(stdin || '')
  const fds = [
    new OpenFile(new File(stdinBytes)),
    new ConsoleStdout((b) => {
      output += new TextDecoder().decode(b)
    }),
    new ConsoleStdout((b) => {
      output += new TextDecoder().decode(b)
    }),
  ]
  const wasi = new WASI([], [], fds)
  let exitCode = 0
  try {
    const instance = new WebAssembly.Instance(wasmModule, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })
    const ec = wasi.start(instance)
    exitCode = typeof ec === 'number' ? ec : 0
  } catch (err) {
    output += `\n[runtime] ${err.message ?? err}`
    exitCode = -1
  }
  return { output, exitCode }
}

addEventListener('message', async (e) => {
  const { id, source, stdin } = e.data
  try {
    await warmPromise

    const flags = [...DEFAULT_FLAGS]
    const extraFiles = {}
    if (cachedPCH) {
      flags.push('-include-pch', PCH_PATH)
      extraFiles[PCH_PATH] = cachedPCH
    }

    const tC = performance.now()
    const result = await compile({
      source,
      fileName: 'main.cpp',
      flags,
      extraFiles,
    })
    const compileMs = Math.round(performance.now() - tC)

    if (!result.module) {
      postMessage({
        id,
        type: 'result',
        compileLog: result.compileOutput || '(compilation failed)',
        output: '',
        exitCode: null,
        compileMs,
        runMs: null,
      })
      return
    }

    const tR = performance.now()
    const { output, exitCode } = runProgram(result.module, stdin)
    const runMs = Math.round(performance.now() - tR)

    postMessage({
      id,
      type: 'result',
      compileLog: result.compileOutput || '',
      output,
      exitCode,
      compileMs,
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
