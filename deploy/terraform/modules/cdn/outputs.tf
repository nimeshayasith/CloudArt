output "domain_name" {
  description = "The *.cloudfront.net address of the site (website and API)."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "distribution_id" {
  description = "Distribution id, used to invalidate cached pages after publishing."
  value       = aws_cloudfront_distribution.main.id
}

output "distribution_arn" {
  description = "ARN of the distribution."
  value       = aws_cloudfront_distribution.main.arn
}

output "origin_verify_secret" {
  description = "Value of the X-Origin-Verify header (the API's ORIGIN_VERIFY_SECRET)."
  value       = random_password.origin.result
  sensitive   = true
}
