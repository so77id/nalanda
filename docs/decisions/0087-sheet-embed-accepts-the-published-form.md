# ADR-0087: `<SheetEmbed>` accepts the published form, and a published range is a view, not a filter

**Status:** Accepted
**Date:** 2026-10-15
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #336. **Amends** ADR-0035 §3, which normalised every sheet
to `/preview` and refused the Publicar-en-la-web link. An amendment, not a
supersession, as ADR-0076 was: §1, §2 and §4–§6 still hold, and §3 still holds
for the share link. Numbered 0087 to clear `0084-*`, held by the unmerged
branch of #326.

## Context

Solemne 1's grades went up with a `<SheetEmbed>` in #335, on the share link.
A share link frames the whole spreadsheet through `/preview`: every column,
the students' names included, and every tab.

The professor wanted to publish the grades without the name columns, and
already had the link for it: Google's Publicar en la web dialog, narrowed by
hand to `pubhtml?gid=0&single=true&range=D1:Y27`. ADR-0035 §3 refused that
form, for two reasons. The first was a bug: the first url pattern accepted it,
captured the literal `"e"` of `/d/e/` as the spreadsheet id and framed a 404
(#146 review). The second was a preference, recorded among its alternatives:
publishing to the web is a second setting the professor must not forget, and
`/preview` needs only the share setting, which has to be right anyway.

The issue proposed accepting the form on the premise that `range=` hides the
columns outside it. **That premise is false**, and the reason it is false
shapes most of what follows. Measured on 2026-10-15 against the professor's
own published sheet, reading only the shape of each response (rows and cells
per row), never its content:

| Request on the same token                     | Result                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `gid=0&single=true&range=D1:Y27`              | 200; the grid has 29 rows, at most 23 cells a row                                       |
| `gid=0&single=true` (no `range`)              | 200; 55 rows, 27 cells a row: the whole tab                                             |
| `gid=0&single=true&range=A1:C27`              | 200; 29 rows × 3 cells, 49 of them shaped like a full name: the columns D1:Y27 leaves out |
| `gid=1`, `2`, `3`, `99999`                    | 401 — but the file has one tab, so these are tabs that do not exist, not tabs left unpublished |

So `range` and `single` choose what the frame **shows**. What is **published**
is the set of tabs ticked in the dialog, and nothing narrower: anyone who reads
the frame's `src` in the page source and edits its query reads the rest of the
published tab. Two more facts, from the same day:

- `single=true` does **not** hide the tab bar, as the issue expected. It
  limits the frame to one tab, and a strip naming that tab ("Hoja 1") stays at
  the foot.
- The `D1:Y27` range itself carries a column of 25 RUT-shaped values. RUTs
  are personal data under Ley 21.719, as names are (`docs/security-notes.md`).

The form itself frames cleanly: HTTP 200, and neither `X-Frame-Options` nor a
`frame-ancestors` directive on the page or on the grid it loads (`curl -sI`,
re-measured 2026-10-15).

## Decision

**1. One component accepts both forms, and tells them apart by shape.** The
author pastes what they have. `sheetEmbedUrl()` (`components/media/sheetUrl.ts`,
renamed from `sheetPreviewUrl`, which no longer described what it returned)
rewrites a share link to `/preview` exactly as before, and frames a published
link **verbatim**, query included. A separate `<PublishedSheet>` was the other
option and costs a second name, a second catalog entry and a second set of
authoring errors for what an author experiences as "a link to my sheet".

**2. The published link is passed through, not rebuilt.** Its query is the
author's choice of what the frame shows; parsing it would mean deciding which
of Google's parameters matter, and a rewrite that dropped one would show
something else. Verbatim is safe because nothing in the query can move the
frame off `docs.google.com`: the pattern anchors the scheme and the host, as
the share pattern does, and also **closes the path at `pubhtml`**
(`(?:[?#]|$)`), since `…/pubhtml/../../document/…` would otherwise pass and
resolve to another document. Every other `/d/e/` url — the CSV and PDF
outputs of the same dialog — is still refused rather than rewritten, which is
the #146 bug staying fixed.

**3. The sandbox string does not change.** Measured in Chromium against the
published sheet: under
`allow-scripts allow-popups allow-popups-to-escape-sandbox` it renders;
without `allow-scripts` the grid is empty; adding `allow-same-origin` changes
nothing. So both forms share one string, and a test pins that they do. The
popup pair was not re-measured here, because this sheet has no links; it
rests on the share form's evidence (ADR-0035 §4).

**4. A published range is a view, never a privacy control, and the docs say
so wherever the form is offered.** A column a reader must not see goes in a
tab that is not published, never merely outside the range. That is the one
form of privacy this link supports: a tab carrying only the publishable
columns (`=Hoja1!D1:Y27`), published alone, with the file's own sharing set
back to _Restringido_ so the share link stops opening the original. Both
halves of that are what Google's dialogs offer, **not measured here**: the
401s above were on tabs that do not exist, so nothing has yet shown an
existing tab left out of the publication being refused, nor a published sheet
still serving once its sharing is restricted. Whoever first relies on it
checks both on the sheet, the way the guide says. The component cannot see
any of this, which is why the statement lives in
`sheetUrl.ts`, the catalog entry, the authoring guide (§6g) and
`security-notes.md` rather than in a check.

## Alternatives considered

- **A separate `<PublishedSheet>` component.** Rejected (decision 1): more API
  for the same act.
- **Parse the query and keep only `gid`, `single` and `range`.** Rejected
  (decision 2): it puts the site in the business of Google's parameters, and
  it would not make `range` any more of a filter than it is.
- **A tab with `=Hoja1!D1:Y27` under the share link.** `/preview` shows every
  tab, so a reader clicks "Hoja 1" and sees the names. Privacy in appearance
  only — and the same is true of `range` on a published link, which is the
  measurement above.
- **A second spreadsheet fed by `IMPORTRANGE`.** Works: a separate file shares
  nothing with the original. It duplicates the file and keeps an import
  authorised. The single published tab of decision 4 gets the same separation
  inside one file.
- **Keep refusing the form.** Keeps ADR-0035's single setting, and leaves the
  professor no way to show fewer columns than the whole sheet.

## Consequences

- **Two links that behave differently**, and an author choosing between them
  should know how:

  | | Share link (`/edit` → `/preview`) | Published link (`/pubhtml`) |
  | --- | --- | --- |
  | Setting it needs | "Cualquiera con el enlace puede ver" | Archivo → Compartir → Publicar en la web |
  | What anyone holding the link can read | The whole spreadsheet, every tab | Every published tab, whole |
  | What the frame shows | Every tab, with the tab bar | One tab with `single=true` (its name still shows at the foot); `range` trims the columns |
  | Changing what the frame shows | Edit the spreadsheet | Edit `src` in the MDX — a commit — or the publication in Drive |

- **Whether a published sheet follows edits is not measured.** Google's dialog
  has an option to republish automatically on change, but nothing here has edited a published sheet and watched the frame. Nor has
  anything measured whether the token survives unpublishing and republishing.
  Until someone does, an author who changes the sheet looks at the page.
- **The weight is the share form's.** Cold, the frame alone at 760×480,
  `request.sizes()` transfer bytes, the same sheet both ways: `/preview` 12
  requests and ~578 kB, the published form 9 requests and ~566 kB. The Google
  stylesheet ADR-0035 measured at ~490 kB (494 kB today) dominates both.
- **Solemne 1 ships the professor's link as given**, his decision under
  ADR-0076 §3, taken with the table above in front of him: the frame shows the
  RUT column and the grades, and the names sit in the published tab, one edited
  query away. That is less than the share link it replaces, which framed the
  names outright; it is not nothing. The share link is in the public history
  of #335 and still opens the original until its sharing is restricted.
- **If Google stops honouring `range`, the frame shows the whole tab** with
  every test green. Since `range` was never a permission, that exposes nothing
  a reader editing the url could not already read.
- **A future CSP needs nothing new for it**: the published page and the grid
  it loads are both served from `docs.google.com`, which ADR-0035 already
  names for `frame-src`.
