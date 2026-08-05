# Proof of Concept (2025 → May 2026)

This folder packages everything from Nalanda's first proof of concept and the May 2026
platform planning cycle. It was archived on **2026-08-05** when the project restarted
its design from zero (see `docs/design/2026-08-redesign.md`). Nothing here is active
work — it is a reference archive of working code and already-written ideas.

## Contents

```
proof-of-concept/
├── frontend/    The POC app (React 19 + Vite 7 + Tailwind 3) — still runnable
├── issues/      All 33 issues open at archive time, exported as markdown (INDEX.md)
└── decisions/   ADRs 0001–0003 from the May 2026 planning cycle (archived)
```

## What the POC proved

- **8 data-structure visualizers**: LinkedList, Stack, Queue, Array, BST, Heap, Graph, HashMap.
- **CodeEditor** (CodeMirror 6) with in-browser execution: C++ via `browsercc` + WASI
  (WebAssembly) and Python via Pyodide — zero server-side compute.
- **Presentation mode**: `h2`-based slide boundaries, keyboard navigation.
- One hardcoded lesson in `src/App.jsx` (no routing, no backend, no auth).
- Smoke-test suite with puppeteer-core (`frontend/smoke/`).

## Running it

```bash
cd proof-of-concept/frontend
npm install
npm run dev      # localhost:5173
npm run build
npm run lint
node smoke/smoke-test-stack.mjs   # against a running dev server
```

## Archived issues

`issues/INDEX.md` lists the full May 2026 roadmap that was discarded: 11 epics
(D1–D6 deliveries, E1–E11) and 22 spec issues (S1.x–S4.x). The spec bodies contain
detailed designs (content model, slide markers, CheerpJ runtime, Go backend, auth)
that remain useful as input for the redesign.

Related material that stays active outside this folder:
- `docs/course-graph.md` — course topology (51 topics); deferred until platform v0.1.
- GitHub Discussions 💡 Ideas — captured widget/feature ideas (still the live idea inbox).
