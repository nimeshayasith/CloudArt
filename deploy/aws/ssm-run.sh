#!/usr/bin/env bash
# Run a shell command ON THE SERVER through SSM Run Command (no SSH, no open port) and print its output.
# Usage:  deploy/aws/ssm-run.sh 'df -h; docker ps'
# WHY a script: the command text can contain quotes and other special characters; python's json.dumps builds the
# --parameters JSON safely, which hand-written quoting in the shell did not (see error E6 in the deployment log).
source "$(dirname "$0")/lib.sh"
CMD=${1:?usage: ssm-run.sh '<shell command>'}
INSTANCE=${INSTANCE:-$(cd "$(dirname "$0")/../terraform" && terraform output -raw server_instance_id)}
TIMEOUT_POLLS=${TIMEOUT_POLLS:-120}

PARAMS=$(python -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$CMD")
ID=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --parameters "$PARAMS" --query Command.CommandId --output text)
STATUS=Pending
for _ in $(seq 1 "$TIMEOUT_POLLS"); do
  STATUS=$(aws ssm get-command-invocation --command-id "$ID" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in Success|Failed|TimedOut|Cancelled) break ;; esac
  sleep 3
done
echo "[ssm status: $STATUS]"
aws ssm get-command-invocation --command-id "$ID" --instance-id "$INSTANCE" --query 'StandardOutputContent' --output text
ERR=$(aws ssm get-command-invocation --command-id "$ID" --instance-id "$INSTANCE" --query 'StandardErrorContent' --output text)
[ -z "$ERR" ] || { echo "--- stderr ---"; echo "$ERR"; }
[ "$STATUS" = Success ]
