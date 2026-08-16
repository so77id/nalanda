# ADR-0035: A third-party frame is a content source

**Status:** Accepted
**Date:** 2026-08-16

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
`/preview` works with nothing but "anyone with the link can view"; `/pubhtml` and
`/htmlembed` work but first require publishing the sheet to the web; `/edit` is
refused by Google's own `frame-ancestors`. Since `/edit` is exactly what the
Compartir button hands an author, a pure module (`sheetUrl.ts`) rewrites the
share link and keeps the `gid`, and refuses any other host with an authoring
error. The failure it replaces is silent — a refused url frames a blank
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
- **Availability is Google's.** If Drive is down or the sheet is unshared, the
  rectangle shows Google's own page and nothing here can tell — cross-origin. The
  authoring guide's instruction is to look at the published page.
- **The exception is narrow but real**: `security-notes.md` §"All bundled MDX is
  repo-controlled content" still holds for MDX, and now has a neighbour that does
  not. What a `<SheetEmbed>` shows is outside PR review by construction.
- **The next use is the grades**, and it is not free. Framing a grades sheet puts
  student names and marks on a public page behind an unguessable URL. That fires
  the review trigger already written for student data; the component does not
  decide it, the share setting does.
- **No `overflow-x-auto` on the wrapper**, which reads as an ADR-0013 §5.2
  oversight and is not: the sheet's scroller is inside another document, so the
  deck never sees the touch. Measured on a phone in landscape — dragging inside
  the frame left `?slide` untouched, dragging beside it moved a slide.
