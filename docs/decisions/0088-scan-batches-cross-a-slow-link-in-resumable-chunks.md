# ADR-0088: Scan batches cross a slow link in resumable chunks

**Status:** Accepted — AC-14 live check outstanding (owner Miguel, tracked in
#339, which stays open until it runs)
**Date:** 2026-10-24
**Decision-makers:** Miguel Rodriguez
**Extends:** ADR-0047 §4 — the first first-party module under `/static/js/`.
**Source:** #339, from two failed uploads on the Jetson (2026-10-23),
diagnosed from its request log. Decisions 1–3 below are Miguel's
(2026-10-24); the rest was settled in the issue's specification.

## Context

A scan batch was ONE request: the control page's and a survey run's scans
page's multipart form. `httpserver.readTimeout` (15 s) bounds a request's
headers **and** body, so any batch the link could not carry in 15 s was cut,
whatever `NALANDA_MAX_SCAN_MB` allowed.

Measured on the Jetson: on 2026-10-23 two `POST
/controls/MOZMMCHZLSQ3NEKN2P7CO5APNM/scans` from Miguel's work network, over
Tailscale, ended `status=403 duration_ms=15002` and `15001`; on 2026-10-24
the same control's 11.4 MB batch took 1298 ms from the home LAN. 11.4 MB in
15 s needs ≈ 6 Mbit/s of sustained upstream, which the work network did not
have.

The 403 was a second defect. `middleware.VerifyCSRF` parses a multipart body
before the handler runs, to find `csrf_token`; the read deadline expired
inside that parse, and the professor read "Solicitud no autorizada." — a
permissions problem they did not have, with no WARN in the log to say
otherwise. The survey run's upload had the same shape. Miguel uploads from
networks he does not control (work, classroom, a phone's hotspot), so this
recurs.

## Decision

### 1. The protocol: five kinds of request, all professor-gated

```
POST   /controls/{id}/scans/uploads                   start    → 201 {upload, received, chunk, chunks, complete}
POST   /surveys/{id}/runs/{rid}/scans/uploads         start    → 201 (same shape)
PUT    /uploads/{uid}?offset=N   (raw bytes)          chunk    → 200 {received}
GET    /uploads/{uid}                                 status   → 200 {received, size}
DELETE /uploads/{uid}                                 cancel   → 204
POST   /controls/{id}/scans/uploads/{uid}/complete    complete → 200 {redirect}
POST   /surveys/{id}/runs/{rid}/scans/uploads/{uid}/complete
```

- **start** validates everything it can before a byte of the batch travels:
  the subject (the control exists; the run exists and is open), `0 < size ≤
  NALANDA_MAX_SCAN_MB`, a PDF name or type, and for a control the threshold
  band. The resolved thresholds ride with the upload to complete.
- **chunk** appends at `offset`. A different offset is a 409 carrying what the
  server holds, and writes nothing. A body that DECLARES more than the 1 MiB
  chunk cap (`Content-Length`, checked before a byte is read), or that runs
  past the upload's declared size, is a 413 and writes nothing. A body with no
  `Content-Length` keeps what `MaxBytesReader` let through before refusing
  (1 MiB), like any cut chunk, and its 413 carries `received`; the page never
  sends one — `fetch` with a `Blob` body always declares its length. A body cut part-way — the link dropped (400) or the
  read deadline passed (408) — KEEPS the prefix that arrived: those are the
  right bytes at the right offset, so even a link too slow to carry a whole
  chunk inside 15 s progresses on every request.
- **status** is how the page resynchronises after any error.
- **complete** checks every byte arrived and the bytes start `%PDF-`, then
  calls the subsystem's EXISTING `SaveUploadedBatch` and `Runner.Submit`, in
  the one-request form's order, and sets the form's own flash. The partial is
  removed only after `SaveUploadedBatch` returned, so the batch-survives rule
  (#210) holds unchanged: the batch is on disk before anything is queued.

The answers are **JSON for the page's script**, on the web surface. Errors
are `{"message": "<Spanish>"}`, shown verbatim, plus `received` wherever the
page should resume from a number; internal errors go to the log only. No
answer is cached. An expired session needs no new shape: the gate still
redirects to `/login`, so a page arriving where JSON was expected means
"sign in again" — and so does the shell's 403 when the session's token went
stale because the professor signed in again in another tab.

### 2. The state is two files on the shared volume, and a neutral package

`internal/domain/uploads` keeps every partial under `<WorkDir>/incoming/`:
`<uid>.part` holds the bytes, and **its size is how many arrived** — no table,
no counter, nothing that can disagree with the disk, which is what lets a
server restart (a Watchtower deploy) lose nothing. `<uid>.json` holds the
professor, the subject (two flat fields, `subject_kind` and `subject_id`),
the name, the declared size and the subsystem's opaque `meta`; it is written once, through a temp file
(`<uid>.tmp`) and a rename. The package is neutral because the surveys may
not import the controls (ADR-0078):
`TestTheUploadsDomainImportsNeitherSubsystem` fails the build if it reaches
either.

`incoming/` sits beside `controls/` and `surveys/`, never inside a project the
worker resets, so "Borrar escaneos" cannot reach a partial. But the worker
mounts the same volume as root, so everything read back from it is
re-validated: only `^<uid>\.(part|json|tmp)$` names directly under `incoming/`
are ever opened, written or removed (anything else is logged and left); files
are opened with `O_NOFOLLOW|O_NONBLOCK` and must be regular — the second flag
so that a FIFO is refused instead of blocking `open(2)`; the sidecar must
parse, name its own uid, a subject kind in the closed set with a present,
bounded id, a positive professor and a size within the cap. A uid outside its
26-character `[A-Z2-7]` shape is refused before any path is built. What is
NOT defended: `incoming/` itself replaced by a symlink is followed
(`security-notes.md`, accepted residual).

Every operation on one upload — append, complete, cancel, the sweep, the
eviction — takes that upload's in-process lock, so the sweep cannot delete a
file mid-append and a double complete cannot save two batches. That relies on
one server process (ADR-0050) and on ONE `uploads.Service` shared by every
handler, which `cmd/server/main.go` constructs once.

### 3. Bounds (decisions 2 and 3)

- 1 MiB chunks: the conservative bet against a proxy that caps or buffers
  request bodies. What is already known: the server is reached only through
  `tailscale serve` (port 8443, `DEPLOY-JETSON.md` §The Funnel), which carried
  the 11.4 MB batch of §Context in ONE request from the home LAN, and the two
  cuts at exactly 15 s from the work network show it streams a body rather
  than buffering it whole. What is not: Funnel ingress from a device outside
  the tailnet.

  > **Measurements to fill in (owner: Miguel, deadline: 2026-11-07, tracked in
  > #339 — the PR is "Refs", so the issue stays open until this runs):**
  > - one control upload and one survey-run upload from a non-LAN network,
  >   through the public Funnel URL: whether every 1 MiB `PUT` answers 200 and
  >   advances `received` by 1048576;
  > - the request log's `duration_ms` range for those `PUT`s.
  >
  > A `PUT` that does not arrive whole, or a range near 15 s, reopens the
  > first review trigger below.
- At most 4 open uploads per professor. A fifth **removes their
  least-recently-grown partial instead of refusing**: a refusal would block a
  professor for up to a day behind partials they can neither see nor cancel.
- A partial that has not grown for 24 h is swept, at boot and hourly. The
  server cannot tell a closed tab from a link that is down, so the window is
  long enough for a dropped connection to come back. Cancelar removes one at
  once.
- No global cap: an eviction across professors would let one cancel
  another's upload. The disk is bounded at 4 × `NALANDA_MAX_SCAN_MB` per
  professor for at most a day.

### 4. CSRF from a header

`VerifyCSRF` accepts the token from `X-CSRF-Token`. When the header is present
it is the ONLY token considered — compared in constant time, no fallback to a
body field — and the body is not parsed, since a chunk is raw bytes. The
backoffice surface (`internal/app/web`) answers no CORS preflight, so a
cross-origin page cannot set the header at all; `internal/app/api` is
expected to answer CORS one day (§C12), which must never reach this surface.
The CSRF decision itself — one token per session, constant-time comparison —
is ADR-0036's, unchanged. The new routes are in the table, so
`TestEveryStateChangingRouteVerifiesCSRF` covers them unchanged.

### 5. The one-request form stays, and says what happened

The form still posts to its multipart route, so a page whose script did not
load uploads as before. When the read deadline cuts that body inside
`VerifyCSRF`'s parse, the answer is now **408**, "La subida tardó demasiado y
se cortó…", with `WARN "upload body read timed out"` naming path and
professor; every other parse failure keeps its 403 and gains a WARN with the
error.

### 6. The page: one module under `/static/js/`, one partial for its markup

The behaviour is a first-party module, `static/js/chunked_upload.mjs`, served
under `/static/js/` — where ADR-0047 §4 put stateful first-party JS ("No
stateful behaviour is authored inline… it belongs in a first-party `.mjs`
under `internal/app/web/static/js/`, not in a template"). It enhances any
`form[data-chunked-upload]`; the attribute is the URL that opens an upload,
and the start answer hands it every other URL it uses (`chunks`, `complete`),
so the file knows no route of the server's.

`templates/partials/chunked_upload.html`, parsed into the layout for every
page, holds what is markup: `chunked_upload_status` (a `<progress>`, an
`aria-live` line, Reintentar and Cancelar) inside the form, and
`chunked_upload_script`, the one `<script type="module">` tag that loads the
module, once per page.

The script retries forever with a back-off of 1 to 30 s while the tab is open
(decision 2: Cancelar is the professor's), warns on `beforeunload` while bytes
are in flight, and on Reintentar after signing in again re-reads the token
from the page it lives on — no route hands out tokens. Every string it shows
is Spanish. A reload or a page change abandons the upload (decision 1): the
partial is swept. Nothing in `go test` runs it; every change to it is checked
in a real browser (`testing-strategy.md`).

The first draft of this WP put the whole script inline in the partial; the
pre-PR review found it contradicting ADR-0047 §4, and it moved (#339 review,
ARQ-1).

## Alternatives considered

- **A longer read window on the upload routes.** It fixes a slow link and not
  a dropped one or a restart, every later route that wants a long body would
  ask for the same exception, and it opens exactly the slowloris window the
  global bound exists to close. Here every request still lives under 15 s.
- **The tus protocol.** The right shape, but its server and client libraries
  are dependencies (`go.mod`'s direct set is deliberately two), and the five
  kinds of request above (seven routes) are all of it this needs.
- **A table for the offsets.** The offset IS the file's size; a row would be
  a second truth to keep in step with it, and a crash between the two would
  have to be repaired by someone.
- **Refusing a fifth upload.** See §3.
- **Resuming after a reload** (the uid in `localStorage`). A non-goal by
  decision 1: the file itself would have to be picked again anyway.
- **Parallel chunks.** More throughput on a good link, which is not the
  problem; on a bad one it multiplies the requests that time out.

## Consequences

- An upload of any size up to the cap survives a slow link, a dropped link, a
  server restart and an expired session. Measured in Chromium against the
  compose stack, upload throttled to 1 Mbit/s, 12.5 MB and 12.1 MB image
  scans (2026-10-24): a clean upload took 106 s at 8.4 s per chunk, under
  the 15 s bound; 30 s offline, a `docker compose restart server` and a
  deleted session row each resumed from the server's `received` (5 MiB)
  without re-sending a byte; every stored batch hashed the same as its
  source, and its analyse job finished. The module these numbers describe is
  the one at 486bea8 (unchanged since): the clean, offline and Cancelar runs
  were repeated on the stack built from 492dbd4, and the restart, the
  session and a survey run with both offline and a restart on 479f8f2.
- When a session expires mid-chunk the server answers the gate's 303 without
  reading the rest of the body, so the browser sees a reset and the page says
  "Sin conexión" for one back-off step before the status request finds the
  login page and says the session expired. Measured, and left: the right
  message arrives a second later.
- The chunked path is bounded by `NALANDA_MAX_SCAN_MB` at start and by the
  chunk cap per request. The one-request path still is not: its body is parsed
  by `VerifyCSRF` before the handler's `MaxBytesReader` runs (#311 review,
  SEC-3, unchanged here).
- The page's script is the first first-party module under `/static/js/`, and
  the first script on this surface that changes state; it adds no inline
  `<script>` (the CSP trigger in `security-notes.md` is about those — see its
  "Trigger status after #339"). A change to it is unfinished until it ran in
  a browser.
- A complete whose batch was saved but whose job could not be queued still
  answers `{redirect}`, with a flash that names the failure: the partial is
  gone by then, so a 500 would send the page into a retry that finds nothing
  (#339 review, COR-3).
- `incoming/` is a third kind of thing on the shared volume. Its partials are
  never copied anywhere (#338).

## Review triggers

- AC-14 shows Tailscale serve or Funnel caps or buffers bodies below 1 MiB:
  lower `uploads.ChunkBytes` (the page takes the size from start's answer).
- A second server process, or a second `uploads.Service`: the in-process
  per-upload lock stops serialising anything.
- A third subsystem uploads batches: a new `uploads.SubjectKind` (and the
  same member in `jobs.SubjectKind`, which names it), its own start/complete
  pair, and the sidecar's closed set grows with it.
- Any CORS header reaching `internal/app/web` — for example a CORS
  middleware mounted above both surfaces: the header-only token stops being
  out of a cross-origin page's reach.

## References

- #339 (the issue, with the measured incident and Miguel's decisions).
- ADR-0050 (one in-process runner; one process), ADR-0078 (the survey
  subsystem's boundary), ADR-0047 (what `/static/` is for), ADR-0036 (the
  CSRF decision §4 adds a transport to), ADR-0034 (the shared volume's
  seeding rule, which #339 found wrong and amended), ADR-0079 (the job
  subject's closed set, which `uploads.SubjectKind` mirrors).
- `apps/server/CLAUDE.md` §"The uploaded scan batch survives…" and the
  chunked-upload bullet beside it.
- `docs/security-notes.md` §"Chunked uploads read the shared volume
  defensively".
