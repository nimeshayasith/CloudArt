output "alerts_topic_arn" {
  description = "SNS topic every alarm and budget notice is sent to."
  value       = aws_sns_topic.alerts.arn
}

output "log_group_name" {
  description = "Name of the API's log group."
  value       = aws_cloudwatch_log_group.api.name
}

output "log_group_arn" {
  description = "ARN of the API's log group (the server's role may write to it)."
  value       = aws_cloudwatch_log_group.api.arn
}
