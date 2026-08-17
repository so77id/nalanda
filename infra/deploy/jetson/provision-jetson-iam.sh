#!/usr/bin/env bash
#
# Provision the Nalanda backups bucket + the least-privilege IAM user the
# Jetson uses to write into it (#162, ADR-0037).
#
# Idempotent: safe to re-run. Requires AWS admin credentials in the current
# shell (NOT the Jetson creds). Run from a laptop with the AWS CLI installed,
# never from the box. The Jetson never sees admin credentials.
#
# After running, copy the printed access key into /etc/nalanda/.env on the
# Jetson, restart the backup container, and verify with the two commands the
# script prints at the end.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_TEMPLATE="${SCRIPT_DIR}/nalanda-jetson-user-policy.json"
LIFECYCLE_FILE="${SCRIPT_DIR}/nalanda-jetson-bucket-lifecycle.json"

if [[ -z "${NALANDA_S3_BUCKET:-}" ]]; then
  echo "error: set NALANDA_S3_BUCKET to the bucket name Miguel picked (e.g. nalanda-backups-udp-2026)" >&2
  exit 1
fi
if [[ -z "${AWS_REGION:-}" ]]; then
  echo "error: set AWS_REGION to the region the bucket should live in (e.g. us-east-1)" >&2
  exit 1
fi

for f in "${POLICY_TEMPLATE}" "${LIFECYCLE_FILE}"; do
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

echo "==> Attaching inline policy '${POLICY_NAME}' (least privilege, PutObject on backups/ only)..."
# Substitute ${NALANDA_S3_BUCKET} in the template. envsubst is not on every
# Nalanda operator's laptop; sed is.
RENDERED_POLICY="$(sed "s|\${NALANDA_S3_BUCKET}|${NALANDA_S3_BUCKET}|g" "${POLICY_TEMPLATE}")"
aws iam put-user-policy \
  --user-name "${USER_NAME}" \
  --policy-name "${POLICY_NAME}" \
  --policy-document "${RENDERED_POLICY}"
echo "    Policy attached (PutObject + ListBucket on ${NALANDA_S3_BUCKET}/backups/)."

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

cat <<'STEPS'

==> Next steps (on the Jetson):
  1. Edit /etc/nalanda/.env (or wherever the compose file's env_file points):
     put the four variables above into it.
  2. Restart the backup + monitor services:
       cd infra/local
       docker compose up -d --build backup monitor
  3. Verify the credentials work — this uploads a zero-byte probe and deletes
     the local copy after the S3 side reports OK. It should print no error:
       aws s3 cp /dev/null "s3://${NALANDA_S3_BUCKET}/backups/_probe-$(hostname)-$(date +%s).ok"
  4. Watch the first cron trigger land: it runs at 03:00 UTC in the container.
       docker compose logs -f backup
     (or trigger one immediately: `docker compose exec backup /usr/local/bin/backup.sh`.)

STEPS

echo ""
echo "==> Done."
