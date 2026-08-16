# Security Notes

Durable record of security decisions that are not ADR-scale: accepted-risk
deferrals, advisory dispositions, and their review dates. Every deferral here
names its trigger for re-evaluation — nothing is "accepted forever".

## Deferred controls

### No branch protection on `main` (deferred 2026-08-10)

- **What is missing**: `main` has no ruleset. The hard rule "all changes go
  through PRs, never push to main" (CLAUDE.md) is convention, not enforcement.
- **Why it matters more since #66**: the deploy workflow triggers on push to
  `main`, so an accidental direct push publishes to a public URL with no review.
- **Why deferred**: single-maintainer repo; the owner decides whether to trade
  the ability to push directly for the guarantee. Not expressible in a diff —
  it needs repo admin rights.
- **Review trigger**: a second contributor gains write access, or the first
  accidental direct push. **When enabling**: require a PR; only make the `web`
  check _required_ after replacing ci.yml's path filters with in-job change
  detection — the note at the top of ci.yml explains why (a docs-only PR would
  otherwise wait forever on a check that never runs).

## Resolved advisories

### GHSA-qwww-vcr4-c8h2 — react-router RSC-mode CSRF (deferred 2026-08-06, RESOLVED 2026-08-10)

- **Affected**: `react-router` >=7.12.0 <8.3.0 (installed 7.18.2, transitive via
  `react-router-dom`).
- **Why deferred**: the vulnerable code path (RSC server actions) is unreachable —
  `apps/web` is a 100% static SPA (BrowserRouter/Routes/Route only, no server
  runtime — premise backed by ADR-0001/0004/0011; static hosting on GitHub Pages
  pending, WP5 #66). Verified independently by the security review lens
  (PR #67 pipeline run).
- **Resolution (2026-08-10)**: the advisory was later amended upstream — its 7.x
  range is `>=7.12.0 <7.18.2`, first patched in **7.18.2**, which is the version
  already installed. `npm audit` in `apps/web` reports 0 vulnerabilities.
  Nothing was ever exposed and no upgrade is owed; the original note's "patched
  line 8.3.0 — a major bump" was accurate against the advisory as published on
  2026-08-06 and is superseded. Kept as a record, not as an open deferral.
- **Lesson kept**: the deferral rationale (static SPA, RSC path unreachable) was
  the right call and cost nothing; re-checking with `npm audit` at each
  dependency review is what surfaced the amendment.

## Accepted invariants

### The control question bank is published, answers included (accepted 2026-08-16, #139)

**What.** Entrance-control questions live under `content/` beside the class they
belong to, with the correct alternatives marked in place, and the build emits
`questions.json` at the site root — every question with the index set of its
correct alternatives, in one file, at a stable public URL.

**Why it is accepted.** The bank is study material by design (`2026-08-controles.md`
C1): the repo and everything under `content/` are public either way, so a hidden
bank was never available without encryption or a second repo, and the page
reveals the answer to any reader who answers (C4). What the control measures is
whether the student read the class — not whether they can be prevented from
looking. The control that actually exists is the room: five minutes, on paper,
invigilated, no devices.

**What changed, and why it is recorded here anyway.** This fires the review
trigger written into §"Everything under `content/courses/` is published" — the
first time material that must not be seen needs a home. The disposition is that
this material MAY be seen, but the exposure is materially different from before:
an answer used to be revealed one question at a time, in the page, after the
student answered. It is now one GET.

**Review trigger.** The first control whose grade is meant to hold against a
device in the room, or the first course wanting a pool that is not published.
Either one means the bank stops being study material, and neither C1 nor this
record survives it — park that material outside `content/`, since omitting it
from the index is not a control.

### The site frames a third party, and the sheet decides what it exposes (accepted 2026-08-16, #146)

`<SheetEmbed>` is **the repo's first `<iframe>`**. It puts a document served by
`docs.google.com` inside a Nalanda page, so what that frame is allowed to do is
a decision rather than a default inherited by omission.

**What it is allowed**, each token loaded in a real browser against the course's
own plan before it was granted:

```
sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
referrerpolicy="no-referrer"
```

- **`allow-scripts`** renders the grid; without it the rectangle is empty.
- **`allow-popups` and `allow-popups-to-escape-sandbox` are one decision, not
  two.** The plan carries 14 `target="_blank"` links to the class decks. Without
  the first, the click is swallowed and the only trace is a console error the
  reader never sees. With the first but not the second, the deck opens and Google
  Slides then fails with "Se produjo un error" — the new tab inherits this
  sandbox and loses its own origin. Both halves were reproduced; neither works
  alone. `SheetEmbed.test.tsx` pins both tokens, so removing one goes red — what
  no test can see is the CONSEQUENCE, which is why any change to this string is
  re-measured in a real browser against a sheet carrying `target="_blank"` links.

  **State the capability, not only the symptom**: what the pair buys the frame is
  an unsandboxed new tab **at a URL the SHEET chooses** — outside `MdxLink`'s
  scheme allowlist, which every other link in this repo goes through, and outside
  PR review. It buys nothing against this origin (no `allow-same-origin`, no
  `allow-top-navigation`, no `allow` attribute, so Permissions-Policy's `self`
  default denies the frame every powerful feature): it is a link-to-anywhere
  primitive, not an origin compromise. The narrower option exists and was not
  taken, and it is editorial rather than attribute-level — **the 14 deck links
  could live in the MDX**, governed and reviewed, leaving the sheet to carry only
  the calendar, and then neither popup token is needed. That is a content
  decision this record owns, not a browser constraint.
- **`allow-same-origin` is deliberately NOT granted.** The sheet renders and
  scrolls both ways without it, so the frame's document runs in an opaque origin
  and cannot **script** Google's. Verified rather than assumed: all four sandbox
  combinations rendered the sheet identically.

  **This is not the same as "no Google session is involved".** The sandbox flag
  governs the origin of the resulting document, never the cookie jar of the
  request that fetched it: the frame carries no `credentialless` attribute, so
  loading `/preview` is an ordinary credentialed cross-site request and a
  signed-in reader is identified to Google as a viewer of this sheet — which
  names the course, whatever `referrerpolicy` withholds about the page.
  Accepted, in the same spirit as the CheerpJ and jsDelivr origins below and for
  the same reason: the alternative is not publishing the plan. `credentialless`
  would load the frame in an anonymous store and is worth measuring **before**
  adopting — a link-shared sheet may or may not still render — but it is not free
  and was not measured here.
- **`allow-top-navigation` and `allow-forms` are not granted**, and nothing
  read-only needs them. The frame cannot navigate the page around it.
- **`referrerpolicy="no-referrer"`** costs nothing measurable and stops Google
  being told which class page a reader was on.

**Why the frame is not, in itself, a new exposure.** A sheet shared as "anyone
with the link can view" is readable by anyone holding the link whether or not
this site frames it; framing changes who is likely to find it, not who is able
to. The frame is cross-origin, so it cannot read this site's DOM or its
`localStorage` (where drafts live — see below), and with `allow-same-origin`
absent it cannot read its own either.

**What is genuinely new**: a third origin the site depends on at render time,
alongside the two recorded under "Executing student code". Unlike those, this one
is not integrity-checkable at all — it is a document, not a versioned bundle, and
its content is whatever the spreadsheet says today. A future CSP must allow
`docs.google.com` in **`frame-src`**; not in `script-src`, because nothing from
Google runs in our origin.

**The sheet decides what it exposes, and that decision is not in this
repository.** Which columns a sheet carries is the professor's call, made in
Google Drive. Two consequences, stated before the second use rather than after
it:

- **A sheet that is not shared renders Google's own request-access page inside
  the rectangle.** That is cross-origin: nothing here can detect it, no test
  fails, and the document looks merely odd. The authoring guide says to look at
  the page.
- **The opposite mistake has no page to look at.** Everything above, and every
  instruction in the guide, is phrased in the read direction — "share it as
  _cualquiera con el enlace puede ver_". One position further down that same
  dropdown is _puede editar_, which is a plausible slip on a sheet a colleague
  is meant to fill in, and it publishes an **anonymously writable surface as
  part of a course page**. It is not passive: `/preview` is a read-only render
  surface and shows no editing chrome, so a reader has to take the frame's `src`
  and swap `/preview` for `/edit` — a deliberate act, and a trivial one for a
  CS student. Nothing here detects it, in either direction.
- **The grades sheet is the case this record exists ahead of.** Publishing one
  through this component would put student names and marks — **personal data
  under Ley 21.719**, the same classification §"The control worker is
  unauthenticated" gives RUTs and grades — on a public page behind nothing but
  an unguessable URL. That is exactly the material §"Everything under
  content/courses/ is published" reserves its review trigger for. Nothing about
  `<SheetEmbed>` decides it; the share setting on the sheet does, and that is
  outside this repo's review. A link-shared sheet also has no expiry and no
  deletion path once the link has travelled.

**Review trigger**: the first sheet carrying student identifiers or marks. **The
remedy does not exist yet, and that is the point of the trigger** — do not read
it as "put it behind the v0.3 auth". ADR-0009 is *professor-only*: "Only
professor logins exist… students remain anonymous spectators… no accounts", and
`docs/design/2026-08-controles.md` repeats that none are planned. So there is no
gate a student could pass, and the disposition until a student-identity decision
exists is **not to ship grades through this component at all**. Also: the first
`<SheetEmbed>` pointed at a host other than `docs.google.com`, which the
component refuses today and which would reopen every line above.

### Drafts live on an origin shared with every other repo of the account (accepted 2026-08-13, #85)

`localStorage` keys under `nalanda:draft:*` hold what a student had in an editor
at their last run — the mitigation for a Java loop that freezes the tab
(ADR-0017/0020). The site is served from `so77id.github.io`, a **user** Pages
site, so that origin is shared with every other repo of the account: any other
project published there, or an XSS in one, can write those keys.

**Fixed in #85**: a read-only listing never restores a draft. Every markdown
fence became an editor in that WP, and an unguarded read let planted bytes
replace an authored listing _and_ the payload of its copy button — demonstrated
end to end, then re-verified closed (18 editors, 108 planted keys, 0
overwritten). The rule lives at the value: `listing = !editable && !runnable` in
`CodeEditor.tsx`, and in `variants.ts` beside the preset that depends on it.

**Residual, accepted**: an _editable_ editor and `<Exercise>` still restore
drafts from that origin. That is the feature — it is the student's own work, and
losing it is the failure the draft exists to prevent. The blast radius is one
student's editor content on one machine, not the course material.

**Review trigger**: a custom domain (which would give the site its own origin and
close this), or the platform gaining any content path not authored in this repo.

### Executing student code pulls three toolchains from two third-party origins (accepted 2026-08-11, #74)

- **What happens**: running code fetches an entire toolchain from a host we do
  not control — on the first Ejecutar, or already at page load for a
  `warmOnMount` editor. Java loads `https://cjrtnc.leaningtech.com/4.3/loader.js` as a
  `<script>` **on the main thread** — full access to our origin and DOM — and
  that 7.5kB loader then pulls ~2MB of JS/WASM and streams the Java 8 class
  library on demand: measured 2026-08-12, **139 requests and ~16.6MB** in a
  single run, none of it integrity-checked. Python and C++ `import()`
  `https://cdn.jsdelivr.net/...` inside Web Workers.
- **Why it is this way**: bundling the C++ toolchain put 113MB of WASM into every
  deploy (ADR-0018); CheerpJ's Community licence forbids self-hosting outright
  (ADR-0016 F2). Only the Java _compiler_ (ECJ, 2.9MB, SHA-256 pinned in
  `scripts/fetch-java-compiler.mjs`) is served from our own origin.
- **Why SRI is not the control**: it cannot be applied to a dynamic `import()`
  at all, and pinning CheerpJ's 7.5kB loader while the ~16MB it goes on to fetch
  stays unpinned buys nothing. What we have instead: Pyodide and browsercc are pinned
  to **exact immutable versions** (npm cannot republish a version; jsDelivr
  caches them permanently), each with a test tying the downloaded build to the
  typed one. CheerpJ's `/4.3/` is a mutable minor channel — the finest pin the
  vendor offers.
- **Blast radius**: a compromised CDN is arbitrary script execution on
  `so77id.github.io/nalanda/` for every visitor. There is no login, no user data
  and no secrets on the site, so the loss is the integrity of what students see
  and run, not stolen credentials.
- **Availability, not just integrity**: a CDN outage breaks the Run button with
  no deploy and no warning — a class breaking mid-session. ADR-0016 records that
  the CheerpJ vendor can also disable it deliberately (origin restriction or
  `licenseKey` enforcement).
- **A future CSP must allow** `cjrtnc.leaningtech.com` and `cdn.jsdelivr.net`,
  plus `'unsafe-eval'` and `'wasm-unsafe-eval'`: CheerpJ JITs with
  `new Function`, so a CSP here is origin-allowlisting, never eval-blocking.
  That is why one is not shipped yet.

  **And, since #109, one inline script.** `index.html` stamps the reader's saved
  theme before the first paint, so `script-src` needs its `'sha256-…'` hash (or a
  nonce). It cannot be moved to an external file: an external script loads after
  the document paints, which is the theme flash the script exists to prevent. A
  CSP author who overlooks this does not break the site — they break it silently,
  for the readers who chose a theme, on every load.
  Nothing is exploitable today: GitHub Pages serves fixed headers and this repo
  ships no CSP (grepped, zero hits). The note exists so the constraint is found
  before it is discovered.

- **Review triggers**: (a) Leaning Technologies answers on the academic licence
  (ADR-0016 §3) — self-hosting CheerpJ removes one origin entirely; (b) any bump
  of `PYODIDE_VERSION` or `BROWSERCC_VERSION`, which re-opens the trust decision
  and should re-check the publisher, not be treated as routine; (c) the first
  class-time outage; (d) the platform gaining any non-repo-authored content path
  (a shared-snippet URL, a student-supplied document), which would change the
  blast radius from self-inflicted to cross-user.

### An exercise verdict is feedback, not evidence (accepted 2026-08-12, #76)

`<Exercise>` compiles the student's code beside a generated harness and reads the
verdict back from the program's own stdout. Two consequences, both demonstrated
in a real browser during the #76 review rather than reasoned about:

- **The verdict channel is forgeable.** A student who prints `[nalanda] PASS n`
  and calls `System.exit(0)` before any real case runs gets a clean green board.
  This is inherent to checking inside the student's page: the JVM, the marker and
  the parser are all theirs.
- **One page shares one JVM, one `/files/` and one launcher.** Before the reserved
  names landed, a student class named `NalandaLauncher` overwrote the launcher and
  forged a pass for every exercise on the page — including ones never opened. The
  names are now refused (`RESERVED_CLASSES`), but the sharing remains: any future
  platform class compiled into that directory is exposed the same way.

**Why this is acceptable today**: exercises are practice. Nothing is submitted,
nothing is graded, no other user is reachable, and the only person a student can
deceive is themselves.

**Review trigger**: the first time an `<Exercise>` result feeds a mark, a lab
check-off, attendance or any record — including anything a future backend
collects. At that point checking has to move off the student's machine; hardening
the in-band protocol would not be enough.

### The second platform class arrived (#116, 2026-08-14)

The trigger above also said to revisit "if a second platform class is ever
compiled alongside student code". `NalandaTrace` (ADR-0028) is that class. The
disposition:

- **It is recompiled on every run**, as the request's `library` unit, so a
  student class shadowing it from another editor on the page does not persist —
  the next run overwrites the shadow back. That is luck rather than design, and
  it is why the name joined `RESERVED_CLASSES` anyway.
- **The `library` field bypasses the reserved-name guard on purpose.** The guard
  exists to stop a _student_ class shadowing a platform one; the platform's own
  unit arriving there is the intended use. It is reachable only from a module
  constant, never from author or student content.
- **The guard still inspects the ENTRY class only.** The sentence above —
  "the names are now refused" — is true of the class a program is run as, not of
  a secondary class declared in the same file. `instrument()` closes that hole
  for `NalandaTrace` in a `trace` fence specifically; `NalandaLauncher` and
  `NalandaCheck` remain shadowable from a secondary declaration, with the same
  accepted-invariant reasoning as everything else in this section: the only
  person deceived is the student doing it.
- **The diagram makes no claim a verdict would.** It draws what a program did; it
  does not assert that anything passed. A forged `[nalanda] T ` line authors a
  drawing by hand, which is a student lying to themselves in a component whose
  whole point is not needing to.

Decisions: ADR-0019 §3b/§7, ADR-0020 §6, ADR-0028 §6/§7.

### Everything under content/courses/ is published (recorded 2026-08-10)

- **What it means**: the document registry globs `content/courses/**/*.mdx`, so
  every document is compiled into the bundle and reachable at `/d/<id>` — being
  absent from `index.yaml` only hides it from the TOC and prev/next, it does NOT
  keep it off the site. Since #66 the site is public, so "unlisted" reads as
  "unpublished" and is wrong.
- **Why it is safe today**: the repo is public anyway. **No longer only sample
  documents** — since #120 the tree holds the real opening class, with the
  professor's institutional address and the term's grading rules. Nothing there
  needs hiding, so the invariant holds; what changed is that it is now
  load-bearing rather than hypothetical.
- **Every document is on the teaching path again** as of #135, which deleted the
  three that were off it and put the fourth back. `documentBreadcrumb.test.tsx`
  asserts that set is empty — the suite's only registry→index check, and the
  thing that makes the trigger below enforceable rather than advisory. Everything
  else runs the other way (`contentIntegrity.ts` and
  `content/architecture.test.ts` walk the index and check each id resolves),
  which cannot see a document that is in `content/` and in no index.
- **The address is published on purpose**: `miguel.rodriguez@mail.udp.cl`
  appears on the opening class as an autolinked `mailto:`, the professor's own
  decision. Harm is harvesting at a university mailbox. Review trigger for this
  one: any address that is not the author's own, and any student address ever
  appearing under `content/`.
- **Review trigger**: the first time material that must not be seen (exam keys,
  solutions, unreleased classes) needs a home. Park it OUTSIDE
  `content/courses/` — omitting it from the index is not a control.

### Third-party marks under content/ (recorded 2026-08-15, #120 review)

- **What it is**: the opening class carries 22 brand and organisation marks in
  `content/courses/sample-course/logos/`. Twenty are Simple Icons files (CC0);
  the marks themselves stay their owners'. Two are rasters the course author
  supplied — one re-rendered and cropped, one whose original could not be
  recovered.
- **Basis of use**: nominative and educational. They identify the companies whose
  interviews cover this material, the competitions, and the languages a slide
  talks about. No endorsement is implied and none is used as this site's own
  branding.
- **Why it is accepted**: the repo has no LICENSE, and the review that found this
  also found the provenance existed only in a PR body. It is now recorded
  per-file in `content/courses/sample-course/logos/README.md`.
- **Review triggers**: a mark owner objects; the repo gains a LICENSE (code and
  content terms then need separating); or a new logo arrives that is neither CC0
  nor supplied by the author.

### All bundled MDX is repo-controlled content (recorded 2026-08-07)

- **What relies on it**: the presentation pipeline executes compiled MDX content
  functions directly (`apps/web/src/presentation/mdxChildren.ts`, ADR-0013), and
  MDX itself compiles content into arbitrary components (ADR-0003 by design).
  Both are safe only while every `.mdx` that reaches the build comes from the
  repo-controlled `content/` tree, reviewed like code.
- **Since #118 (2026-08-14), a third**: KaTeX renders author-written LaTeX in
  Node during the Vite transform (`src/content/rehypePlugins.ts`, ADR-0027).
  Injection was attacked and held — ten hostile documents produced red error text
  for every trust-gated command, never an anchor or an attribute — but **output
  size is unbounded**: an 80 kB `\begin{matrix}` produced 40 MB of compiled JSX
  in 29 s. Expansion bombs and deep recursion ARE bounded (`maxExpand`, and a
  stack overflow is caught and degraded). The realistic worst case today is burnt
  CI minutes or a wedged local build, not a compromise — CI runs on
  `pull_request` with `contents: read` and no secrets in the web job.
- **Why currently safe**: content ships exclusively via git + PR review; there is
  no runtime ingestion, no user-contributed documents, no CMS.
- **Since #146, this is a claim about MDX only, and it needs saying.** A
  `<SheetEmbed>` renders a document this repository never sees — the trigger
  below was considered and deliberately not fired, because a cross-origin frame
  is not what that trigger is about: it compiles nothing, reaches no build seam,
  and cannot inject into the MDX or KaTeX pipelines above. What it does instead
  is put content on the page that no PR reviewed, which is its own decision with
  its own record and its own triggers — §"The site frames a third party, and the
  sheet decides what it exposes", and ADR-0035, which qualifies this section by
  name. The two must stay reachable from each other.
- **Review trigger**: the moment ANY non-repo-authored content path appears —
  v0.2 authoring-agent output that bypasses PR review, a future in-platform
  editor (vision phase C), or user-submitted material. At that point the MDX
  pipeline and this adapter must be re-reviewed as an injection surface — and
  since #118 there is a second reason to re-review at that same moment: the
  LaTeX renderer above is a resource-exhaustion sink in the build.

### KaTeX runs with `trust: false` (recorded 2026-08-14, #118)

- **What relies on it**: `rehypeKatex` is passed `{ trust: false }` explicitly
  (`apps/web/src/content/rehypePlugins.ts`). It is KaTeX's own default, stated
  because flipping it is a direct attribute-injection: verified, `trust: true`
  makes `\href{javascript:…}{x}` emit a real `<a href>` **and** an `href` on the
  MathML `<mrow>`. React neutralises `javascript:` specifically, but the
  attribute channel is open and any other scheme rides it.
- **Why currently safe**: the default holds, it is pinned by a test
  (`mdxPipeline.test.tsx`, "refuses to build a link out of a formula"), and
  KaTeX-emitted elements resolve through the MDX component map where `a` is
  `MdxLink`, which already refuses non-`http(s)`/`mailto`/local schemes.
- **Review trigger**: anyone setting `trust` to anything but `false`, or adding
  `macros` that reach `\href`, `\url` or the `\html*` family. Decision and the
  attack record: ADR-0027 §6.

### Content images render through `<img src>`, never inlined (accepted 2026-08-14, #119)

Issue #119 gives documents images: SVGs under `content/courses/`, resolved through
Vite's asset pipeline and rendered by `content/MdxImage.tsx` and
`components/media/Figure.tsx`. SVG is the one common image format that can carry
script — a `<script>`, an `onload`, a `foreignObject`, an external `<use>`/`<image>`
— so how content SVG reaches the page is a security decision, not a rendering
detail.

- **The rule**: author-supplied content images are rendered exclusively via
  `<img src={url}>` (`content/MdxImage.tsx`, `components/media/Figure.tsx`). A
  browser disables scripting for an SVG loaded through `<img>`, so a script or
  event handler inside a content SVG cannot execute. Inline SVG and
  `dangerouslySetInnerHTML` on **author** content are forbidden: verified in the
  #119 review that the content-image path uses neither. (Inline `<svg>` does exist
  elsewhere — `components/interactive/MemoryState.tsx` draws a diagram from a
  program's execution trace, ADR-0028 — but that is platform-generated geometry,
  not author markup, and reaches the page as compiled component code, not as a
  content asset; `dangerouslySetInnerHTML` appears only in a test fixture. Neither
  is an author-injection surface.)
- **This is also why the glob asks for `no-inline`**: ADR-0029 §5 justifies
  `?url&no-inline` on bundle bytes, but the same lever is load-bearing here — an
  inlined SVG would render as markup, not through `<img>`, and lose the inertness
  above. The two records govern one lever; neither may be reversed alone.
- **Why it is safe today**: the committed SVGs are plain geometry (no `<script>`,
  no handlers, no external refs), and the `<img>` path keeps them inert even if
  one were not. Content ships via git + PR review (see "All bundled MDX is
  repo-controlled content").
- **Review trigger**: the first time a content SVG must be inlined — the usual
  reason is `currentColor` theming, which `<img>` cannot reach. At that point the
  SVG must be sanitised (strip scripts, handlers and external refs) before it is
  trusted, this invariant re-decided, and ADR-0029 §5 revisited with it. Equally,
  the first non-repo-authored content path, which changes who can author an SVG at
  all.

### The control worker is unauthenticated and trusts its only caller (accepted 2026-08-15, #138)

`apps/amc-worker` serves JSON on 8080 with no authentication, no rate limiting
and no audit trail, and it will handle RUTs and grades — personal data under
Ley 21.719. What holds it closed is **topology, not code**: it is reachable
only over the compose network by `apps/server`, and `infra/local/docker-compose.yml`
binds its published port to `127.0.0.1`.

The in-code guard is `under_work()`, which resolves every request-supplied path
and refuses anything outside `/work`. That is defence against a **bug in the
caller**, never against the caller itself.

**Residual, accepted**: anything that can reach port 8080 can read, overwrite
and delete every project on the shared volume, and nothing records who asked
for what. Two narrower residuals found in the #138 review and accepted with it:

- **Derived paths are not re-resolved.** `under_work()` validates the project
  root; `project_paths()` then joins `data/`, `cr/`, `scans/` onto it without
  checking again, so a symlink planted inside a project directs AMC's writes
  outside `/work` — as root. Reproduced. It is bounded by the same precondition
  as everything else here: planting the symlink already requires write access
  to the shared volume, and compose mounts a named volume, so "outside" is the
  container's own ephemeral filesystem rather than the host.
- **`detail` in an error response carries up to 4 kB of raw AMC output**, and
  AMC's association output names student identifiers verbatim. `apps/server`
  must surface it to a human in the review queue and must not log it.

**Review trigger**: the worker is published on any interface other than
loopback; a second component gains access to the compose network; the volume
holds more than one course at a time; or `apps/server` gains any path that
writes into `/work` on behalf of something other than itself. At that point
re-resolve the derived paths and reconsider authentication.

### The control worker runs as root and parses scans there (accepted 2026-08-15, #138)

`apps/amc-worker` has no `USER` directive and no `cap_drop`/`no-new-privileges`,
so AMC — and ghostscript, poppler and OpenCV underneath it — parse scanned pages
as uid 0. TeX Live's `openin_any = a` in the image also lets a compiled `.tex`
read any file the process can. (`shell_escape = p` does block `\write18`, so
there is no path to a shell from a document.)

**Why it is accepted rather than fixed**: the inputs are not untrusted in the
usual sense. A batch is raster pages off the professor's own scanner, and the
`.tex` is course material authored in this repo and reviewed in a PR. A `USER`
is also not free — it needs the shared volume's ownership arranged, and would
break the bind-mounted verification scripts on Linux CI, which is a real cost
against a threat that requires the professor to scan a hostile document.

**Review trigger**: the first input that does not come from the professor's own
scanner or this repository — a student uploading a photograph of their sheet, a
batch arriving from another system, or any path where `apps/server` accepts a
PDF it did not produce. At that point take the cheap half first (`cap_drop: [ALL]`
and `security_opt: ["no-new-privileges:true"]` in compose, `openin_any = p` in a
`texmf.cnf` override) before deciding on a non-root user.
