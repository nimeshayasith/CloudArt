#!/bin/bash
# Runs ON THE SERVER. Proves that the nightly backup can really be restored. Safe to run any time: it never touches the live
# database. It (1) takes the newest dump from S3, (2) loads it into a throwaway database "restore_drill", (3) compares the number
# of rows in the important tables with the live database, (4) drops the throwaway database.
# A backup that has never been restored is only a hope; run this after the first deploy and every few months.
#     bash /opt/cloudart/releases/<release>/deploy/server/restore-drill.sh
set -euo pipefail
cd /opt/cloudart
ENVF=.env.prod
get() { grep "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
PU=$(get POSTGRES_USER); PDB=$(get POSTGRES_DB); BUCKET=$(get BACKUP_BUCKET); REGION=$(get AWS_REGION)
DB="docker compose --env-file $ENVF -f docker-compose.prod.yml exec -T db"

KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix db/ --region "$REGION" --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)
[ "$KEY" != "None" ] && [ -n "$KEY" ] || { echo "no backup found in s3://$BUCKET/db/"; exit 1; }
echo "newest backup: s3://$BUCKET/$KEY"
TMP=$(mktemp /tmp/restore.XXXXXX.sql.gz)
trap 'rm -f "$TMP"; $DB psql -U "$PU" -d postgres -qc "drop database if exists restore_drill" >/dev/null 2>&1 || true' EXIT
aws s3 cp "s3://$BUCKET/$KEY" "$TMP" --region "$REGION" --only-show-errors
echo "downloaded $(stat -c %s "$TMP") bytes"

$DB psql -U "$PU" -d postgres -qc "drop database if exists restore_drill" -c "create database restore_drill"
gunzip -c "$TMP" | $DB psql -U "$PU" -d restore_drill -q -v ON_ERROR_STOP=1 >/dev/null
echo "restored into the scratch database"

FAILED=0
printf '%-26s %10s %10s\n' table live restored
for T in users courses lessons enrollments service_categories course_categories service_requests subscriptions payment_proofs _prisma_migrations; do
  A=$($DB psql -U "$PU" -d "$PDB" -tAc "select count(*) from \"$T\"" | tr -d '[:space:]')
  B=$($DB psql -U "$PU" -d restore_drill -tAc "select count(*) from \"$T\"" | tr -d '[:space:]')
  MARK=""; if [ "$A" != "$B" ]; then MARK="  <-- DIFFERENT (rows changed since the backup, or the backup is bad)"; FAILED=1; fi
  printf '%-26s %10s %10s%s\n' "$T" "$A" "$B" "$MARK"
done
[ "$FAILED" -eq 0 ] && echo "RESULT: restore drill PASSED" || { echo "RESULT: restore drill found differences"; exit 1; }
