output "parameter_arn" {
  description = "ARN of the settings parameter (the server's role is allowed to read only this)."
  value       = aws_ssm_parameter.env.arn
}

output "parameter_name" {
  description = "Name of the settings parameter."
  value       = aws_ssm_parameter.env.name
}
