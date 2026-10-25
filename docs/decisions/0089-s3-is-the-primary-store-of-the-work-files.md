# ADR-0089: S3 is the primary store of the work files

**Status:** Accepted — measurements outstanding: S3-CHECK on the laptop
before the merge (#338 AC-14), the migration, the drill and the rollback on
the Jetson after it (AC-15…18); owner Miguel, the results written into
§Measurements below
**Date:** 2026-10-25
**Decision-makers:** Miguel Rodriguez
**Amends:** ADR-0038 (what leaves the box), ADR-0052 (the purge's order),
ADR-0034 (`/work` becomes a working copy)
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
there.

### 4. The sync wraps every worker call, inside the worker lock

`amcworker.Client` serialises every call behind one mutex. Since #338 each
call runs `filestore.Sync.Around` **inside** that lock, so nothing mutates a
project while it is being copied:

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
failure is `files.ErrSync`, which the jobs, the resets and the purge name in
Spanish ("no se pudo sincronizar con S3; los archivos siguen en la Jetson");
the local files are never touched by it, and the next call or the reconcile
finishes the copy. The review save's annotate, which now carries a push, has
its own 20 s deadline: past it the save stands and the reconcile catches up.
Each file's MD5 is cached by path, size and nanosecond mtime, because an
analyse annotates each clean copy as a call of its own.

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

### 7. The reconcile, and the migration

`filestore.Reconciler` does the hydrate's upload half for every project the
database knows (archived controls and every run included), one at a time
under the lock: it **never downloads and never deletes**, because at boot the
volume may be the drill's empty one or a rollback's stale one. It runs at
boot and daily at 03:00 UTC (the database backup's hour). The migration is
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

- **A worker operation is finished only when S3 holds its result**, and its
  duration grows by the push over the Jetson's uplink — a review save pushes
  the corrected PDF and `capture.sqlite` (median 5.7 MB, max 9.6 MB). Measured
  below after the merge.
- **The merge is inert for the files**: the default is `local`. Flipping is
  Miguel's, after the migration.
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

> **To fill in (owner: Miguel; tracked in #338):**
> - S3-CHECK §1: what HEAD of a missing key answered with the server's key
>   (404 or 403).
> - S3-CHECK §2: the ETag equalled the MD5 for the small and the 12 MB object.
> - The migration: `-sync-files`' line (projects, files, bytes), and the
>   bucket's object count beside a fresh census minus the denylist (AC-15).
> - One analyse's and one review save's `files: pushed … took …` (AC-15).
> - The drill (AC-16) and the rollback rehearsal (AC-18): pass / fail, date.
