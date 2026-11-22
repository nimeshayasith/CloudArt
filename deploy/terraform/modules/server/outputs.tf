output "instance_id" {
  description = "EC2 instance id (used by SSM Run Command and the alarms)."
  value       = aws_instance.api.id
}

output "public_ip" {
  description = "The server's fixed Elastic IP address."
  value       = aws_eip.api.public_ip
}

output "origin_dns" {
  description = "DNS name CloudFront uses to reach the API. For an Elastic IP the name is fixed by AWS's naming rule, so it can be computed before the server exists."
  value       = "ec2-${replace(aws_eip.api.public_ip, ".", "-")}.${var.region}.compute.amazonaws.com"
}

output "data_volume_id" {
  description = "Id of the database disk."
  value       = aws_ebs_volume.data.id
}

output "role_name" {
  description = "Name of the server's IAM role."
  value       = aws_iam_role.server.name
}
