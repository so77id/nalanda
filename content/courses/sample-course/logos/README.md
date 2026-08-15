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
  `cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg` (v16.28.0).
- **File licence**: **CC0-1.0** — the SVG files are public domain. The marks
  themselves remain their owners' property.
- **Modified**: each glyph carries an explicit `fill` at the brand's own colour
  (Simple Icons ships them unfilled, and an `<img>` never inherits the page's
  `currentColor`, so unfilled they paint black and vanish on the dark theme).
  Geometry is untouched.
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
files — so a new logo needs no background of its own. A monochrome mark needs an
explicit `fill` that clears 3:1 against white; a mark that is black by design is
fine as it is, because the plate is what it sits on.
