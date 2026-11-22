#!/usr/bin/env bash
# Run Terraform for the production environment the same way every time.
#   deploy/aws/tf.sh plan            show what would change (changes nothing)
#   deploy/aws/tf.sh apply           create/update (asks for confirmation)
#   deploy/aws/tf.sh check           format check + validate + a plan that must show no changes (drift check)
# WHY a wrapper: it puts Terraform on the PATH, forces UTF-8 and runs from the right folder, so nobody has to remember that.
source "$(dirname "$0")/lib.sh"
cd "$TF_DIR"
case "${1:-}" in
  check)
    terraform fmt -check -recursive ../.. && echo "format: ok"
    terraform validate
    terraform plan -input=false -detailed-exitcode >/dev/null && echo "drift: none (the plan shows no changes)" ;;
  "") echo "usage: tf.sh <plan|apply|check|any terraform command>"; exit 2 ;;
  *) terraform "$@" ;;
esac
