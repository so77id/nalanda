# Guide — Add a course document

How to add (or move) a document in a Nalanda course. Registered in
`docs/standards/integration-guides.md`; born with WP2 (#63). Decisions behind
this design: ADR-0002 (ids, graph + index), ADR-0003 (MDX), ADR-0012 (pipeline),
ADR-0013 (presentation).

## When to use

You are writing course material: a new sección/presentación, an exercise page,
any content unit. No app code is involved — everything happens under `content/`.

## Worked example

The seed course `content/courses/sample-course/` exercises everything:

```
content/courses/sample-course/
├── 01-bienvenida.mdx          # id: bienvenida        (presentation: auto — h2 slicing)
├── 02-intro-estructuras.mdx   # id: intro-estructuras (auto, uses <SectionBreak/>)
├── 03-busqueda-binaria.mdx    # id: busqueda-binaria  (presentation: explicit, uses <Slide>)
├── 04-apuntes.mdx             # id: apuntes-del-curso (presentation: none — book-only)
└── index.yaml                 # the ordered teaching path
```

Note the file names carry an ordering prefix but the **ids don't** — identity is
the frontmatter `id`, never the path. v0.1 supports exactly ONE course directory
(enforced at app startup); multi-course arrives with a later WP.

## Step-by-step

1. **Create the `.mdx` file** anywhere under `content/courses/<slug>/`. The
   folder/file layout is serialization only — organize freely, moves/renames
   never break links or routes as long as the id stays.

2. **Frontmatter** (required, YAML between `---` fences at the very top):

   ```mdx
   ---
   id: busqueda-binaria # kebab-case, UNIQUE across the whole content/ tree
   title: Búsqueda binaria # shown in the TOC, prev/next, and lookups
   presentation: explicit # OPTIONAL: auto (default) | explicit | none
   ---
   ```

   `presentation` controls the document's slide form (ADR-0013): `auto`
   (default when absent) slices the deck on `h2` headings; `explicit` decks
   ONLY content marked with `<Slide>` / `<SectionBreak/>` (loose prose stays
   book-only); `none` means book-only — no Presentar toggle, `/present`
   redirects back.

3. **Write prose in Markdown.** Headings h2–h4 get automatic slug anchors
   (deep-linkable). Code fences render book-style.

4. **Mark slides (optional)**: `<Slide title="...">...</Slide>` and
   `<SectionBreak />` are available WITHOUT imports. In the book view a Slide
   renders as its heading + flowing prose and a SectionBreak as a subtle
   divider; in presentation they cut slide boundaries. Worked example:
   `03-busqueda-binaria.mdx`. Full usage docs, props and live examples for every
   document-facing component live in the catalog: `/catalog/c/Slide`,
   `/catalog/c/SectionBreak`.

5. **Cross-reference with wiki-links**: `[[otro-id]]` renders that document's
   link, `[[otro-id|texto visible]]` overrides the label. A target that doesn't
   exist does NOT fail the build: it renders visibly broken (red wavy underline)
   and logs a console warning — forward links to drafts are allowed on purpose.

6. **Register it in the teaching path** (`index.yaml`) if it belongs to the
   recorrido. Schema (strictly validated; unknown keys fail the build):

   ```yaml
   entries: # root key (the only one allowed)
     - docId: bienvenida # leaf entry: just a document reference
     - label: Fundamentos # group entry: children + label (required unless it has a docId)
       levelName: Unidad # optional display name for the level (D8)
       children:
         - docId: intro-estructuras
         - docId: busqueda-binaria
   ```

   Depth-first order of `entries` = reading order (TOC, prev/next, and `/` lands
   on the FIRST entry — by convention the course welcome document). A document
   not listed in the index is still compiled and served at `/d/<id>`: **the index
   controls navigation, never visibility.**

7. **Verify**: `npm run build` from `apps/web/`. The contentIntegrity gate fails
   the build (and CI — `content/**` triggers it) with a file-and-field message
   on: missing/non-kebab/duplicate `id`, missing `title`, invalid `presentation`
   value (must be auto, explicit, or none), malformed `index.yaml` (unknown key,
   group without docId nor label, empty children), duplicate or unknown `docId`
   in the index.

8. **Publish**: merging to `main` republishes
   <https://so77id.github.io/nalanda/> automatically — `content/**` is a deploy
   trigger (ADR-0015). **Everything under `content/courses/` becomes public**,
   listed or not: material that must not be seen (exam keys, solutions,
   unreleased classes) does not belong here — omitting it from the index is not
   a control (`docs/security-notes.md` §Accepted invariants). Check the document
   on the live URL after the merge.

## Checklist

- [ ] Frontmatter has kebab-case `id` (unique) + `title` (+ `presentation` if
      the default `auto` doesn't fit).
- [ ] Wiki-links point at real ids (or are intentional forward links).
- [ ] Listed in `index.yaml` if it belongs to the recorrido.
- [ ] `npm run build` green from `apps/web/` (content integrity gate).
- [ ] Content language: Spanish is fine (user-facing course material).
- [ ] Nothing here must stay private — merging publishes it at `/d/<id>`.
