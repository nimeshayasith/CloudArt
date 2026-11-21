#!/usr/bin/env bash
# Shared helpers for the CloudArt production deployment scripts (source this file; do not run it).
#
# WHY each setting exists:
#  - set -euo pipefail      stop at the first error, so a half-finished stage is never mistaken for a finished one.
#  - AWS_PAGER=""           the AWS CLI otherwise opens a pager ("less") and waits for a key press.
#  - MSYS_NO_PATHCONV=1     Git Bash on Windows rewrites arguments that look like Unix paths ("/cloudart/prod/env" becomes
#                           "C:/Program Files/Git/cloudart/prod/env"), which silently corrupts AWS names. This switches that off.
#  - the tags               every resource must carry the four mandatory tags (see docs/aws-resources.md).
set -euo pipefail
export AWS_PAGER=""
export AWS_DEFAULT_REGION=ap-south-1
export MSYS_NO_PATHCONV=1
# The AWS CLI on Windows crashes ("charmap codec can't encode") when server output contains non-ASCII characters; force UTF-8.
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
# Terraform was installed by hand into a folder outside OneDrive, so no system PATH change was needed.
export PATH="/c/Users/nimes/tools/terraform:$PATH"

REGION=ap-south-1
ACCOUNT=589531223229
NAME=cloudart-prod                      # prefix for every resource name
TAG_PROJECT=CloudArt
TAG_ENV=prod
TAG_MANAGED=ClaudeCode

# tags_cli <component>    ->  "Key=Project,Value=CloudArt Key=Environment,Value=prod Key=Component,Value=<c> Key=ManagedBy,Value=ClaudeCode"
tags_cli() { echo "Key=Project,Value=$TAG_PROJECT Key=Environment,Value=$TAG_ENV Key=Component,Value=$1 Key=ManagedBy,Value=$TAG_MANAGED"; }
# tags_json <component>   ->  [{"Key":..,"Value":..},..]   (for services that take JSON tag lists)
tags_json() { printf '[{"Key":"Project","Value":"%s"},{"Key":"Environment","Value":"%s"},{"Key":"Component","Value":"%s"},{"Key":"ManagedBy","Value":"%s"}]' "$TAG_PROJECT" "$TAG_ENV" "$1" "$TAG_MANAGED"; }
# tags_map <component>    ->  {"Project":..,...}   (for services that take a JSON tag map)
tags_map() { printf '{"Project":"%s","Environment":"%s","Component":"%s","ManagedBy":"%s"}' "$TAG_PROJECT" "$TAG_ENV" "$1" "$TAG_MANAGED"; }

# The connection from the developer PC to AWS drops now and then ("Connection was closed before we received a valid response").
# Use retry ONLY for read-only calls. Creating calls are made safe by checking for the resource first ("ensure" pattern),
# because repeating a create after a lost reply could create a duplicate.
retry() {
  local attempt=1
  until "$@"; do
    if [ "$attempt" -ge 5 ]; then echo "FAILED after $attempt attempts: $*" >&2; return 1; fi
    echo "  ...retrying ($attempt) in $((attempt * 3))s" >&2
    sleep $((attempt * 3)); attempt=$((attempt + 1))
  done
}

say() { printf '\n== %s\n' "$*"; }
