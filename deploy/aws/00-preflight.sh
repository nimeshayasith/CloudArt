#!/usr/bin/env bash
# Stage 0 - PREFLIGHT. Read-only. Answers: who am I, can I reach each AWS service we need, and what does the Free Plan allow?
# WHY: the earlier checks showed RDS/ECR calls dropping the connection and App Runner being disabled. Finding out which
# services work now is cheaper than discovering it half-way through building something.
source "$(dirname "$0")/lib.sh"

say "Identity (we are using the account's root keys; see docs/deployment-log.md, risk R1)"
retry aws sts get-caller-identity --query '[Arn]' --output text

say "Free Plan state"
retry aws freetier get-account-plan-state --region us-east-1 --query '{plan:accountPlanType,status:accountPlanStatus,credits:accountPlanRemainingCredits.amount,expires:accountPlanExpirationDate}' --output json

say "Can we reach each service? (OK = the call answered)"
check() { local label="$1"; shift; if out=$(retry "$@" 2>&1); then printf '  OK    %s\n' "$label"; else printf '  FAIL  %s -> %s\n' "$label" "$(echo "$out" | tail -1)"; fi; }
check "EC2"            aws ec2 describe-vpcs --query 'length(Vpcs)'
check "ECR"            aws ecr describe-repositories --query 'length(repositories)'
check "S3"             aws s3api list-buckets --query 'length(Buckets)'
check "SSM"            aws ssm describe-parameters --max-results 1
check "IAM"            aws iam list-roles --max-items 1
check "CloudFront"     aws cloudfront list-distributions --query 'length(DistributionList.Items || `[]`)'
check "CloudWatch Logs" aws logs describe-log-groups --limit 1
check "CloudWatch"     aws cloudwatch describe-alarms --max-records 1
check "SNS"            aws sns list-topics
check "DLM (snapshots)" aws dlm get-lifecycle-policies
check "Budgets"        aws budgets describe-budgets --account-id "$ACCOUNT" --max-results 1
check "Cognito"        aws cognito-idp list-user-pools --max-results 1

say "Instance type offered in this region?"
retry aws ec2 describe-instance-types --instance-types t4g.small --query 'InstanceTypes[].[InstanceType,MemoryInfo.SizeInMiB,VCpuInfo.DefaultVCpus]' --output text

say "Latest Amazon Linux 2023 arm64 image id (from the public SSM parameter)"
retry aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query 'Parameter.Value' --output text
