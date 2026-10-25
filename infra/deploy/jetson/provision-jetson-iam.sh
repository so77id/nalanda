#!/usr/bin/env bash
#
# Provision the Nalanda bucket + the two least-privilege IAM users the
# Jetson uses: `nalanda-jetson` for the database backups under backups/
# (#162, ADR-0038), and `nalanda-jetson-server` for the work files under
# work/, which S3 keeps as their primary copy (#338). Two users so the
# server's key — which can DELETE, the purge needs it — reaches nothing of
# the backups, and the backup's key, which cannot delete, reaches nothing of
# the work files.
#
# Idempotent: safe to re-run. Requires AWS admin credentials in the current
# shell (NOT the Jetson creds). Run from a laptop with the AWS CLI installed,
# never from the box. The Jetson never sees admin credentials.
#
# After running, copy the printed access key into infra/local/.env on the
# Jetson (where docker compose reads its env), restart the backup + monitor
# services, and verify with the two commands the script prints at the end.
#
# The bucket name and region are inputs — Miguel picks them, so nothing here
# hard-codes them. Set NALANDA_S3_BUCKET and AWS_REGION (or pass --region on
# a shell that already has them set from another purpose):
#
#     NALANDA_S3_BUCKET=nalanda-backups-<something> \
#     AWS_REGION=us-east-1 \
#       ./infra/deploy/jetson/provision-jetson-iam.sh

set -euo pipefail

USER_NAME="nalanda-jetson"
POLICY_NAME="nalanda-jetson-s3-backups"
SERVER_USER_NAME="nalanda-jetson-server"
SERVER_POLICY_NAME="nalanda-jetson-s3-work"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_TEMPLATE="${SCRIPT_DIR}/nalanda-jetson-user-policy.json"
SERVER_POLICY_TEMPLATE="${SCRIPT_DIR}/nalanda-jetson-server-policy.json"
LIFECYCLE_FILE="${SCRIPT_DIR}/nalanda-jetson-bucket-lifecycle.json"

if [[ -z "${NALANDA_S3_BUCKET:-}" ]]; then
  echo "error: set NALANDA_S3_BUCKET to the bucket name Miguel picked (e.g. nalanda-backups-udp-2026)" >&2
  exit 1
fi
if [[ -z "${AWS_REGION:-}" ]]; then
  echo "error: set AWS_REGION to the region the bucket should live in (e.g. us-east-1)" >&2
  exit 1
fi

for f in "${POLICY_TEMPLATE}" "${SERVER_POLICY_TEMPLATE}" "${LIFECYCLE_FILE}"; do
  if [[ ! -f "$f" ]]; then
    echo "error: expected file not found: $f" >&2
    exit 1
  fi
done

echo "==> Verifying AWS credentials (must be an admin, not the Jetson user)..."
CALLER="$(aws sts get-caller-identity --query Arn --output text)"
echo "    Authenticated as: ${CALLER}"
case "${CALLER}" in
  *nalanda-jetson*)
    echo "error: you are authenticated AS the jetson user; run with an admin identity." >&2
    exit 1
    ;;
esac

echo "==> Ensuring bucket '${NALANDA_S3_BUCKET}' exists in region '${AWS_REGION}'..."
if aws s3api head-bucket --bucket "${NALANDA_S3_BUCKET}" 2>/dev/null; then
  echo "    Bucket already exists."
else
  # us-east-1 is the region where LocationConstraint MUST be omitted; every
  # other region requires it. This is the shape aws s3api documents; it is
  # also the shape that reads awkwardly and is the reason a template exists
  # rather than one aws s3 mb line.
  if [[ "${AWS_REGION}" == "us-east-1" ]]; then
    aws s3api create-bucket \
      --bucket "${NALANDA_S3_BUCKET}" \
      --region "${AWS_REGION}" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "${NALANDA_S3_BUCKET}" \
      --region "${AWS_REGION}" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
  fi
  echo "    Created bucket."
fi

echo "==> Enforcing S3 defaults (block public access, encrypt at rest, versioning off)..."
# Public access blocked at every level: the bucket holds SQLite dumps whose
# rows are personal data under Ley 21.719 (professor identifiers today, and
# whatever WP-D adds next). A misconfigured Actions role or a re-used console
# defaulting to "make public" is exactly the failure this closes.
aws s3api put-public-access-block --bucket "${NALANDA_S3_BUCKET}" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null

# Encryption at rest with S3-managed keys — free, no key rotation for the
# operator to remember. The apps/server's own accepted invariant "personal
# data at rest without encryption" (§C15's review trigger cluster, and the
# WP body's ADR notes) already commits to reopening this when a second data
# class arrives; at rest under SSE-S3 is what we can adopt today at no cost.
aws s3api put-bucket-encryption --bucket "${NALANDA_S3_BUCKET}" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' >/dev/null

echo "==> Applying the 30-day lifecycle policy on backups/ ..."
aws s3api put-bucket-lifecycle-configuration \
  --bucket "${NALANDA_S3_BUCKET}" \
  --lifecycle-configuration "file://${LIFECYCLE_FILE}" >/dev/null
echo "    Objects under backups/ expire after 30 days; the script never deletes."

echo "==> Ensuring IAM user '${USER_NAME}' exists..."
if aws iam get-user --user-name "${USER_NAME}" >/dev/null 2>&1; then
  echo "    User already exists."
else
  aws iam create-user --user-name "${USER_NAME}" \
    --tags Key=Project,Value=nalanda Key=ManagedBy,Value=provision-jetson-iam.sh >/dev/null
  echo "    Created user."
fi

echo "==> Attaching inline policy '${POLICY_NAME}' (least privilege, PutObject + GetObject on backups/ only)..."
# Substitute ${NALANDA_S3_BUCKET} in the template. envsubst is not on every
# Nalanda operator's laptop; sed is.
RENDERED_POLICY="$(sed "s|\${NALANDA_S3_BUCKET}|${NALANDA_S3_BUCKET}|g" "${POLICY_TEMPLATE}")"
aws iam put-user-policy \
  --user-name "${USER_NAME}" \
  --policy-name "${POLICY_NAME}" \
  --policy-document "${RENDERED_POLICY}"
echo "    Policy attached (PutObject + GetObject + ListBucket on ${NALANDA_S3_BUCKET}/backups/)."

echo "==> Checking existing access keys..."
KEY_COUNT="$(aws iam list-access-keys --user-name "${USER_NAME}" \
  --query 'length(AccessKeyMetadata)' --output text)"
if [[ "${KEY_COUNT}" -ge 2 ]]; then
  echo "    User already has ${KEY_COUNT} access keys (max 2). Not creating a new one."
  echo "    Delete an unused key first if you need fresh credentials:"
  aws iam list-access-keys --user-name "${USER_NAME}" \
    --query 'AccessKeyMetadata[].{Id:AccessKeyId,Status:Status,Created:CreateDate}' --output table
else
  echo "==> Creating an access key..."
  read -r ACCESS_KEY_ID SECRET_ACCESS_KEY < <(aws iam create-access-key \
    --user-name "${USER_NAME}" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  echo ""
  echo "    +--------------------------------------------------------------------+"
  echo "    | SAVE THESE NOW — the secret is shown only once.                    |"
  echo "    +--------------------------------------------------------------------+"
  echo "    NALANDA_S3_BUCKET=${NALANDA_S3_BUCKET}"
  echo "    AWS_REGION=${AWS_REGION}"
  echo "    AWS_ACCESS_KEY_ID=${ACCESS_KEY_ID}"
  echo "    AWS_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY}"
fi

echo ""
echo "==> Ensuring IAM user '${SERVER_USER_NAME}' exists (the server's own, #338)..."
if aws iam get-user --user-name "${SERVER_USER_NAME}" >/dev/null 2>&1; then
  echo "    User already exists."
else
  aws iam create-user --user-name "${SERVER_USER_NAME}" \
    --tags Key=Project,Value=nalanda Key=ManagedBy,Value=provision-jetson-iam.sh >/dev/null
  echo "    Created user."
fi

echo "==> Attaching inline policy '${SERVER_POLICY_NAME}' (Get/Put/Delete + List on work/ only, TLS only)..."
RENDERED_SERVER_POLICY="$(sed "s|\${NALANDA_S3_BUCKET}|${NALANDA_S3_BUCKET}|g" "${SERVER_POLICY_TEMPLATE}")"
aws iam put-user-policy \
  --user-name "${SERVER_USER_NAME}" \
  --policy-name "${SERVER_POLICY_NAME}" \
  --policy-document "${RENDERED_SERVER_POLICY}"
echo "    Policy attached (GetObject + PutObject + DeleteObject + ListBucket on ${NALANDA_S3_BUCKET}/work/, nothing on backups/)."

echo "==> Checking the server user's access keys..."
SERVER_KEY_COUNT="$(aws iam list-access-keys --user-name "${SERVER_USER_NAME}" \
  --query 'length(AccessKeyMetadata)' --output text)"
if [[ "${SERVER_KEY_COUNT}" -ge 2 ]]; then
  echo "    User already has ${SERVER_KEY_COUNT} access keys (max 2). Not creating a new one."
  aws iam list-access-keys --user-name "${SERVER_USER_NAME}" \
    --query 'AccessKeyMetadata[].{Id:AccessKeyId,Status:Status,Created:CreateDate}' --output table
else
  echo "==> Creating an access key for the server..."
  read -r SERVER_KEY_ID SERVER_SECRET < <(aws iam create-access-key \
    --user-name "${SERVER_USER_NAME}" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  echo ""
  echo "    +--------------------------------------------------------------------+"
  echo "    | SAVE THESE NOW — the server's secret is shown only once.          |"
  echo "    +--------------------------------------------------------------------+"
  echo "    NALANDA_FILES_S3_BUCKET=${NALANDA_S3_BUCKET}"
  echo "    NALANDA_FILES_S3_REGION=${AWS_REGION}"
  echo "    NALANDA_FILES_S3_ACCESS_KEY_ID=${SERVER_KEY_ID}"
  echo "    NALANDA_FILES_S3_SECRET_ACCESS_KEY=${SERVER_SECRET}"
fi

echo ""
echo "==> Verifying the bucket carries every safety we set (post-condition, #162 review SEC-5)..."
# The script does not just apply the safeties, it READS THEM BACK. A future
# console-clicky operator (or an aborted rerun) that disables lifecycle,
# encryption, or public-access-block leaves the bucket collecting backups
# forever, or without SSE, or writable to the world — silent to any operator
# who trusts "==> Done." from a prior run. Verify at every recorded exit.
LIFECYCLE_STATUS="$(aws s3api get-bucket-lifecycle-configuration \
  --bucket "${NALANDA_S3_BUCKET}" \
  --query 'Rules[?ID==`expire-backups-after-30-days`].Status | [0]' \
  --output text 2>/dev/null || true)"
if [[ "${LIFECYCLE_STATUS}" != "Enabled" ]]; then
  echo "error: lifecycle rule 'expire-backups-after-30-days' is not Enabled on ${NALANDA_S3_BUCKET} (got: '${LIFECYCLE_STATUS}'). Backups will accumulate forever. Rerun." >&2
  exit 1
fi
echo "    lifecycle: Enabled (30 days on backups/)."

BPA_JSON="$(aws s3api get-public-access-block --bucket "${NALANDA_S3_BUCKET}" \
  --query 'PublicAccessBlockConfiguration' --output json 2>/dev/null || true)"
if ! echo "${BPA_JSON}" | grep -q '"BlockPublicAcls": true' \
  || ! echo "${BPA_JSON}" | grep -q '"IgnorePublicAcls": true' \
  || ! echo "${BPA_JSON}" | grep -q '"BlockPublicPolicy": true' \
  || ! echo "${BPA_JSON}" | grep -q '"RestrictPublicBuckets": true'; then
  echo "error: public-access-block is not fully enforced on ${NALANDA_S3_BUCKET}:" >&2
  echo "${BPA_JSON}" >&2
  exit 1
fi
echo "    public access: fully blocked (four flags true)."

ENC_ALG="$(aws s3api get-bucket-encryption --bucket "${NALANDA_S3_BUCKET}" \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
  --output text 2>/dev/null || true)"
if [[ "${ENC_ALG}" != "AES256" ]]; then
  echo "error: SSE default is '${ENC_ALG}', want AES256 on ${NALANDA_S3_BUCKET}. Rerun." >&2
  exit 1
fi
echo "    encryption: SSE-S3 (AES256) by default."

# #338: work/ holds the PRIMARY copy of every scan and corrected PDF, so two
# settings that are harmless for backups/ would quietly lose it. Versioning
# stays off (Miguel's decision: the latest version only) — and since it is
# off, a lifecycle rule reaching work/ would expire the only copy.
VERSIONING="$(aws s3api get-bucket-versioning --bucket "${NALANDA_S3_BUCKET}" \
  --query 'Status' --output text 2>/dev/null || true)"
if [[ "${VERSIONING}" == "Enabled" ]]; then
  echo "error: versioning is Enabled on ${NALANDA_S3_BUCKET}; #338 keeps the latest version only. Suspend it deliberately or update the ADR." >&2
  exit 1
fi
echo "    versioning: off (latest version only)."

UNSCOPED_RULES="$(aws s3api get-bucket-lifecycle-configuration --bucket "${NALANDA_S3_BUCKET}" \
  --query 'Rules[?!(Filter.Prefix) || !starts_with(Filter.Prefix, `backups/`)].ID' \
  --output text 2>/dev/null || true)"
if [[ -n "${UNSCOPED_RULES}" && "${UNSCOPED_RULES}" != "None" ]]; then
  echo "error: lifecycle rule(s) not scoped to backups/ on ${NALANDA_S3_BUCKET}: ${UNSCOPED_RULES}. One reaching work/ would expire the primary copy of the scans." >&2
  exit 1
fi
echo "    lifecycle: every rule scoped to backups/ (work/ never expires)."

cat <<'STEPS'

==> Next steps (on the Jetson):
  1. Edit infra/local/.env on the Jetson (docker compose reads it from the CWD
     where you invoke it — the same directory as docker-compose.yml). Put the
     four variables above (NALANDA_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID,
     AWS_SECRET_ACCESS_KEY) into it, plus the two Telegram variables from
     @BotFather (INFRA_TELEGRAM_TOKEN, ALLOWED_CHAT_IDS).
  2. Restart the backup + monitor services:
       cd infra/local
       docker compose up -d --build backup monitor
  3. Verify the credentials work — this uploads a zero-byte probe and deletes
     the local copy after the S3 side reports OK. It should print no error:
       aws s3 cp /dev/null "s3://${NALANDA_S3_BUCKET}/backups/_probe-$(hostname)-$(date +%s).ok"
  4. Watch the first cron trigger land: it runs at 03:00 UTC in the container.
       docker compose logs -f backup
     (or trigger one immediately: `docker compose exec backup /usr/local/bin/backup.sh`.)
  5. The server's own key (#338): the four NALANDA_FILES_S3_* lines above go
     into the same infra/local/.env, beside — never instead of — the backup's
     AWS_* ones. Then run apps/server/S3-CHECK.md before flipping
     NALANDA_FILES_STORE to s3, and the migration in DEPLOY-JETSON.md.

STEPS

echo ""
echo "==> Done."
