output "vpc_id" {
  description = "Id of the VPC."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Ids of the public subnets, in order."
  value       = aws_subnet.public[*].id

  # Anything placed in these subnets (the server and its Elastic IP) needs the internet gateway and the default route to exist
  # first. Because this output waits for them, consumers are ordered correctly without knowing about them.
  depends_on = [aws_internet_gateway.main, aws_route.internet]
}

output "public_subnet_azs" {
  description = "Availability zone of each public subnet, in the same order."
  value       = aws_subnet.public[*].availability_zone
}

output "api_security_group_id" {
  description = "Security group for the API server (HTTP from CloudFront only)."
  value       = aws_security_group.api.id
}
