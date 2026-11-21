#!/usr/bin/env bash
# Stage 1 - TERRAFORM STATE BUCKET (the one thing Terraform cannot create for itself).
# WHY: Terraform keeps a "state" file that records what it built. It contains generated passwords, so it must not sit in
# OneDrive or git. It goes in a private, encrypted, versioned S3 bucket. Terraform needs that bucket to exist BEFORE it
# can run, so this one bucket is made here by hand; everything else is made by Terraform.
# Locking uses S3's own lock file (use_lockfile), so no DynamoDB table is needed.
source "$(dirname "$0")/lib.sh"
BUCKET=$NAME-tfstate-$ACCOUNT

say "State bucket $BUCKET"
if retry aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  already exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  echo "  created"
fi
retry aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
retry aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled          # lets us recover an older state
retry aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
retry aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "{\"TagSet\":$(tags_json terraform-state)}"
# Refuse any non-HTTPS access to the bucket.
retry aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"TlsOnly\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::$BUCKET\",\"arn:aws:s3:::$BUCKET/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"
say "Verify"
retry aws s3api get-public-access-block --bucket "$BUCKET" --query 'PublicAccessBlockConfiguration' --output text
retry aws s3api get-bucket-versioning --bucket "$BUCKET" --query Status --output text
retry aws s3api get-bucket-tagging --bucket "$BUCKET" --query 'TagSet[].[Key,Value]' --output text
