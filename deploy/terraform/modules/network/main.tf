# A dedicated VPC, so CloudArt shares nothing with the other projects in the account. No NAT gateway (about 35 USD a month):
# the server sits in a public subnet and is protected by its security group instead.

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.name}-vpc", Component = "network" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name}-igw", Component = "network" }
}

# Subnets in different zones are free. Option A uses only the first; the others keep the door open for RDS or a second server.
resource "aws_subnet" "public" {
  count                   = var.public_subnet_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 1)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false # the server gets a fixed Elastic IP instead
  tags                    = { Name = "${var.name}-public-${count.index + 1}", Component = "network" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name}-public", Component = "network" }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = var.public_subnet_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Free "gateway endpoint": traffic from the server to S3 (uploads, backups, shipping the app) stays inside AWS.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags              = { Name = "${var.name}-s3", Component = "network" }
}

# The VPC's built-in default security group is emptied so nothing can accidentally use it.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name}-default-unused", Component = "network" }
}

# AWS publishes the addresses CloudFront connects from as a "managed prefix list".
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "CloudArt API server: HTTP only from CloudFront, no SSH"
  vpc_id      = aws_vpc.main.id

  # Only CloudFront may connect, and only to port 80. There is NO ssh rule: the server is managed through SSM Session Manager.
  # (The prefix list is shared by every CloudFront customer, which is why the API also checks a secret header.)
  ingress {
    description     = "HTTP from CloudFront"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  # The server must reach S3, Cognito, package repositories and the SSM service.
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name}-api", Component = "network" }
}
