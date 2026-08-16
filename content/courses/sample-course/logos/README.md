# Logos — where they come from and on what basis

The three mosaics of the opening class (`01-bienvenida.mdx`) name companies whose
technical interviews cover this material, competitions worth training in, and
languages these structures are implemented in. The marks identify those
organisations; nothing here implies endorsement, and none of them is used as this
site's own branding.

Recorded because the repo has no LICENSE and these files are third-party marks —
the review of #120 found the provenance existed only in a PR body.

## The twenty vector marks

`amazon` · `apple` · `codeforces` · `cpp` · `csharp` · `go` · `google` · `java` ·
`js` · `kotlin` · `leetcode` · `meta` · `microsoft` · `netflix` · `nvidia` ·
`python` · `rust` · `spotify` · `swift` · `uber`

- **Source**: [Simple Icons](https://simpleicons.org), fetched 2026-08-14 from
  `cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg`. Eighteen came from
  **v16.28.0**, the version `@latest` resolved to.
- **Two came from older releases, because Simple Icons has removed them**:
  `amazon` last shipped in **v14.13.0** and `microsoft` in **v12.4.0** — the CDN
  quietly served those majors when `@latest` had no such file, which is worth
  knowing precisely because these are the two marks whose owners are most
  likely to care. Both were CC0 at the release they came from.
- **File licence**: **CC0-1.0** — the SVG files are public domain. The marks
  themselves remain their owners' property.
- **Modified**: each glyph carries an explicit `fill` at the brand's own colour.
  Simple Icons ships them unfilled, and an `<img>` inherits nothing, so an
  unfilled mark would default to black rather than to anything chosen. Geometry
  is untouched.
- Four slugs differ from the file name: `java` is `openjdk`, `cpp` is
  `cplusplus`, `csharp` is `dotnet`, `js` is `javascript`.

## The two raster marks

`icpc` · `ieeextreme` — academic organisations, not in Simple Icons.

- **Source**: supplied by the course author, 2026-08-14.
  `icpc` from `programacioncompetitivaufps.github.io/img/ACM-Logo1.jpg`;
  `ieeextreme` from a Google image thumbnail whose original could not be
  recovered.
- **File licence**: copyright of the mark owner. Used nominatively to identify
  the competition a slide talks about.
- **Modified**: `icpc` is **cropped** — the source carries an "IBM event
  sponsor" strip, and IBM stopped sponsoring the ICPC in 2018 (JetBrains since).
  The crop is in the pixels, not a `clipPath`: an earlier version hid the strip
  at render time and still served it in the bytes.

## Replacing one

The white plate they are read on belongs to `<Mosaic plate>`, not to these
files — so a new logo needs no background of its own, and its `fill` is simply
the brand's own colour reproduced faithfully.

Note what is NOT required: a logotype is exempt from the contrast minimum
(WCAG 1.4.11), and several of these do not clear 3:1 against the plate —
JavaScript's yellow is 1.35. That is the mark as its owner draws it, and the
group's meaning is carried by the mosaic's `description`, not by any one cell.
What a mark does need is an explicit `fill`, so it never inherits black by
accident.
