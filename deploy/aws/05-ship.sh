#!/usr/bin/env bash
# Stage 5 - SHIP THE API TO THE SERVER.
# Usage:  deploy/aws/05-ship.sh            (ships the current git commit; the working tree must be clean)
# WHY this way: ECR cannot be reached from this PC (error E1), so instead of pushing an image we ship the SOURCE of the exact
# git commit as a tar archive through S3, and the server builds the image itself (deploy/server/deploy.sh). Using
# `git archive` guarantees that what is deployed is exactly what is committed, and the commit id names the release.
source "$(dirname "$0")/lib.sh"
cd "$(git rev-parse --show-toplevel)"

[ -z "$(git status --porcelain)" ] || { echo "The working tree has uncommitted changes. Commit first so the release matches a commit."; git status --short; exit 1; }
RELEASE=$(git rev-parse --short HEAD)

TF="deploy/terraform"
BUCKET=$(cd $TF && terraform output -raw backups_bucket)
INSTANCE=$(cd $TF && terraform output -raw server_instance_id)
KEY=artifacts/cloudart-$RELEASE.tar.gz

say "Archive release $RELEASE (backend/ and deploy/ only) and upload to s3://$BUCKET/$KEY"
git archive --format=tar.gz -o "/tmp/cloudart-$RELEASE.tar.gz" HEAD backend deploy
ls -l "/tmp/cloudart-$RELEASE.tar.gz" | awk '{print "  size: " $5 " bytes"}'
retry aws s3 cp "/tmp/cloudart-$RELEASE.tar.gz" "s3://$BUCKET/$KEY" --only-show-errors
rm -f "/tmp/cloudart-$RELEASE.tar.gz"

say "Wait until the server is managed by SSM (it needs a minute after first boot)"
for i in $(seq 1 40); do
  S=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$S" = "Online" ] && break
  sleep 6
done
echo "  SSM status: $S"; [ "$S" = "Online" ] || { echo "server is not reachable through SSM"; exit 1; }

say "Run the deploy on the server"
CMD="set -e; export AWS_DEFAULT_REGION=$REGION; mkdir -p /opt/cloudart/releases/$RELEASE; aws s3 cp s3://$BUCKET/$KEY /tmp/release.tar.gz --only-show-errors; tar -xzf /tmp/release.tar.gz -C /opt/cloudart/releases/$RELEASE; rm -f /tmp/release.tar.gz; bash /opt/cloudart/releases/$RELEASE/deploy/server/deploy.sh $RELEASE"
CMD_ID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --comment "CloudArt deploy $RELEASE" \
  --parameters "commands=[\"$CMD\"]" --timeout-seconds 1500 --query Command.CommandId --output text)
echo "  command id: $CMD_ID"

# Poll until it finishes, then show the output.
for i in $(seq 1 150); do
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 8
done
say "Result: $STATUS"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --query 'StandardOutputContent' --output text
if [ "$STATUS" != "Success" ]; then
  echo "---- error output ----"
  aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --query 'StandardErrorContent' --output text
  exit 1
fi
