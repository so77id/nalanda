/// <reference lib="webworker" />
import { ConsoleStdout, File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim';
import type { compile as Compile, getPrecompiledHeader as GetPrecompiledHeader } from 'browsercc';

import type { RunRequest, WorkerMessage } from '../contract';
import { BROWSERCC_CDN } from './browserccVersion';

// Clang compiled to WASM (browsercc) plus a WASI shim to give the produced
// module a stdin/stdout. Both run here so the main thread never blocks on a
// compile (ADR-0001).

const DEFAULT_FLAGS = ['-O2', '-std=c++20', '-fno-exceptions'];
const PCH_PATH = '/include/bits/stdc++.h.pch';

interface Toolchain {
  compile: typeof Compile;
  getPrecompiledHeader: typeof GetPrecompiledHeader;
}

/**
 * Loads the compiler from the CDN. browsercc addresses its own 113MB of WASM
 * relative to `import.meta.url`, so where the module is imported from decides
 * where the toolchain is served from (see browserccVersion.ts).
 */
async function loadToolchain(): Promise<Toolchain> {
  const module = (await import(/* @vite-ignore */ BROWSERCC_CDN)) as Partial<Toolchain>;
  if (typeof module.compile !== 'function' || typeof module.getPrecompiledHeader !== 'function') {
    throw new Error(`no C++ toolchain at ${BROWSERCC_CDN}`);
  }
  return { compile: module.compile, getPrecompiledHeader: module.getPrecompiledHeader };
}

let cachedHeader: ArrayBuffer | null = null;
let toolchain: Toolchain | null = null;

function post(message: WorkerMessage): void {
  postMessage(message);
}

/**
 * `wasi.start` wants a WASI command module; `WebAssembly.Instance` only promises
 * a bag of exports. Check the shape once, here, instead of asserting it away —
 * a module without `_start` is a bug worth a clear message (frontend-code-style
 * §Components: fail fast at boundaries).
 */
function asWasiCommand(instance: WebAssembly.Instance): {
  exports: { memory: WebAssembly.Memory; _start: () => unknown };
} {
  const { memory, _start } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof _start !== 'function') {
    throw new Error('compiled module is not a WASI command (no memory/_start export)');
  }
  return { exports: { memory, _start: _start as () => unknown } };
}

/**
 * Fetches the precompiled standard-library header and pays the first compile
 * up front, so the student's first Run is fast rather than the slowest one.
 */
async function warmUp(): Promise<void> {
  toolchain = await loadToolchain();

  const headerStart = performance.now();
  cachedHeader = await toolchain.getPrecompiledHeader(DEFAULT_FLAGS);
  const pchFetchMs = Math.round(performance.now() - headerStart);

  const compileStart = performance.now();
  try {
    await toolchain.compile({
      source: 'int main(){return 0;}',
      fileName: '_warmup.cpp',
      flags: DEFAULT_FLAGS,
    });
  } catch {
    // A failed warm-up must not wedge the worker: the real compile will report
    // the problem with the student's own code in front of it.
  }
  const warmCompileMs = Math.round(performance.now() - compileStart);

  post({ type: 'warm', detail: { pchFetchMs, warmCompileMs } });
}

const warmPromise = warmUp();

function runProgram(
  module: WebAssembly.Module,
  stdin: string,
): { output: string; exitCode: number } {
  let output = '';
  const collect = (bytes: Uint8Array): void => {
    output += new TextDecoder().decode(bytes);
  };
  const wasi = new WASI(
    [],
    [],
    // stdout and stderr are merged deliberately: a student reading a terminal
    // sees one stream, and splitting them is a documented future improvement.
    [
      new OpenFile(new File(new TextEncoder().encode(stdin))),
      new ConsoleStdout(collect),
      new ConsoleStdout(collect),
    ],
  );

  try {
    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    const exitCode = wasi.start(asWasiCommand(instance));
    return { output, exitCode: typeof exitCode === 'number' ? exitCode : 0 };
  } catch (error) {
    return { output: `${output}\n[runtime] ${describe(error)}`, exitCode: -1 };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

addEventListener('message', async (event: MessageEvent<RunRequest>) => {
  const { id, source, stdin } = event.data;
  try {
    await warmPromise;
    if (!toolchain) throw new Error('the C++ toolchain failed to load');
    // The toolchain is downloaded and warm: the caller's deadline should now be
    // measuring the program, not the CDN.
    post({ id, type: 'started' });

    const flags = [...DEFAULT_FLAGS];
    const extraFiles: Record<string, string | ArrayBuffer> = {};
    if (cachedHeader) {
      flags.push('-include-pch', PCH_PATH);
      extraFiles[PCH_PATH] = cachedHeader;
    }

    const compileStart = performance.now();
    const result = await toolchain.compile({ source, fileName: 'main.cpp', flags, extraFiles });
    const compileMs = Math.round(performance.now() - compileStart);

    if (!result.module) {
      // A compile error is a result, not a failure of the runtime.
      post({
        id,
        type: 'result',
        compileLog: result.compileOutput || '(compilation failed)',
        output: '',
        exitCode: null,
        compileMs,
        runMs: null,
      });
      return;
    }

    const runStart = performance.now();
    const { output, exitCode } = runProgram(result.module, stdin);
    post({
      id,
      type: 'result',
      compileLog: result.compileOutput || '',
      output,
      exitCode,
      compileMs,
      runMs: Math.round(performance.now() - runStart),
    });
  } catch (error) {
    post({ id, type: 'error', message: describe(error) });
  }
});
