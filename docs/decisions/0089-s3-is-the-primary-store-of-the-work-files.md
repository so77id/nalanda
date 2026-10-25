# ADR-0089: S3 is the primary store of the work files

**Status:** Accepted — measurements outstanding: S3-CHECK on the laptop
before the merge (#338 AC-14), the migration, the drill and the rollback on
the Jetson after it (AC-15…18); owner Miguel, the results written into
§Measurements below
**Date:** 2026-10-25
**Decision-makers:** Miguel Rodriguez
**Amends:** ADR-0038 (what leaves the box), ADR-0052 (the purge's order,
and its lock), ADR-0034 (`/work` becomes a working copy), ADR-0050 (the
worker lock's shape), ADR-0075 (the reset under S3)
**Source:** #338, refined with Miguel on 2026-10-24 (an interview, then the
issue's specification); every decision in §1 is his.

## Context

Until #338 the only thing Nalanda copied off the Jetson was the SQLite
database — daily, `backups/`, thirty days (ADR-0038). Every FILE the controls
and the surveys produce lived on one disk and nowhere else: the printable
sheet and its key, the professor's scanned batches, the page images and the
handwritten-name crops AMC extracts, the corrected PDFs students are mailed,
and AMC's own project databases. Nothing said that was deliberate. If the
disk failed, the grades survived and the papers did not: a control could be
neither re-read nor re-annotated, the review page had no scans, and
recompiling a sheet is no recovery, because nothing guarantees it matches the
paper students wrote on.

Measured on 2026-10-24, read-only, inside the worker container: 13 controls
in the database (12 active, 1 archived) and one survey run; 16 control
directories on disk, three of them leftovers of purged controls holding only
`data/report.sqlite`; ≈ 525 MB of project files. The issue's first text had
said "33 controls".

Miguel's goal was not a backup of the disk but to **stop depending on it**.

## Decision

### 1. What Miguel decided

- **S3 is the primary store** of every file under a project the database
  knows (`controls/<id>`, `surveys/<id>/runs/<id>`), except a short
  denylist. The volume is AMC's working copy, because AMC works on local
  files — and it is **never evicted** in this decision.
- **Everything the professor views or downloads is read from S3, through the
  server**, behind the professor session. The bucket stays private: no
  presigned URL, no browser-to-S3 path (the DocumentBuddy shape).
- **The latest version only.** Versioning stays off.
- **S3 deletes only what the system deletes** — the purge, "Borrar escaneos",
  and whatever a worker operation itself removes. Nothing expires by date,
  and nothing is ever deleted because it is MISSING locally.
- **A one-off migration that deletes nothing on the Jetson**, so the rollback
  is one variable (`NALANDA_FILES_STORE=local`).
- **The database stays out**: it keeps its daily `backups/` copy, and the
  known limit is that after a disk loss it can be a day behind the files.
- **aws-sdk-go-v2 is approved** for `apps/server/go.mod`, a **second IAM user**
  holds the server's key, **the purge deletes S3 first**, and **the tests use
  an in-memory bucket plus `S3-CHECK.md`** — no MinIO.

### 2. Keys, and why every object is one PutObject

The bucket is the backups' one, prefix **`work/`**, mirroring `/work`
exactly: `work/controls/<id>/uploads/batch-1.pdf`. A project's symlinks — the
ADR-0037 contract names `scans/copy-N-page-M.jpg`, which AMC's page images
are linked to — live in one object, `<project>/.nalanda/links.json`; the
`.nalanda/` name is reserved and refused as a work file.

Every object is written with a **single PutObject**, never the SDK's
multipart manager (which splits above 5 MB), with `Content-MD5`. Under SSE-S3
a single-part object's ETag is the MD5 of its bytes, and that is what lets
one listing per project answer "is S3 current?" without downloading
anything. A multipart ETag (`…-N`) is not an MD5; this server never writes
one, and one it finds is refused rather than trusted.

### 3. One port, two adapters

`internal/domain/files.Store` (`Open`, `List`, `DeleteProject`) is the port
every work-file read goes through, neutral like `uploads` — both subsystems
use it and it imports neither (`TestTheFilesDomainImportsNeitherSubsystem`).
`filestore.Local` is the volume as before; `filestore.S3` is the bucket.
`Open` on S3 is one HeadObject and a GET issued on the first Read, from the
position the reader sought to, If-Match the ETag the HEAD saw — so
`http.ServeContent`'s Range and If-Modified-Since cost what they cost on
disk, and an object replaced in between fails the read instead of serving a
body of another length. A HEAD that fails for any reason but NotFound is
confirmed with a listing of that very key: S3 answers a missing key with 404
only to a caller allowed to list, and whether this policy's prefix-scoped
`ListBucket` satisfies a HEAD's implicit check is not documented. A store
that fails (rather than a file that is missing) is a 503 in Spanish, never a
"no está disponible" that would send the professor looking for a file that is
there. A page image that may be a PNG or a JPG is opened with
`files.OpenFirst`, which falls through on a MISSING file only and lets the S3
store resolve both names against one read of the link map (#338 review,
PER-2: four requests per image became three).

### 4. The sync wraps every worker call, inside the worker lock

`amcworker.Client` serialises every call behind one lock. Since #338 each
call runs `filestore.Sync.Around` **inside** that lock, so no worker call
mutates a project while it is being copied — and the server's own writes into
a live project appear whole: a batch is written under `files.TempPrefix`
(`.nalanda-tmp-`, which the sync never uploads) and linked into place by
`files.WriteNew` (#338 review, COR-8). There is one way in, the client's
`serialised` helper (`serialisedAnnotate` for an annotate, `trySerialised`
for the resets), so a call cannot take
the lock without the sync or the sync without the lock;
`TestEveryWorkerCallsSyncRunsInsideTheWorkerLock` holds all eight calls to
it (#338 review, ARQ-1/COR-3: the rule had been repeated at six call sites,
and dropping the lock at two of them left the suite green). The lock is a
one-slot channel, not a mutex: a call waiting for it gives up when its
context ends (COR-2), where a review save behind another control's analyse
used to wait out the whole hold and then skip the annotate it waited for:

1. **hydrate** — one listing; each file goes the way of the NEWER copy:
   downloaded (temp file → MD5 check → the object's time → rename) when
   missing or older on disk, uploaded when the disk's is newer; a file the
   bucket lacks (an upload, a `source.tex`) is uploaded. Any failure stops
   here, before the worker.
2. the worker call;
3. **push** — every file whose MD5 moved, the corrected PDFs first; the link
   map rewritten when it moved, deleted when the call removed every link;
4. **prune** — exactly the files that were local before the call and are not
   after. A key that was never local during the call is never pruned, so an
   incomplete picture can never become a deletion.

The push runs after a FAILED call too (#210's batch-survives rule). A sync
failure is `files.ErrSync`, which the jobs name in Spanish ("no se pudo
sincronizar con S3; los archivos siguen en la Jetson"), the resets as "las
lecturas no se borraron" and the purge as "el control sigue archivado";
the local files are never touched by it, and the next call or the reconcile
finishes the copy. A push that fails after a call that SUCCEEDED also wraps
`files.ErrNotStored` (#338 review, COR-1): the work is done and on the
volume, so an analyse returns its report with that error and the domain
saves the reading — AMC has captured the batch either way, and dropping the
report left the readings behind a capture that had moved on — and a
generation is a done job. Both say, in a notice, that the files are on the
Jetson and go up with the next call or the nightly reconcile. An annotate's
path is NOT kept: a row would point the review page and the publication at
a PDF S3 may lack, where no row falls back to the raw scan. The review
save's annotate has its own 20 s deadline, which covers its wait for the
lock: past it the save stands, the professor is told the corrected PDF did
not follow — a copy sent before its next annotate would carry the old one —
and the reconcile catches up. Each file's MD5 is cached by path, size and
nanosecond mtime, because an analyse annotates each clean copy as a call of
its own.

**An annotate leaves AMC's databases for the next other call**
(`Sync.AroundDeferringDatabases`; #338 review, PER-1, Miguel's choice among
three).
AMC rewrites `data/capture.sqlite` and `data/scoring.sqlite` on every
`/annotate/copy` as a by-product — measured on the real worker, two
identical annotates of one copy changed both and left the corrected PDF
byte-identical — so an analyse's forty annotates uploaded a 5.7 MB
`capture.sqlite` forty times, ~228 MB to keep the last one, where the
whole loop needs ~18 MB. Those `data/*.sqlite` are left out of an
annotate's hydrate uploads and its push; the next call of another kind
uploads them in its hydrate (the disk's copy is the newer one), and so does
the reconcile. Until then the bucket's databases are the ones the last
analyse, re-read or reset left, which is what a restore needs: what an
annotate adds is derived from them and from the database — it re-applies the
overrides the server holds and recomputes the scores — and the next annotate
re-derives it. The alternatives were a per-copy sync that pushes only
`annotated/` with one full sync at the end of the loop (more code in the
loop's callers), and one call that annotates N copies (holding the lock for
the whole loop, which makes COR-2 worse). **"Borrar escaneos" defers them
too** (the recheck of PER-1): it deletes the capture's databases, and its
hydrate would otherwise upload what the annotates deferred only for its own
prune to delete it — seconds of the synchronous reset's 25 s, and on a slow
uplink all of them. The prune still deletes the bucket's copies of what the
reset removed.

**A call on a project that exists nowhere is refused** before anything is
created: no file on the volume, none in the bucket. No real call starts from
nothing — the server writes a project's inputs before its first call — so it
can only be one that queued behind its project's purge, and running it
would re-create the directory and upload what the failed call leaves there,
with no row left to find it (#338 review, SEC-1).

Every Around logs one line, `files: synced`, with what each half moved and
how long each part took — hydrate, call, push, the bytes, the files pruned
and the ones deferred, with their bytes (PER-5).

### 5. New batches number past the store's

With an empty volume, numbering from the disk would hand out `batch-1.pdf`
again and the next push would overwrite the real one — the one destructive
bug this design can have by construction. Both subsystems number past every
batch on disk OR in the store; a store that cannot list refuses the upload.

### 6. The purge deletes S3 first (amends ADR-0052)

Gates (unchanged) → `Files.DeleteProject` → the rows → the local directory,
best-effort. S3 is the step that fails for network reasons: failing there
leaves the archived control whole for a retry; the reverse order would leave
a purged student's scans in S3 with no row to retry from. The local store's
`DeleteProject` deletes nothing, so local mode purges exactly as before.

The three steps — the store, the rows, the directory — run **under the worker lock**, which the purge only
TRIES (`Analyzer.TryExclusive`): a worker busy on any job refuses it with a
409 before anything is deleted (#338 review, SEC-1). Ordering alone was not
enough: a push running beside the purge — an annotate loop releases the lock
between copies, the reconcile walks every project — uploaded again what the
S3 step had just deleted, and with the row gone nothing would ever find
those objects. The lock is taken in `local` mode too, deliberately: there it
keeps a worker call from writing into the directory the purge's RemoveAll is
deleting, and one rule is simpler to hold than two. A call already queued
for the control when the purge took the lock finds the project nowhere
afterwards and is refused (§4) — unless the
best-effort RemoveAll failed, in which case it re-uploads what was left: a
double fault (a failed chown, a failed RemoveAll, a call queued on that very
control), recorded and not closed. The lesson
is in `apps/server/CLAUDE.md`'s purge rule: a destructive step on a store a
sync repopulates runs under that sync's lock.

### 7. The reconcile, and the migration

`filestore.Reconciler` does the hydrate's upload half for every project the
database knows (archived controls and every run included), one at a time
under the lock and with the hydrate's one tie rule (at the same instant the
disk's copy wins; #338 review, ARQ-3): it **never downloads and never
deletes**, because at boot the volume may be the drill's empty one or a
rollback's stale one. It re-reads the project list under each project's
lock and skips one no longer on it, so a purge that landed after the walk
began — it takes the same lock — cannot have what a failed RemoveAll left
uploaded again (COR-10). It runs at boot and daily at 03:00 UTC (the
database backup's hour), and it is also what carries the databases the
annotates deferred. The migration is
the same code run once as `server -sync-files`, against the bucket whatever
the store says, before the flip (DEPLOY-JETSON.md).

### 8. Configuration and credentials

`NALANDA_FILES_STORE` (`local` default | `s3`) and, for s3,
`NALANDA_FILES_S3_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`,
`_SECRET_ACCESS_KEY`. The credentials are config variables of their own,
not the SDK's `AWS_*` lookup the issue first named: nothing below
`internal/infra/config` reads the environment, and the client is built from
`s3.Options` with that static key, so no shared file or instance metadata can
stand in for it, and there is no endpoint override. The key is the server's
OWN IAM user, `nalanda-jetson-server`: Get/Put/Delete and List on `work/*`,
nothing on `backups/`, TLS only. The backup's user keeps its no-delete policy,
so a compromised server cannot erase the database backups.

### 9. S3 is an input, not only a destination

Its keys become paths the worker (root) reads and its link map becomes
symlinks the review page serves, so: every key's remainder must be a clean
path of its project, or the hydrate fails (rather than skipping it quietly);
every local write of the sync goes through an `os.Root` on the project, so a
directory replaced by a symlink cannot carry a download out; a link is
created only as an ADR-0037 name pointing at a bare file name of the same
`scans/`; the map is strict JSON, at most 1 MiB. `docs/security-notes.md`
§"The work files live in S3" has the data-protection side.

### 10. AMC's catalog lands inside the project

Every generate wrote AMC's question catalog BESIDE the project
(`controls/<id>catalog.pdf`, 18 files on the Jetson, four of purged
controls): `prepare --mode s` names it `<prefix>catalog.pdf` without
`--out-catalog`, and the worker passed none. It is now `out/catalog.pdf`,
and the eighteen are moved once, before the migration. Its build is not
dropped: it also fills `layout_char`.

## Alternatives considered

- **A mirror** (the disk primary, S3 a copy after each change) — rejected by
  Miguel: the disk stays the source of truth, which is the dependency he
  wanted gone.
- **An rclone / `aws s3 sync` sidecar** — a mirror by another name; it cannot
  run inside the worker lock, uploads symlinks twice, and `--delete` turns a
  missing local file into a deletion.
- **FUSE (s3fs, mountpoint-s3)** — AMC rewrites SQLite files in place;
  mountpoint-s3 refuses random writes and s3fs makes them unsafe.
- **Presigned URLs** — a link that works without a login for its lifetime, on
  students' scans.
- **Hand-written SigV4 over `net/http`** (no dependency) — more code to own
  than the dependency it avoids.
- **Versioning** — Miguel wants the latest version only.
- **MinIO in the suite** — a second S3 implementation that is not S3; the
  fake states exactly what the store relies on, and S3-CHECK runs against
  the real one.

## Consequences

- **A worker operation's work is done when the worker returns, and S3 holds
  it after the push** (#338 review, COR-1: this bullet first said "a worker
  operation is finished only when S3 holds its result", which §4's
  ErrNotStored made false). When that push fails after a success, the job is
  done with a notice and its files exist only on the Jetson until the next
  call on that project or the 03:00 UTC reconcile: a disk loss in that window
  loses them, and under `s3` their downloads fail meanwhile. The operation's
  duration grows by the push over the Jetson's uplink — a review save pushes
  the corrected PDF (~0.1 MB; AMC's databases wait for the next other call,
  §4), an analyse its batch's images and `capture.sqlite` (median 5.7 MB, max
  9.6 MB) once. Measured below after the merge.
- **Between an annotate and the next call of another kind, the bucket's
  `data/*.sqlite` are the previous call's** (§4). A restore in that window
  re-derives what the annotates added on the next annotate of each copy.
- **The merge is inert for the files**: the default is `local`, and nothing
  reads or writes S3 until the flip, which is Miguel's, after the migration.
  Two behaviours change at the merge whatever the store (#338 review): the
  purge refuses with a 409 while the worker is busy on any job (§6), and the
  review save's annotate runs under its 20 s deadline and says so in the
  flash when it did not complete (§4).
- **The sync knows names from AMC's layout, not its schema** — the
  `data/*.sqlite` deferral, the denylist, the contract-link shape (§9) — so
  ADR-0031's confinement of AMC's SQLite schema to the worker still holds.
  But §4's premise that an annotate's database writes are derived was
  measured on AMC 1.6.0 (2026-10-25): an AMC upgrade or an engine swap
  re-measures it (two identical annotates of one copy change only
  `data/*.sqlite` and leave the PDF byte-identical) and re-checks the link
  shape.
- **"Newer" compares two clocks** — the Jetson's mtime against S3's
  LastModified (`filestore.bucketNewer`). The SDK corrects clock skew by
  default, so S3 does not refuse a Jetson whose clock drifted: the hydrate
  would silently prefer the wrong copy. Correctness rests on the Jetson's
  NTP (DEPLOY-JETSON checks it before the flip); comparing against the last
  ETag this volume synced instead is the deferred fix (#338 review, COR-9).
- **`/health` and the monitor do not see S3.** Under `s3` the signals are a
  download's 503 ("No se pudo leer el archivo del almacenamiento"), a job's
  banner or notice, a review save's flash, and the reconcile's `failed=`
  count in the log; DEPLOY-JETSON §"Day-to-day operations" names the lines.
  Reporting a failed reconcile through the backup's notify path is a
  follow-up.
- **A leaked server key can delete the primary copy** (versioning is off by
  decision). Accepted because the Jetson keeps its full copy — no eviction —
  so each side can rebuild the other. Evicting the local copy therefore needs
  a decision of its own, and this is its reason.
- **The database is still a day behind at worst** after a disk loss; the
  files are not. Continuous replication is a follow-up if the gap ever
  matters.
- **A change to the file store or the sync is unfinished until
  `apps/server/S3-CHECK.md` runs**, the same rule as GOOGLE/GMAIL/CANVAS-CHECK.
- **Cost**: ≈ 0.53 GB at S3 Standard, cents per month; ≈ 1–1.5 GB per
  semester at the Aug–Oct 2026 rate.

## Measurements

> **To fill in (owner: Miguel, deadline: one week after the flip, tracked in
> #338 — which the PR references without closing, so it stays open until
> these are in):**
> - ~~S3-CHECK §1: what HEAD of a missing key answered with the server's key
>   (404 or 403).~~ **404** (2026-10-25, the laptop against
>   `nalanda-jetson-backups`, at `62731c2`): the prefix-scoped `ListBucket`
>   satisfies a HEAD's implicit check, so `S3.absent`'s listing never runs
>   on this bucket — it stays, for a policy that would answer 403.
> - ~~S3-CHECK §2: the ETag equalled the MD5 for the small and the 12 MB
>   object.~~ **Yes, both** (same run): SSE-S3 single-part ETags are the MD5.
> - ~~The migration: `-sync-files`' line (projects, files, bytes), and the
>   bucket's object count beside a fresh census minus the denylist
>   (AC-15).~~ **2026-10-25, the Jetson at `58f1f89`**: 14 projects (13
>   controls, one survey run); pass 1 `598 files (208,122,473 bytes)`,
>   stopped by hand after 10 min 13 s on a stalled connection (DEPLOY-JETSON
>   §"Moving the files to S3", step 6); pass 2 `952 files (318,746,689
>   bytes), 0 failed, took 25m54s`; pass 3 `0 files uploaded`, exit 0 — 1550
>   files, 527 MB. The census by `skipped`'s rules: 1561 keys (1550 files +
>   11 link maps); the bucket: 1561 objects, none missing, none extra,
>   **1550/1550 ETags equal to the local MD5**, and the 11 `links.json`
>   equal to the volume's `scans/` symlinks. AMC's 18 stray catalogs before
>   it: 14 moved into `out/`, 4 of purged controls deleted (AC-20).
> - ~~The uplink: one timed ~10 MB PutObject from the Jetson (#338 review,
>   PER-5).~~ **10 MB in 9 s** (same day, the backup sidecar's aws CLI with
>   the server's key). Not a constant: the speed is the connection's —
>   1 MB on three fresh connections took 5 s, 59 s and 5 s, and the
>   migration's first connection crawled at ~18 KB/s under ~15 %
>   retransmission at a 137 ms RTT, while the same box uploads 1 MB to
>   Cloudflare in 0.15 s. A GET of an 8.3 MB batch took 6 s, a 287 KB page
>   image 3 s, a 155 KB corrected PDF 4 s — the CLI's start-up is most of
>   the small ones. So a push after a call can take minutes when its
>   connection is a bad one, inside the worker lock; what does not get up
>   stays on the volume for the next call's hydrate (its upload half) or the
>   03:00 reconcile.
> - One analyse JOB with N copies, end to end, under `local` and under `s3`,
>   with the sum of its `files: synced` lines (`hydrate=`, `call=`, `push=`,
>   `bytes=`, `deferred=`), and one review save end to end, its wait for the
>   lock included (AC-15). These decide the deferred items PER-4 (bounded
>   ranged reads) and PER-6 (a small upload pool).
> - The drill (AC-16) and the rollback rehearsal (AC-18): pass / fail, date.
>   **Rollback rehearsal: PASS, 2026-10-25** — `s3` → `local` (boot
>   `store=local`, health 200, no S3 call) → `s3` (boot reconcile
>   `projects=14 files=0 bytes=0 failed=0`), the bucket's 1561 objects
>   unchanged. Nothing was written in between, so the reconcile's upload of
>   what a rollback wrote was not exercised here —
>   `TestTheReconcileUploadsWhatTheBucketLacksOrHoldsOlder` pins it.
>   **The drill's boot on the empty volume** (same day): `files: reconciled
>   projects=14 files=0 bytes=0 failed=0 took=28ms`, and the bucket's 1561
>   keys and ETags identical before and after — an empty volume uploads
>   nothing and deletes nothing.
