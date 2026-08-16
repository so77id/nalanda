# ADR-0035: A third-party frame is a content source

**Status:** Accepted
**Date:** 2026-08-16
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #146. Extends ADR-0010 (component contract) and ADR-0029 (the
media family); applies ADR-0013 §5.1 (a slide is fit, not reflowed) and ADR-0022
(the reading measure); measured with ADR-0018 §7's method, whose lazy-wrapper
rule it does not fire. **Qualifies** the premise in `docs/security-notes.md`
§"All bundled MDX is repo-controlled content": what a `<SheetEmbed>` shows is
the first thing a reader sees that this repository never reviewed.
Numbered 0035 rather than 0033 to clear the unmerged `0033-*` held by the
branches of #147 and #149, which this branch cannot see — renumber at merge if
either lands elsewhere.

## Context

Two things the course must publish live in spreadsheets and change on their own
schedule: the week-by-week plan (27 dated classes) and the grades. Both are the
professor's working files, edited in Google Drive between classes.

Until now every byte a reader sees came from this repository. A document is
`.mdx` under `content/`, reviewed in a PR, compiled into the bundle
(ADR-0003/0012); an image is an asset beside it (ADR-0029); even a runnable
listing is authored here and merely _executed_ elsewhere. `security-notes.md`
§"All bundled MDX is repo-controlled content" is written on that premise.

A calendar typed by hand into MDX is wrong the first time a class moves, and a
document that must be re-typed each term stops being true while still looking
authoritative. The alternative the professor asked for, verbatim: _"solo sea un
rectangulo donde se renderiza la planilla"_.

This is also the repository's **first `<iframe>`**, and no CSP is declared, so
the decision is not only "can we show a sheet" but "what is this site willing to
embed at all".

## Decision

**1. A shared Google Sheet is a legitimate content source, framed read-only.**
`<SheetEmbed src title height>` (family _media_) renders one. The professor edits
the spreadsheet; the page follows with no commit and no deploy. That decoupling
is the entire point, and it is a deliberate exception to "everything a reader
sees is reviewed in a PR" — bounded to a rectangle whose contents this site never
interprets.

**2. The component does not read the data.** No CSV, no parser, no columns, no
transformation, no search. Google renders the sheet; we frame it and say how
tall. Tidying happens in the spreadsheet. This keeps the exception narrow: the
site has no opinion about the data, so it cannot be wrong about it.

**3. `/preview` is the embed url, and the component normalises to it.** Four
forms were loaded in a real iframe against the course's own sheet on 2026-08-16:
`/preview` works with nothing but "anyone with the link can view"; `/pubhtml`
requires publishing the sheet to the web (401 without it); `/htmlembed` works on
a merely link-shared sheet but shows no tab bar and no chrome; and `/edit` is
the one to avoid — **not because Google blocks it**, which was the first
explanation here and is wrong (it sends neither `frame-ancestors` nor
`X-Frame-Options`, checked with `curl -sI`), but because framed under this
component's sandbox, without `allow-same-origin`, the editor's own requests fail
and it paints the grid behind a "Se ha producido un error" dialog with the
editing chrome visible. Since `/edit` is exactly what the
Compartir button hands an author, a pure module (`sheetUrl.ts`) rewrites the
share link and keeps the `gid` — that last part **unverified**, since the
course's own sheet has one tab and nothing has distinguished a working tab
selector from an ignored one — and refuses any other host with an authoring
error. It also refuses the *published* form, `/spreadsheets/d/e/<token>/pubhtml`,
which is a different identifier that the first pattern accepted and turned into
a framed 404 (#146 review). The failure it replaces is silent — a refused url frames a blank
rectangle whose only trace is a console violation nobody sees.

**4. The frame's permissions are measured, not inherited.**

```
sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
referrerpolicy="no-referrer"
```

`allow-same-origin` is not granted: the sheet renders and scrolls both ways
without it, so the frame stays in an opaque origin. The two popup tokens are one
decision — the plan carries 14 `target="_blank"` links to the class decks, and
neither half works alone. The evidence and the review triggers are in
`docs/security-notes.md`.

**5. `title` is a runtime contract**, enforced like `<Figure>`'s `alt`
(ADR-0029). An iframe has no accessible name of its own, MDX is not typechecked,
and the reader who needs the name is the one who cannot see that it is missing.

**6. Height is a decision, capped on a slide.** An iframe has no content-driven
height. The default is 480px; on a slide the frame is `min(height, 64vh)`, the
same budget and the same reasoning as `<Mosaic>` — a slide is fit and uniformly
scaled (ADR-0013 §5.1), so an oversized frame is not clipped, it shrinks the
whole slide with its title.

## Alternatives considered

- **Fetch the sheet as CSV and render our own table.** Rejected by the professor
  before it was built, and rightly: it would put this site in the business of
  parsing someone else's file, break on every column the professor adds, and lose
  the cell colouring that carries meaning in the real plan (holidays, recesses,
  the two solemnes). It would also be the only design here that could show
  something the sheet does not say.
- **A build-time snapshot** (fetch at build, commit the result). Keeps everything
  repo-controlled and keeps the CSP closed, but reintroduces exactly the failure
  this WP exists to remove: the page is only as fresh as the last deploy, and a
  class that moves on Tuesday is wrong until someone remembers.
- **Publish the sheet to the web and use `/pubhtml`.** Works, and needs a second
  setting the professor must not forget; `/preview` needs only the share setting
  that must be right anyway.
- **Type the calendar into MDX.** The status quo. It is the thing that is wrong
  the first time a class moves.

## Consequences

- **A third origin the site depends on at render time**, joining the two in
  `security-notes.md` §"Executing student code". Unlike those, it is not
  integrity-checkable: it is a document, not a versioned bundle. A future CSP
  must allow `docs.google.com` in `frame-src`.
- **It is the heaviest thing this site serves, and the weight is not ours to
  reduce.** Measured on `/d/planificacion` at 1440×900, cold profile, against
  the same page built from `main`: 5 requests / 190 kB becomes 15 requests /
  762 kB. The third-party half is 570 kB across 10 requests, and **490 kB of it
  is one already-gzipped Google stylesheet** — 2.9× the application's entire
  entry chunk (171.5 kB gzip). Google serves its static assets with
  `max-age=31536000`, so a second visit costs 34 kB / 10 requests. The method is
  ADR-0018 §7's, and the number is recorded for the same reason: an author
  choosing between a frame and a typed table cannot otherwise know the frame is
  three times the app. Measured on the merge commit's build, from a cold
  profile, counting `request.sizes()` transfer bytes; a throttled figure was
  taken too and is deliberately **not** recorded, because the throttling profile
  was not written down with it and a number nobody can re-derive is worse than
  none.
- **Registering it eagerly is the cheap half**, measured on the same build
  (main 535,310 → branch 540,879 raw, +1.0%). Only **1,463 bytes** of that is
  component code and registration: dropping just `sheetEmbedCatalogEntry` from
  the seam and rebuilding gives 536,773, so the other 4,106 bytes are catalog
  prose, which travelled eagerly for every component, lazy or not — **until #122
  moved the entries behind a dynamic import**. That term is gone: the eager cost
  of registering this component is the 1,463 bytes of component code alone, and
  the conclusion below holds a fortiori. No new
  eagerly-shipped package; `architecture: what the shell reaches eagerly` is
  untouched. A lazy wrapper would defer 1.4 kB while the 570 kB above stayed
  exactly where it is.
- **`loading="lazy"` is close to inert here.** Measured in Chromium: a lazy
  iframe defers nothing until roughly **4000px** below the fold, and the frame
  on `/d/planificacion` sits at 325px, the two on `/catalog/c/SheetEmbed` at
  1149px and 1883px — all three load with the page, and scrolling produces no
  further request. The attribute is kept because it costs nothing and pays off
  the day a frame lands at the foot of a long document, but no page should be
  designed as though the sheet were deferred.
- **Availability is Google's.** If Drive is down or the sheet is unshared, the
  rectangle shows Google's own page and nothing here can tell — cross-origin. The
  authoring guide's instruction is to look at the published page.
- **The exception is narrow but real**: `security-notes.md` §"All bundled MDX is
  repo-controlled content" still holds for MDX, and now has a neighbour that does
  not. What a `<SheetEmbed>` shows is outside PR review by construction.
- **The obvious next use is the grades, and it is blocked.** Framing a grades
  sheet puts student names and marks — personal data under Ley 21.719 — on a
  public page behind an unguessable URL, and there is no student login to put in
  front of it: ADR-0009 is professor-only and no student accounts are planned.
  The disposition until a student-identity decision exists is not to ship that
  data through this component at all. The component does not enforce it; the
  guide, the catalog entry and `security-notes.md` all say it.
- **No `overflow-x-auto` on the wrapper**, which reads as an ADR-0013 §5.2
  oversight and is not: the sheet's scroller is inside another document, so the
  deck never sees the touch. Measured on a phone in landscape — dragging inside
  the frame left `?slide` untouched, dragging beside it moved a slide.
- **§6's slide cap ships with no real-content user.** The one document that
  carries a `<SheetEmbed>` is `04-planificacion.mdx`, which is `presentation:
  none` — it is `presentationRoute.test.tsx`'s no-deck fixture (ADR-0025), so
  the course calendar cannot be projected at all. The cap was measured on a
  throwaway document and is exercised today only by unit tests and
  `/catalog/c/SheetEmbed`. Worth knowing before trusting it in a class: the
  first deck that wants a sheet moves that fixture first, and should re-measure
  on the real projector rather than inherit these numbers.
