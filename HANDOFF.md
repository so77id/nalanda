# HANDOFF — issue #304, PR #320 (delete this file before merge)

Written 2026-10-08 so another agent, on another machine, can continue the work.
**Delete this file in the final version of the PR** (Miguel's instruction).

## Where things stand

- Issue **#304**, *Course document: Estructuras de Datos · Priority Queue y
  Heap*, is on the board **In Progress**. Its body carries the slice checklist
  and a **"Decisions taken at development start"** section (decisions 1–6).
  Read that section first: it overrides parts of the original Design.
- Branch `feat/issue-304-edd-priority-queue-heap`; **draft PR #320** against
  `main`.
- **S1–S10 are done**: one commit per slice, each green on the per-commit
  protocol. After S10 the branch merged `origin/main` (6 commits: surveys
  #314–#317, Recursos #319, Solemne 1 #306). The merge had no conflicts; only
  `index.yaml` was touched on both sides.
- **S11 (review pipeline) has NOT run.**

## Open items, in order

1. **`apps/web/src/app/presentationRoute.test.tsx` fails after the merge with
   `main`** (it fails at file level; the other 1966 tests pass). It is not
   diagnosed. Two hypotheses:
   - **Machine load.** The previous machine had a load average of 20–90, the
     suite timed out several times, and runs only passed with
     `npm run test -- --maxWorkers=3`.
   - **A real interaction** with the documents `main` added (`solemne-1`,
     `encuesta-etc`, a new `Recursos` group in `index.yaml`). That file pins
     slide counts and fixtures of other documents
     (`add-a-course-document.md` §2), so read its failure message.

   Before S10 the full suite was 2008/2008 green.
2. **Run S11**: `/agentic-workflow:review-pipeline` over `main...HEAD` in
   integrated mode, through `/agentic-workflow:develop-task 304`. This is a
   resume: the worktree and branch exist and S1–S10 are checked, so it
   continues at S11.
3. Fill in the PR body's AC evidence and "Reviews run" after the pipeline.
   Then mark the PR ready, move the kanban to Review, and comment on the issue.
4. **AC 20 is Miguel's**: the slide-by-slide visual walk. Do not report it as
   done.
5. Delete this `HANDOFF.md`.

## What was built (so you do not re-derive it)

**Content**: `content/courses/sample-course/20-edd-priority-queue-heap.mdx`,
id `edd-priority-queue-heap`.

- The deck has 61 slides: a headless opening plus 8 `h2` acts (Dos
  implementaciones ingenuas · El heap binario · Insertar y extraer del heap ·
  El min-heap · PriorityQueue en Java · HeapSort · Ejercicios · Lo que sigue).
  `Lo que sigue` is book-only, with no `<SectionBreak/>` before it.
- `questions: none` is a documented not-yet; the bank is a separate WP after
  merge.
- **`HeapPicture`** is an `export function` local to the `.mdx`
  (§6e-quater). It draws a static tree, an array, or both, and its geometry
  matches the widget's.
  - Props: `values`, `n`, `view` (`tree` | `array` | `both`), `hot`
    (1-based indices drawn in accent), `levelBrackets`, `label`.
  - Do NOT name a prop `levels`: it collides with a local variable and the
    build fails.
- Exercises (Miguel's choice): worked on slides are *Top-K de una secuencia*
  and *Un planificador de tareas*; posed in the book are *El k-ésimo mayor*
  and *La verificación de un max-heap*. All four were run on the real JVM in
  S10 and behave as intended.

**Widget** (`apps/web/src/components/interactive/`):

- `sequenceStepperTrace.ts` has the new recipe `heap-max` with operations
  `insert`, `extract-max`, `build-heap` and `heapsort`.
  - These four are valid only on `heap-max`, and `heap-max` accepts only
    them.
  - Frame fields `heapSize` (the listing's `n`) and `phase`; cell states
    `swap` and `sorted`.
  - `insert` grows with `resize(2 * data.length)`, as the dynamic array does
    (decision 5).
  - `sink` is a single shared listing text for the three operations that
    sink.
- `sequenceStepperHeapLayout.ts` is the pure geometry for the tree and the
  array (`data[0]` included).
- `SequenceStepper.tsx` adds `HeapView` (side by side on a slide, stacked in
  the book), the readout `n`, and «no se usa» under slot 0.
- `insert-ordered` gains the `descending` prop (decision 1: the naive ordered
  PQ keeps its maximum at `head`).
- Tests:
  - The trace tests cover every n from 1 to 8.
  - The layout has its own test file.
  - `SequenceStepper.test.tsx` has the block
    *"the combinations 20-edd-priority-queue-heap mounts"*: the 7 mounts the
    document ships, each walked to its last frame.
- Docs: **ADR-0077** (0078–0082 are taken by the surveys on `main`);
  ADR-0074 is marked *Extended by*; `add-a-course-document.md` §2 and §5h;
  `teach-a-data-structure.md` §1, §2 and §7.
- Follow-up issue **#305**: extract `<TdaCard>`. This class made the 5th copy
  by decision 2.

## Deviations from the issue's spec, already stated in the issue and PR

- 8 `h2` instead of 9: the opening act carries no heading
  (`teach-a-data-structure.md` §1).
- Titles rewritten to `course-content-style.md` §5: no interpunct subtitles.
- The spec's slide 26, «Los otros invariantes», was not written because it
  would be a recap act.
- A closing-trade slide, «Lo que el orden débil no responde», was added at the
  end of the HeapSort act.
- No `heap-min` recipe: the min-heap block is prose plus static figures.

## Traps that already cost time here

- **`ControlButton` uses `aria-disabled`, never native `disabled`.** A test
  that loops "click Adelante until disabled" must read
  `getAttribute('aria-disabled') === 'true'`.
- **`<StepShow code={`…`}>` is dedented by the attribute's indentation** (2
  columns). Indent the listing body 2 extra columns in the source, and leave
  the closing `}` at 2 spaces (§6bis).
- **Restart `vite preview` after every `npm run build`**, or you measure an
  old build. Kill it with `pkill -f "vite preview"`.
- The pre-commit hook blocks `sleep` loops. Start the preview with
  `run_in_background` and just curl it.
- Prettier never runs over `docs/` or `content/`; `format:check` covers
  `apps/web` only.
- There is no Playwright in the repo. Install it in a temp folder
  (`npm i playwright`), never in a repo manifest. On macOS the previous
  machine reused the browsers in `~/Library/Caches/ms-playwright`.

## How S10 measured the deck (recreate it; the script was in a temp dir)

Under `npm run build && npx vite preview --port 4173`:

- **What to read on each slide.** For every slide `i = 1..N` of
  `/nalanda/d/edd-priority-queue-heap/present?slide=i` (1-indexed; N comes
  from the footer counter, `61`):
  - the scale: the first number of `getComputedStyle(stage.firstElementChild).transform`
    on `[data-testid="slide-stage"]`;
  - overflowing listings:
    `[...document.querySelectorAll('.cm-scroller')].filter(e => e.scrollWidth > e.clientWidth + 2).length`;
  - `[data-authoring-error]`.
- **Themes.** Force a theme with
  `context.addInitScript(t => localStorage.setItem('nalanda:theme', t), 'dark')`.
- **Results at S10, 1440×900.**
  - Every slide is at scale ≥ 0.70, with 0 overflows and 0 authoring or
    console errors.
  - The lowest slides are 10, 11, 24, 27, 43, 44 and 53 (0.705–0.732). Any
    content edit there can drop them below the floor.

Exercises were checked by clicking **Comprobar** on each `<Exercise>`. For the
posed ones, the solution fence was typed into the editor
(`.cm-content` → Meta+A → insertText). Expected results:

- Top-K 4/4 and the scheduler 3/3 from their starters.
- The scheduler without its tiebreak fails case 1 with
  `[caída, parche, correo, informe, respaldo]`.
- The posed starters fail; their solutions pass 4/4 and 5/5.

## Repo rules to keep in mind

The chat with Miguel is in Spanish; code, docs and commits are in English.
Commit messages go through `git commit -F <file>`. Always push with an
explicit refspec (`git push origin <branch>:<branch>`), because
`push.default=matching`. Push after every commit.
