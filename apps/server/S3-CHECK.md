# S3-CHECK — the file store against the real bucket

**Run this whenever the file store or the sync changes**: the adapters in
`internal/infra/filestore/` (`s3.go`, `s3client.go`, `sync.go`,
`reconcile.go`), the sync around the worker calls in
`internal/infra/amcworker/`, the store's routes (every download and page
image that goes through `files.Store`), the purge's S3 step in
`internal/domain/controls/service.go`, `NALANDA_FILES_*`, or the server's IAM
policy `infra/deploy/jetson/nalanda-jetson-server-policy.json` (issue #338).

It is an L8 manual procedure, in the same family and for the same reason as
[`GOOGLE-CHECK.md`](GOOGLE-CHECK.md), [`GMAIL-CHECK.md`](GMAIL-CHECK.md) and
[`CANVAS-CHECK.md`](CANVAS-CHECK.md): **nothing in the suite reaches AWS.**
The tests drive `filestore/s3test`, an in-memory bucket that keeps exactly
what the store relies on — single-part MD5 ETags, ranged and If-Match GETs,
paged listings, DeleteObjects — and so says nothing about whether the real
bucket does: whether the SDK signs, whether the ETag under the bucket's
SSE-S3 encryption IS the MD5 the hydrate compares (it is the whole basis of
"is S3 current?"), whether HeadObject on a missing key answers 404 rather
than 403 to this user (it does only because the policy grants
`s3:ListBucket`), whether the policy refuses what it must.

**Last run: never.** AC-14 of #338 is this procedure on the laptop's compose
stack, BEFORE the merge; AC-15…18 are the Jetson half, after it. Record each
run's date, commit and result here, in the same shape as GMAIL-CHECK's.

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
missing file reads as missing (a page's 404, and the review page's
PNG-then-JPG fall-through) — but a 403 costs one extra request per missing
file, and the review page asks for a missing PNG before every JPG.

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
   page shows it. The server log has `files: pushed … took …` — write the
   duration of this push, and of the analyse's, into the ADR (AC-15).
5. **Borrar escaneos.** `scans/`, `cr/`, `uploads/`, `annotated/`, the
   capture and `links.json` leave S3; `inputs/`, `out/`, `layout.sqlite` and
   `report.sqlite` stay.
6. **Purge.** Archive and purge the control: `aws s3 ls
   s3://$B/work/controls/<id>/` is empty, and nothing else under `work/`
   changed.

## 5. A store that cannot be reached

Revoke the server's key for a minute (deactivate it in IAM), and on any
control: a download answers *No se pudo leer el archivo del
almacenamiento…*; a job banner says *no se pudo sincronizar con S3; los
archivos siguen en la Jetson*; a purge says the control *sigue archivado*
and leaves it so. Reactivate the key; the next call, or the next boot's
reconcile, finishes the copy.

## 6. The mail attachment

GMAIL-CHECK's test send, under `s3`: the message arrives with its corrected
PDF readable — the attachment is read through the store now (AC-17).

## Notes — what may be written down

Object counts, byte totals, durations, exit codes, HTTP statuses. Never a
key, never a student's file name or RUT, never the content of a scan.
