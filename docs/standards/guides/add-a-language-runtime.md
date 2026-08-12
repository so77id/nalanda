# Add a language runtime

How to teach Nalanda to compile and run a new language in the student's browser.

## When to use

A class needs code the student can execute in a language the platform does not
speak yet. Today it speaks Java, C++ and Python (`apps/web/src/runtime/`) — a
list maintained by hand, so step 8 exists to update it and its siblings.

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
   - `{ id, type: 'started' }` — once per request, immediately before compiling.
     It marks the boundary between *waiting* and *running*: before it, the caller
     allows 180s (CDN download, boot, queue); after it, 60s for the program.
     **Omit it and a student's infinite loop is reported three minutes later as
     "el runtime no estuvo listo"** instead of naming the loop.
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

   **If it cannot run in a worker** — implement `RuntimeWorker` by hand and
   return it from `createWorker()`; it is our interface, not the platform's, so
   nothing forces a real `Worker` (ADR-0018 §2). Java is the worked case
   (`src/runtime/java/`): when the engine is a per-page singleton, keep its
   state — boot promise, run queue — at **module** scope, not inside the
   factory, or two editors run concurrently against one shared engine and cross
   their output. Say plainly what `terminate()` can do: for Java it detaches
   listeners and cannot stop the JVM, so a CPU-bound program on the main thread
   is unbounded (ADR-0017 §3).

5. **Register it** in `src/runtime/registry.ts`: the descriptor in
   `runtimeDescriptors`, and a `case` in `loadRuntime`. Keep the `case` a static
   `import('./<lang>')` — a computed specifier defeats chunk splitting and pulls
   every toolchain into one file.

6. **Pin the CDN build** if you load one, with a test comparing the constant
   against `package.json` (`pyodideVersion.test.ts` is the pattern). Types that
   describe a different build than the one you download are worse than no types.

7. **Verify it in a real browser.** The jsdom suite fakes the worker and
   CodeMirror, and has no `Worker`, no CheerpJ DOM loader and no network — so
   nothing there compiles or runs, whatever WebAssembly Node itself provides. A
   green suite says nothing about whether your runtime works. Playwright is not a project dependency yet
   (L5 in `testing-strategy.md` is still pending), so drive it ad hoc from the
   scratchpad:

   ```bash
   npm install playwright && npx playwright install chromium   # once, in the scratchpad
   npm run build && npm run preview -- --port 4174             # NOT `npm run dev`
   ```

   Point the script at `/nalanda/d/codigo-ejecutable` (the demo document, one
   editor per variant) or `/nalanda/catalog/c/CodeEditor` (live examples per
   language) — and at the preview server, not the dev one: the deployed base path is part of what you are testing (the Java
   runtime resolves its compiler jar through `import.meta.env.BASE_URL`, so
   `/` and `/nalanda/` exercise different paths — ADR-0015). Check compile, run,
   stdin, and a deliberate compile error.

8. **Update what enumerates the languages by hand.** `RuntimeId` widens
   silently when you add an id, so nothing fails: `CodeEditor.catalog.tsx` (the
   description and the `language` prop's type string), `apps/web/README.md`'s
   stack paragraph, `guides/add-a-course-document.md` step 5, and §When to use
   at the top of this guide.

## Checklist

- [ ] Id added to `RUNTIME_IDS`; descriptor registered in `runtimeDescriptors`;
      `case` added to `loadRuntime`. The registry tests cover it automatically.
- [ ] Descriptor imports nothing heavy.
- [ ] Worker distinguishes a failed compile (`result`) from a broken runtime
      (`error`), reports `warm` exactly once, and sends `started` once per
      request before compiling.
- [ ] Toolchain served from a CDN unless it must be self-hosted; npm package a
      `devDependency` in that case, with a version test.
- [ ] `npm run build` shows no new multi-megabyte asset in `dist/` — unless it
      genuinely must be self-hosted, and you say why here as ADR-0017 does for
      the Java compiler jar — and the entry chunk grows by descriptors only:
      single-digit kB, no CodeMirror, no toolchain.
- [ ] Verified in a browser: run, stdin, compile error.
- [ ] Every hand-written list of languages updated (step 8) — the type system
      will not catch these.
- [ ] An ADR if the runtime brought a real decision with it (ADR-0017 is the
      example: the compiler, the Java version and the thread it runs on were all
      forced by what the browser actually does).
- [ ] Per-commit protocol green (`docs/standards/testing-strategy.md`).
