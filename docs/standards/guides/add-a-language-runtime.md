# Add a language runtime

How to teach Nalanda to compile and run a new language in the student's browser.

## When to use

A class needs code the student can execute in a language the platform does not
speak yet. Today it speaks Java, C++ and Python (`apps/web/src/runtime/`).

**Before you start**, answer two questions, because they decide the whole shape
of the work:

1. **Where does the toolchain come from?** If it is a package whose assets are
   addressed relative to its own module (`new URL(…, import.meta.url)`, which is
   the common case), bundling it makes those assets build outputs. browsercc's
   toolchain is 113MB; bundled, it shipped in every deploy. Load such a package
   **from a CDN** and keep the npm package as a `devDependency` for its types.
   Only self-host what genuinely has to be self-hosted — the Java compiler jar,
   which CheerpJ reads through our own origin.
2. **Can it run in a Web Worker?** Prefer yes. Java cannot (it needs the DOM to
   deliver output, ADR-0017), which is why the contract is `RuntimeWorker` — our
   own interface — rather than `Worker`.

## Worked example: what Python looks like

```
src/runtime/python/
├── descriptor.ts        # id, label, fileName, defaultCode, formatWarmStats
├── index.ts             # descriptor + codeMirrorLanguage() + createWorker()
├── pyodideVersion.ts    # the CDN build, pinned
├── pyodideVersion.test.ts
└── worker.ts            # the actual compile-and-run
```

## Step by step

1. **Add the id.** `RUNTIME_IDS` in `src/runtime/contract.ts`. It is the
   taxonomy; the registry decides what is implemented.

2. **Write the descriptor** (`<lang>/descriptor.ts`). Keep it free of compiler
   and CodeMirror imports: descriptors are listed in the language picker and
   travel in the entry chunk. `formatWarmStats` renders whatever timings your
   worker reports.

3. **Write the worker** (`<lang>/worker.ts`). It receives
   `{ id, source, stdin }` and answers exactly one of:
   - `{ type: 'warm', detail }` — once, unprompted, when booting finishes.
   - `{ id, type: 'result', compileLog, output, exitCode, compileMs, runMs }`
   - `{ id, type: 'error', message }` — **only** when the runtime itself broke.

   The distinction matters: **a program that fails to compile is a result**, with
   `exitCode: null` and the compiler's message in `compileLog`. An `error` means
   the machinery is broken, and the student sees an apology instead of a
   diagnostic.

   Do the expensive boot in a `warmUp()` promise at module scope and `await` it
   on every message, so the first Run is fast rather than the slowest.

4. **Write the module** (`<lang>/index.ts`): export `descriptor`,
   `codeMirrorLanguage()` and `createWorker()`.

5. **Register it** in `src/runtime/registry.ts`: the descriptor in
   `runtimeDescriptors`, and a `case` in `loadRuntime`. Keep the `case` a static
   `import('./<lang>')` — a computed specifier defeats chunk splitting and pulls
   every toolchain into one file.

6. **Pin the CDN build** if you load one, with a test comparing the constant
   against `package.json` (`pyodideVersion.test.ts` is the pattern). Types that
   describe a different build than the one you download are worse than no types.

7. **Verify it in a real browser.** The jsdom suite cannot run WASM, so it says
   nothing about whether your runtime works. Drive it with an ad-hoc Playwright
   script and check compile, run, stdin, and a deliberate compile error.

## Checklist

- [ ] Id added to `RUNTIME_IDS`; descriptor registered in `runtimeDescriptors`;
      `case` added to `loadRuntime`. The registry tests cover it automatically.
- [ ] Descriptor imports nothing heavy.
- [ ] Worker distinguishes a failed compile (`result`) from a broken runtime
      (`error`), and reports `warm` exactly once.
- [ ] Toolchain served from a CDN unless it must be self-hosted; npm package a
      `devDependency` in that case, with a version test.
- [ ] `npm run build` shows no new multi-megabyte asset in `dist/`, and the entry
      chunk is unchanged.
- [ ] Verified in a browser: run, stdin, compile error.
- [ ] An ADR if the runtime brought a real decision with it (ADR-0017 is the
      example: the compiler, the Java version and the thread it runs on were all
      forced by what the browser actually does).
- [ ] Per-commit protocol green (`docs/standards/testing-strategy.md`).
