# ADR-0076: A Drive file is a content source too, and what a framed file contains is the professor's call

**Status:** Accepted
**Date:** 2026-09-22
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #299. **Extends** ADR-0035 (a third-party frame is a content
source) to a second host and a second component, `<PdfEmbed>`, and **amends**
its grades disposition — an amendment rather than a supersession because what
is withdrawn is one Consequences bullet, not a numbered decision: ADR-0035's
§1–§6 all still hold, and the withdrawn text stays in place, marked, as the
reasoning of its day. Prefers Drive's viewer over the PDF.js that ADR-0047
vendored on the backoffice. Numbered 0076 to clear `0075-*`, held by an
unmerged branch (#298).

## Context

After each evaluation the professor publishes two things: the **pauta** (a PDF)
and the **grades** (a spreadsheet). The course needs a section, _Evaluaciones_,
with one document per evaluation showing both.

Two problems stood in the way.

**A PDF has no reliable viewer in a browser page.** The built-in viewers
disagree: `<embed>`/`<iframe>` of a PDF shows only the first page in Brave —
the professor's browser — which is why the backoffice moved to PDF.js
(ADR-0047), and Chrome on Android shows nothing in a frame at all, offering a
download instead. The site's readers are students, many on a phone.

**ADR-0035 blocked the grades.** Its §Consequences and
`docs/security-notes.md` recorded the disposition "not to ship grades through
`<SheetEmbed>` at all": a link-shared sheet of names and marks is personal data
under Ley 21.719 on a public page, and there is no student login to put in
front of it.

The professor's answer to the second, verbatim: _"yo subiré un excel y ese
excel es el que mostrará las cosas, nalanda se despreocupa de esto"_ — he
curates the file and owns what it shows.

## Decision

**1. A PDF is published by framing Google Drive's viewer, not by rendering it
here.** `<PdfEmbed src title height>`, family _media_, twin of `<SheetEmbed>`:
the author pastes the Compartir link of a Drive file, a pure
`drivePreviewUrl()` (`components/media/driveUrl.ts`) rewrites it to
`https://drive.google.com/file/d/<id>/preview`, and Drive draws the pages. Same
decoupling as ADR-0035 §1: the professor replaces the file in Drive and the page
follows with no commit and no deploy. The component does not read the file.

**2. The frame is granted `allow-same-origin`, and only because the host it starts at is
fixed.** Measured on 2026-09-22 with Playwright against Control 1's pauta, in
Chromium and WebKit, at 1440px and on emulated iPhone 13 and Pixel 7:

| sandbox                                                                    | result                                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `allow-scripts allow-popups allow-popups-to-escape-sandbox` (SheetEmbed's) | spinner never resolves; the viewer's own image requests are cancelled                                           |
| … + `allow-downloads`                                                      | same — not the missing token                                                                                    |
| … + `allow-same-origin`                                                    | "Página 1 de 6", all six pages render and scroll                                                                |
| no `sandbox` at all                                                        | renders                                                                                                         |
| `allow-scripts allow-same-origin`                                          | renders; the pop-out button does nothing                                                                        |
| … + `allow-popups`                                                         | pop-out opens `/view` in a new tab; that tab's **download button downloads nothing** (it inherited the sandbox) |
| … + `allow-popups-to-escape-sandbox`                                       | pop-out tab downloads `EDA_Control_1_2026_02_pauta_.pdf`                                                        |

So:

```
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
referrerpolicy="no-referrer"
```

`allow-scripts` + `allow-same-origin` lets a framed document remove its own
sandbox **only when it is same-origin with the embedding page**. The frame
**starts** at `drive.google.com` — `drivePreviewUrl` anchors scheme and host and
closes the host with the next `/`, so `drive.google.com.evil.example` is
refused — and the page is `so77id.github.io`. What the url check cannot pin is
where the frame goes next: the sandbox does not stop a frame navigating itself,
so the protection rests on Drive's own viewer never sending its frame to a
`so77id.github.io` page. Accepted: that would take Google's first-party viewer
navigating to this site, and the origin is the account owner's alone (though
shared by every repo of the account, `security-notes.md` §"Drafts live on an
origin shared…"). What the token does grant is the frame's real origin: Drive's
viewer reads its own cookies and storage, as it would opened directly.
`<PdfEmbed>` is the first **sandboxed** frame of ours to get the token.
`<VideoEmbed>` is framed with no `sandbox` at all — YouTube's player breaks
under one — which is more permissive, not the same grant. `<SheetEmbed>`'s
string does not change.

**3. What a framed file contains is the professor's decision, not the site's.**
ADR-0035's "not to ship grades through this component at all" is **withdrawn**.
The components frame and do not inspect — they never did — and the repository
no longer asserts a policy about the content of a file it cannot see. The Ley
21.719 classification of names, RUTs and marks stands as information for the
author, stated once in the authoring guide, not as a prohibition the repo
enforces. The professor publishes the grades sheet he curated.

**4. Evaluations are course documents.** A group `Evaluaciones` in the course
index (no `levelName`: it is not a Unidad), one `.mdx` per evaluation under
`content/courses/<course>/evaluaciones/`, `presentation: none`,
`questions: none`, with `## Pauta` + `<PdfEmbed>` and `## Notas` +
`<SheetEmbed>`.

## Alternatives considered

- **PDF.js in `apps/web` (`pdfjs-dist`).** The reliable renderer the backoffice
  already uses. Rejected: a new dependency and a worker to ship for one
  document type, a PDF committed per evaluation (so every correction is a
  deploy), and it would still need a download path. Drive gives rendering,
  zoom, page count and download for free, and keeps the no-deploy property.
- **Reuse the backoffice's vendored PDF.js.** Two copies of one library to keep
  in step across apps that deliberately share no build.
- **Native `<iframe>` of a committed PDF plus a download link.** Broken in
  exactly the two browsers that matter (Brave, Chrome on Android).
- **A download link only.** Works everywhere and shows nothing: the reader has
  to leave the page to read the pauta the page is about.
- **Keep the grades off the site** (per-student mail already exists, #287, or a
  pseudonymized sheet). Offered at refinement; the professor chose to publish
  the sheet he curates and own its content.

## Consequences

- **Another third-party origin at render time**: `drive.google.com`, plus
  Google's static hosts it pulls (`www.gstatic.com`, `apis.google.com`). A
  future CSP must allow `drive.google.com` in `frame-src`, as ADR-0035 did for
  `docs.google.com`.
- **It is heavier than the sheet, and far heavier than the app.** Cold profile,
  1440×900, the frame alone at 760×800, `request.sizes()` transfer bytes on
  2026-09-22: **44 requests, ~2.8 MB** — 1.7 MB of script (one 1.47 MB viewer
  bundle), 0.5 MB of stylesheet, 0.2 MB of fonts, and only ~0.3 MB of the PDF's
  own page images. That is about 16× the application's entry chunk (ADR-0035
  §Consequences records 171.5 kB gzip). A second visit is mostly cached. An
  evaluation page carries both frames, so it is the heaviest page on the site;
  accepted, because the alternative is not showing the pauta.
- **`loading="lazy"` defers nothing here**: on an evaluation page the pauta is
  the first block, well inside the ~4000px Chromium threshold ADR-0035
  measured.
- **Availability and correctness are Google's**, as with the sheet: an unshared
  file or Drive down frames Google's own page and nothing here can tell.
- **The published pauta is whatever Drive holds now.** Not versioned in the
  repo; that is the point, and also means a replaced file changes a page
  nobody reviewed.
- **A signed-in reader is identified to Google as a viewer of the file**, more
  directly than with the sheet since the frame now runs in Drive's real origin
  and reads its cookies. Accepted, as ADR-0035 accepted the credentialed request.
- **Drive paints its own dark ground** around the page in both themes — a
  second document we do not paint (`design-system.md` third exemption).
- **Grades are published whenever the professor links a grades sheet.** The
  site does not stop him and does not try; the review trigger in
  `security-notes.md` is rewritten accordingly.

> **Measurements to fill in (owner: Miguel Rodriguez, deadline: before the
> first deck that carries a `<PdfEmbed>`, tracked in #300):**
>
> - **`resourcekey`.** Google adds it to share links of files older than its
>   2021 security update, and without it such a file frames the request-access
>   page. `drivePreviewUrl` carries it into `/preview?resourcekey=…`, the way
>   `sheetUrl.ts` carries a `gid`; Control 1's file has none, so nothing has yet
>   shown `/preview` honours it. Measure: a pre-2021 link-shared PDF, framed
>   with and without its key.
> - **The touch drag inside the frame on a slide.** The fifth browser check
>   `testing-strategy.md` asks of a cross-origin frame that can appear on a
>   slide, and `<PdfEmbed>` can (it has the slide cap). Drive's viewer handles
>   vertical touch scroll itself, so ADR-0035's sheet result does not carry
>   over. Today's only use, `control-1`, is `presentation: none`. Measure: a
>   `<PdfEmbed>` on a slide, dragged on a real touch context.
