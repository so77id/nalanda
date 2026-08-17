# ADR-0037: The scan-page image path is part of the worker's contract

**Status:** Accepted
**Date:** 2026-08-17
**Decision-makers:** Miguel Rodriguez
**Source:** #167 review (Round B, ADR-hunter finding)

## Context

WP-F's review page (`/controls/{id}/copies/{copy}/review`) needs the scanned
image of the copy on its left. The sibling endpoint `GET
/controls/{id}/copies/{copy}/page/{n}` serves the image, and today
`apps/server` reads it directly from the shared volume at

```
<work_dir>/controls/<id>/scans/copy-<copy>-page-<n>.png
```

That path is a NAMING MODEL of what `apps/amc-worker`'s `getimages`
subcommand writes into the AMC project's `scans/` subdirectory. Reading it
from the server means the server now knows a fact about AMC's on-disk
layout — and ADR-0031 §Consequences says the opposite:

> We depend on the engine's private storage, not only its CLI. The current
> reader opens AMC's `layout.sqlite`, `capture.sqlite` and `scoring.sqlite`
> directly and knows facts like `capture_zone.type = 4` and
> `scoring_question.type = 2` for a multiple-answer question. That coupling
> is deliberately confined to `read_capture.py` inside the worker image,
> which is what keeps an engine swap a container swap.

WP-F's review of its own diff (Round B) surfaced this as an ADR-worthy move:
the confinement clause is what makes reversing ADR-0030 (the engine choice)
a container swap. If a second site now models AMC's on-disk layout,
reversing the engine becomes a container swap **plus** an `apps/server`
change to a naming convention that only made sense for AMC.

## Decision

**The scan-page image path is part of the worker contract — same class of
promise as `/generate`'s response paths.** The worker is what produces those
files and the worker is what names them; `apps/server` opens whatever the
worker's naming convention says.

Concretely:

- `apps/amc-worker/README.md` §How it is driven (or its route table) states
  the path shape:
  `<project>/scans/copy-<copy_number>-page-<page_number>.png`.
  A fallback engine (OMRChecker or any other, ADR-0030 §Not yet proven) has
  to produce files under the same names — same rule as `sujet.pdf`,
  `corrige.pdf`, `calage.xy` for `/generate`.
- `apps/server` opens that path via `Service.ProjectDir(id) + "/scans/copy-N-page-M.png"`
  — the same shape both containers see because both mount the same volume.
- ADR-0031's confinement clause is amended, not reversed: `read_capture.py`
  is still the only site that knows AMC's sqlite schema
  (`capture_zone.type`, `scoring_question.type`, etc.). Filenames that live
  under `<project>/` on the shared volume are worker-produced but
  server-consumed, and the contract exists for exactly that seam.

## Alternatives considered

- **Route the image through a worker HTTP endpoint (e.g. `GET
  /scans/page`).** Cleaner theoretically: the server never touches AMC's
  on-disk paths, and ADR-0031's confinement clause survives verbatim.
  Rejected for V1: the image is on the same shared volume the server
  already reads (`sujet.pdf`, `corrige.pdf`), so the round trip buys no
  isolation while adding a request to the professor's page render. The
  moment there is a real reason for the worker to see the request (say,
  redacting the RUT strip before serving, or per-request auth), this ADR
  reopens.
- **Keep the coupling implicit** — no README section, no ADR. Rejected:
  ADR-0031's confinement clause is exactly the kind of decision that has to
  say what falls INSIDE and what falls OUTSIDE, and adding a second site
  without saying so is how the confinement clause quietly stops being true.

## Consequences

- **`apps/amc-worker/README.md` gains a `<project>/scans/` naming section**
  covering `copy-N-page-M.png`. Any change to the naming is a coordinated
  change across both apps — the same rule that governs `/generate`'s
  response paths.
- **The paper check is what pins the naming** (ADR-0030 §Not yet proven).
  Until then this ADR is provisional in one specific sense: if AMC's
  `getimages` produces a different filename shape than the code assumes,
  either this ADR's shape or the code's `Sprintf` has to move — and the
  move is one file.
- **Engine swap remains "a container swap + one contract to satisfy",**
  same as `/generate`. It stops being "a container swap plus a hunt for
  every place `apps/server` guessed at AMC's private naming" — which is
  what the confinement clause was there to prevent.

## References

- ADR-0030 — the engine and the container boundary.
- ADR-0031 — the reading report is the contract; its §Consequences carries
  the confinement clause this ADR extends.
- ADR-0034 — the backend is born with the controls; the `amc-work` volume
  seeding order.
- `apps/server/internal/app/web/handler/review.go` — the `PageImage`
  handler that consumes this contract.
- `apps/amc-worker/worker.py` — the `/analyse` handler that produces the
  files via AMC's `getimages`.
