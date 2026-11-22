output "site_url" {
  description = "The live address of CloudArt (website and API)."
  value       = "https://${module.cdn.domain_name}"
}

output "cloudfront_distribution_id" {
  value = module.cdn.distribution_id
}

output "server_instance_id" {
  value = module.server.instance_id
}

output "server_public_ip" {
  value = module.server.public_ip
}

output "uploads_bucket" {
  value = module.storage.bucket_names["uploads"]
}

output "backups_bucket" {
  value = module.storage.bucket_names["backups"]
}

output "site_bucket" {
  value = module.storage.bucket_names["site"]
}

output "cognito_user_pool_id" {
  value = module.auth.user_pool_id
}

output "cognito_app_client_id" {
  value = module.auth.app_client_id
}

output "alerts_topic_arn" {
  value = module.operations.alerts_topic_arn
}

output "log_group" {
  value = module.operations.log_group_name
}
