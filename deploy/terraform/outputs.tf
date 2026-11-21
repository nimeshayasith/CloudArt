output "site_url" {
  description = "The live address of CloudArt (website and API)."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "server_instance_id" {
  value = aws_instance.api.id
}

output "server_public_ip" {
  value = aws_eip.api.public_ip
}

output "uploads_bucket" {
  value = aws_s3_bucket.this["uploads"].bucket
}

output "backups_bucket" {
  value = aws_s3_bucket.this["backups"].bucket
}

output "site_bucket" {
  value = aws_s3_bucket.this["site"].bucket
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_app_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "log_group" {
  value = aws_cloudwatch_log_group.api.name
}
