# CLAUDE.md — Nalanda

## Description
Interactive CS learning platform. A single browser-only site where theory, presentation, interactive data-structure visualizations, and live code execution coexist. MVP uses a single course ("Data Structures in C++") as a testbed for the core widgets.

## Language
All code, comments, variable names, commit messages, and documentation must be in English. User-facing content (course materials) may be in Spanish.

## Stack
- **Frontend**: React 19, Vite 7, TailwindCSS 3
- **Code execution in browser**: WebAssembly via `@bjorn3/browser_wasi_shim` and `browsercc`
- **Editor**: CodeMirror 6 (`@uiw/react-codemirror`, lang-cpp, lang-python)
- **Animations**: framer-motion
- **Icons**: lucide-react
- **Lint**: ESLint 9
- **Smoke tests**: puppeteer-core scripts in `apps/frontend/smoke/smoke-test-*.mjs`
- **Deploy**: GitHub Pages (100% static)

## Development commands

All commands run from `apps/frontend/`:

```bash
cd apps/frontend
npm install                       # Install dependencies
npm run dev                       # Vite dev server (localhost:5173)
npm run build                     # Production build to apps/frontend/dist/
npm run preview                   # Preview the production build locally
npm run lint                      # ESLint
node smoke/smoke-test-*.mjs       # Run individual smoke tests (puppeteer)
```

## Logging
- Use `console.log/info/warn/error` in browser code; never leave debug logs in committed code
- Never log secrets, tokens, or personal data
- Prefer structured logging (`console.log({ component, event, data })`) when debugging cross-component flows

## JS/React conventions (non-obvious)
- Functional components only — no class components
- Hooks must follow Rules of Hooks (top-level, no conditionals)
- Components in `src/` follow a feature-first folder layout (widgets, course content, layout)
- ESLint rules are enforced (`react/jsx-uses-vars` is on); fix lints rather than disabling rules
- Keep components small — one concern per file. Extract shared logic into hooks
- Tailwind classes inline; avoid creating CSS files unless necessary
- Animations via framer-motion; do not introduce another animation lib

## Development Workflow

Four processes manage development. When a task arrives, identify the phase and invoke the corresponding skill:

- **Capture an idea** (no work yet) → `capture-idea` skill (creates a Discussion in the `💡 Ideas` category)
- **Refine an idea into a WP** → `refine-idea` skill (creates an Issue in Backlog with full body)
- **Develop a WP into a PR** → `develop-task` skill (worktree + TDD slices + 4-tier review + PR)
- **Promote items from Backlog to Ready** → `groom-backlog` skill

Each skill encapsulates the full process. Read `.claude/skills/<name>/SKILL.md` for detail.

### Hard rules

- **All changes go through PRs** — never push directly to `main`.
- **Squash merge** is mandatory for every PR (manual, by the user).
- **One commit per slice**; the slice list is in the issue body as checkboxes.
- **Test before commit**: lint passes AND smoke tests pass AND manual verification when applicable. Never commit untested code.
- **Trivial fixes** (≤3 lines, no logic, negligible risk) may bypass the system — see `docs/conventions.md` "yolo mode".

### References

- Conventions (kanban columns, labels, branch naming, commits, PR template, worktree+`.env`): `docs/conventions.md`
- ADRs (architectural decisions, when present): `docs/decisions/`

## Documentation
- **README.md**: Keep updated after architecture/feature changes.
- **Conventions**: `docs/conventions.md` (workflow conventions referenced by the skills).
- **Decisions**: `docs/decisions/` (ADRs, numbered sequentially) — created on demand.

## Rules for Claude
- Never modify `package.json` dependencies without discussing first
- Never modify `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, or `eslint.config.js` without user confirmation
- Never modify `package-lock.json` directly — let `npm install` regenerate it
- Never commit `node_modules/`, `dist/`, or `.env` files
- For UI changes, run the dev server and verify in a browser before reporting the task done; smoke tests and lint verify code correctness, not feature correctness
