#!/bin/bash
# Runs ON THE SERVER (as root, through SSM Run Command) to install a new version of the CloudArt API.
# Started by deploy/aws/05-ship.sh, which first uploads the code and passes the release name:
#     deploy.sh <release>            e.g.   deploy.sh a1b2c3d
# Steps, in order, and WHY:
#   1. settings   download the encrypted settings (.env.prod) from SSM, so the file is made on Linux with Unix line endings
#   2. build      docker build from the shipped source, natively on the server's ARM CPU (no registry needed; see deployment log R4)
#   3. database   start PostgreSQL and wait until it answers
#   4. migrate    apply database migrations from the NEW image BEFORE the new API starts
#   5. seed       idempotent: creates the service/course categories (and the admin row once ADMIN_EMAIL is set)
#   6. start      (re)start the API and wait until it is healthy; if it is not, the script fails and prints the container log
#   7. tidy       delete old images and old releases so the disk does not fill up
set -euo pipefail
RELEASE=${1:?usage: deploy.sh <release>}
BASE=/opt/cloudart
SRC=$BASE/releases/$RELEASE
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-ap-south-1}
cd "$BASE"

echo "== 1. settings"
aws ssm get-parameter --name /cloudart/prod/env --with-decryption --query Parameter.Value --output text > .env.prod.new
grep -q '^NODE_ENV=production$' .env.prod.new || { echo "settings look wrong (no NODE_ENV=production)"; exit 1; }
! grep -q $'\r' .env.prod.new || { echo "settings contain carriage returns"; exit 1; }
chmod 600 .env.prod.new
mv .env.prod.new .env.prod
cp "$SRC/deploy/docker-compose.prod.yml" docker-compose.prod.yml
COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"
SECRET=$(grep '^ORIGIN_VERIFY_SECRET=' .env.prod | cut -d= -f2-)

echo "== 2. build image cloudart-api:$RELEASE"
docker build -q -t "cloudart-api:$RELEASE" "$SRC/backend"
# Everything below uses THIS release's image. `latest` is only moved after the new API proves healthy (step 6), so a failed
# deploy never changes what a restart or reboot would run.
export API_IMAGE=cloudart-api:$RELEASE

echo "== 3. database"
$COMPOSE up -d db
for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q db)")" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q db)")" = healthy ] || { echo "database did not become healthy"; exit 1; }

echo "== 4. migrate"
$COMPOSE run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy

echo "== 5. seed"
$COMPOSE run --rm --no-deps api node prisma/seed.js

echo "== 6. start the API"
$COMPOSE up -d api
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/api/v1/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1/api/v1/health >/dev/null 2>&1 || { echo "API did not answer; last log lines:"; docker logs --tail 40 "$($COMPOSE ps -q api)" 2>&1 || true; exit 1; }
echo "liveness: $(curl -fsS http://127.0.0.1/api/v1/health)"
echo "database: $(curl -fsS -H "X-Origin-Verify: $SECRET" http://127.0.0.1/api/v1/health/db)"
echo "origin check (no header must be refused, expect 403): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/v1/courses)"

docker tag "cloudart-api:$RELEASE" cloudart-api:latest

echo "== 7. tidy"
docker image prune -f >/dev/null
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^cloudart-api:' | grep -v ':latest$' | grep -v ":$RELEASE\$" | tail -n +3 | xargs -r docker rmi 2>/dev/null || true
ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf
echo "deployed release $RELEASE"
df -h / /data | tail -2
