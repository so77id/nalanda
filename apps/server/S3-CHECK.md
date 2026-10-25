# S3-CHECK — the file store against the real bucket

**Run this whenever the file store or the sync changes** — this paragraph
is the one list; every other document that names this procedure points
here: the adapters in `internal/infra/filestore/` (`s3.go`, `s3client.go`,
`sync.go`, `reconcile.go`); the port's helpers in `internal/domain/files/`
(`OpenFirst`, `WriteNew`); the sync around the worker calls in
`internal/infra/amcworker/`; the store's routes — every handler that opens a
work file through a service method or answers through
`handler.fileUnavailable`; the numbering past the store's batches in
`internal/domain/controls/scans.go` and `internal/domain/survey/scans.go`;
the purge's S3 step in `internal/domain/controls/service.go`; the store's
wiring in `cmd/server/main.go` (`buildFileStore`, the boot and 03:00 UTC
reconcile, `-sync-files`); `NALANDA_FILES_*`; or the server's IAM policy
`infra/deploy/jetson/nalanda-jetson-server-policy.json` (issue #338).

It is an L8 manual procedure, in the same family and for the same reason as
[`GOOGLE-CHECK.md`](GOOGLE-CHECK.md), [`GMAIL-CHECK.md`](GMAIL-CHECK.md) and
[`CANVAS-CHECK.md`](CANVAS-CHECK.md): **nothing in the suite reaches AWS.**
The tests drive `filestore/s3test`, an in-memory bucket that keeps exactly
what the store relies on — single-part MD5 ETags, ranged and If-Match GETs,
paged listings, DeleteObjects — and so says nothing about whether the real
bucket does: whether the SDK signs, whether the ETag under the bucket's
SSE-S3 encryption IS the MD5 the hydrate compares (it is the whole basis of
"is S3 current?"), whether HeadObject on a missing key answers 404 or 403
to this user (the policy grants `s3:ListBucket` only under a `work/*` prefix
condition, and whether that satisfies a HEAD's implicit check is not
documented — §1 measures it), whether the policy refuses what it must.

**Last run: PARTIAL, 2026-10-25, at `62731c2` (#338's AC-14, the laptop's
compose stack against the real bucket `nalanda-jetson-backups`, us-east-1).**
§0–§4 passed; §5 not run, by Miguel's decision (the Spanish messages it
checks are pinned by the handler tests); §6 is the Jetson's (AC-17).
AC-15…18 are the Jetson half, after the merge. Record each run's date, commit
and result here.

- **§0**: the server's user was created BY HAND in the IAM console, not with
  the script — the inline policy `nalanda-jetson-s3-work` pasted from the
  template with the bucket's name, one access key ("application running
  outside AWS"). The bucket read back in the console: versioning off,
  SSE-S3, public access blocked four ways, one lifecycle rule scoped to
  `backups/`.
- **§1**: every refusal answered AccessDenied (`backups/` list, put, delete;
  a put outside `work/`; plain HTTP, as an explicit deny). **A HEAD of a
  missing key answered 404**: the prefix-scoped `ListBucket` is enough, so
  `absent`'s listing never runs on this bucket.
- **§2**: the ETag equalled the MD5 for a 6-byte and a 12 MB single-part PUT.
- **§3**: `-sync-files` on an empty database: `0 projects, 0 files uploaded
  (0 bytes), 0 failed`, twice.
- **§4**, a throwaway control: generated (13 objects, the catalog inside
  `out/`); Range through the server `206 100`, If-Modified-Since `304`; a
  batch read (through the chunked upload) with `scans/`, `cr/`, the capture
  and `.nalanda/links.json` in S3 and no `scans/list*.txt`, page images on
  the review page; a review save that pushed only the corrected PDF
  (`deferred=3`) and left `capture.sqlite`'s ETag unchanged until the re-read
  uploaded it (`uploaded_first=3`); "Borrar escaneos" with
  `uploaded_first=0 pruned=20`, keeping `inputs/`, `pool.json`, `out/`,
  `layout.sqlite`, `report.sqlite`; archive + purge leaving no key under
  `work/`.
- **Two setup facts for the next laptop run**: the stack's
  `questions.example.json` is an EMPTY bank — point
  `NALANDA_QUESTIONS_JSON_URL` at the published one; and a control needs a
  course, which comes only from Canvas — with no master key the run inserted
  a throwaway `course` row into the throwaway database. Run the stack under
  its own project name (`docker compose -p s3check …`, `down -v` after), so
  `-sync-files` sees no development project.
- **Durations** (the laptop's link, not the Jetson's): a generate's push 2.3 s
  for 11 files; a review save 3.6 s end to end (hydrate 0.7 s, call 2.4 s,
  push 0.5 s); the analyse's push 2 min 57 s for 23 files and 3.3 MB — the
  laptop's network was slow for those minutes: the same PUT path, probed
  right then, took 7–28 s per 300 KB, and 0.3–1.3 s ten minutes later. Cause
  unknown; not the code.

## 0. Prerequisites

1. Miguel ran `infra/deploy/jetson/provision-jetson-iam.sh` with the admin
   identity (no agent holds account credentials). It printed the four
   `NALANDA_FILES_S3_*` values of the server's own user,
   `nalanda-jetson-server`, and its read-back says *versioning: off* and
   *lifecycle: every rule scoped to backups/*.
2. A shell with the AWS CLI where **the server's key** is the identity:

   ```bash
   export AWS_ACCESS_KEY_ID=<NALANDA_FILES_S3_ACCESS_KEY_ID>
   export AWS_SECRET_ACCESS_KEY=<NALANDA_FILES_S3_SECRET_ACCESS_KEY>
   export AWS_REGION=<NALANDA_FILES_S3_REGION>
   B=<NALANDA_FILES_S3_BUCKET>
   aws sts get-caller-identity --query Arn --output text   # …:user/nalanda-jetson-server
   ```

3. The laptop stack (AC-14) or the Jetson (AC-15) with the four variables in
   `infra/local/.env`. Never commit that file.

## 1. The policy refuses what it must

Each line is a command and the answer it must give.

```bash
echo probe > /tmp/probe
aws s3api put-object --bucket $B --key work/_s3check/probe --body /tmp/probe      # an ETag
aws s3api head-object --bucket $B --key work/_s3check/missing                     # 404 — or 403, see below
aws s3 ls s3://$B/work/                                                           # lists
aws s3 ls s3://$B/backups/                                                        # AccessDenied
aws s3api put-object --bucket $B --key backups/_s3check --body /tmp/probe         # AccessDenied
aws s3api delete-object --bucket $B --key backups/nalanda-<any>.db                # AccessDenied
aws s3api put-object --bucket $B --key _s3check --body /tmp/probe                 # AccessDenied (outside work/)
aws --endpoint-url http://s3.$AWS_REGION.amazonaws.com s3 ls s3://$B/work/        # AccessDenied (aws:SecureTransport)
aws s3api delete-object --bucket $B --key work/_s3check/probe                     # deleted
```

The HEAD line is a measurement, not a pass/fail: S3 answers a missing key
with 404 only to a caller allowed to list the bucket, and the server's
`s3:ListBucket` carries a `work/*` prefix condition whose effect on a HEAD's
implicit check AWS does not document. Write down which one this bucket
answered. Either is handled — the store confirms any HEAD failure that is
not a 404 with a listing of that very key (`filestore.S3.absent`), so a
missing file reads as missing (a page's 404) — but a 403 costs one extra
listing per missing file opened by name (a sheet, a batch, a corrected PDF).
Page images are resolved through `links.json` and never HEAD a missing PNG.
If this bucket answers 403, note one more thing: a project with no
`links.json` then reads as a store failure (503) on the review page, not as
a page with no image.

## 2. The ETag is the MD5

The hydrate decides "is S3 current?" by comparing a local MD5 with the
object's ETag, which is the MD5 only for a single-part PUT under SSE-S3 or
none. Confirm it on this bucket, for a small and a large file:

```bash
head -c 12000000 /dev/urandom > /tmp/big
for f in /tmp/probe /tmp/big; do
  aws s3api put-object --bucket $B --key work/_s3check/$(basename $f) --body $f \
    --query ETag --output text
  md5sum $f        # (macOS: md5 -q $f)
done
aws s3 rm --recursive s3://$B/work/_s3check/
```

Each ETag (without its quotes) must equal the file's MD5. A `-N` suffix
means a multipart upload, which `aws s3 cp` does above 8 MB and the server
never does — `s3api put-object` is the right tool here. If the bucket's
default encryption is ever switched to SSE-KMS, the ETag stops being the MD5:
every hydrate would then re-download, and the downloads would be refused.
Stop and reopen #338's ADR.

## 3. The migration's command

With `NALANDA_FILES_STORE=local` and the four variables set:

```bash
docker compose run --rm server -sync-files ; echo "exit $?"
```

One line — `sync-files: N projects, M files uploaded (B bytes), 0 failed,
took T` — and `exit 0`. Run it twice: the second run uploads 0 files.
`aws s3 ls --recursive s3://$B/work/ | wc -l` is the object count; on the
Jetson it must match a fresh census of the projects the database knows,
minus the denylist (AC-15).

## 4. The whole loop under s3

Set `NALANDA_FILES_STORE=s3`, restart the server, and look for the boot
lines: `file store store=s3 …` and `files: reconciled projects=… failed=0`.
Then, with a throwaway control (name it `S3-CHECK <date>`):

1. **Create and generate.** `aws s3 ls --recursive s3://$B/work/controls/<id>/`
   lists `inputs/source.tex`, `pool.json`, `out/sujet.pdf`, `out/corrige.pdf`,
   `data/layout.sqlite`. Open the sheet and the key from the page.
2. **Range.** The sheet answers a ranged request with 206 and exactly those
   bytes:
   `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -r 0-99 -b <session cookie> <url>/controls/<id>/sujet.pdf`
   → `206 100`.
3. **Upload and read a batch.** `uploads/batch-1.pdf`, `scans/*`, `cr/*`,
   `data/capture.sqlite` and `.nalanda/links.json` appear; no
   `scans/list*.txt`. The review page shows every page image (each comes
   through `links.json`).
4. **Correct a copy.** Save a review: `annotated/copy-N.pdf` appears and the
   page shows it. The save's `files: synced …` line has `deferred=` above 0
   and `data/capture.sqlite`'s ETag in S3 is the analyse's — an annotate
   leaves AMC's databases for the next other call (ADR-0089 §4); press
   *Re-leer con otra sensibilidad* and it changes. Write the save's
   `push=`, and the analyse job's lines summed, into the ADR (AC-15).
5. **Borrar escaneos.** `scans/`, `cr/`, `uploads/`, `annotated/`,
   `data/capture.sqlite`, `data/scoring.sqlite` (and `association.sqlite` if
   there was one) and `.nalanda/links.json` leave S3 — the worker's
   `RESET_FILES` / `RESET_DIRS`, carried by the prune; `inputs/`,
   `pool.json`, `out/`, `layout.sqlite` and `report.sqlite` stay. The
   reset's `files: synced` line has `uploaded_first=0`: it does not upload
   the databases the annotates deferred (ADR-0089 §4).
6. **Purge.** Archive and purge the control: `aws s3 ls
   s3://$B/work/controls/<id>/` is empty, and nothing else under `work/`
   changed.

## 5. A store that cannot be reached

Revoke the server's key for a minute (deactivate it in IAM), and on any
control: a download answers *No se pudo leer el archivo del
almacenamiento…*; a job banner says *no se pudo sincronizar con S3; los
archivos siguen en la Jetson*; a review save says *el PDF corregido no se
alcanzó a actualizar*; a purge says the control *sigue archivado* and leaves
it so. Reactivate the key; the next call, or the next boot's reconcile,
finishes the copy.

## 6. The mail attachment

GMAIL-CHECK's test send, under `s3`: the message arrives with its corrected
PDF readable — the attachment is read through the store now (AC-17).

## Notes — what may be written down

Object counts, byte totals, durations, exit codes, HTTP statuses. Never a
key, never a student's file name or RUT, never the content of a scan.
