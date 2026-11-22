output "bucket_names" {
  description = "Bucket names by role: uploads, backups, site."
  value       = { for role, bucket in aws_s3_bucket.this : role => bucket.bucket }
}

output "bucket_arns" {
  description = "Bucket ARNs by role: uploads, backups, site."
  value       = { for role, bucket in aws_s3_bucket.this : role => bucket.arn }
}

output "site_bucket_id" {
  description = "Id of the bucket that holds the website (the cdn module attaches its read policy)."
  value       = aws_s3_bucket.this["site"].id

  # A bucket policy applied while the public-access block is still being set up is rejected by S3. Because this output waits
  # for the block, anything that uses it (the cdn module's bucket policy) is automatically ordered after it.
  depends_on = [aws_s3_bucket_public_access_block.this]
}

output "site_bucket_regional_domain_name" {
  description = "Regional domain name of the website bucket, used as the CloudFront S3 origin."
  value       = aws_s3_bucket.this["site"].bucket_regional_domain_name
}
