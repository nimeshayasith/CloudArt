variable "name" {
  description = "Prefix for resource names (for example cloudart-prod)."
  type        = string
}

variable "region" {
  description = "AWS region, used to name the S3 gateway endpoint service."
  type        = string
}

variable "vpc_cidr" {
  description = "Address range of the VPC. Must not overlap another VPC you may connect later."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 16
    error_message = "vpc_cidr must be a valid CIDR block of /16 or larger (it is split into /24 subnets)."
  }
}

variable "public_subnet_count" {
  description = "Number of public subnets, one per availability zone."
  type        = number
  default     = 2

  validation {
    condition     = var.public_subnet_count >= 1 && var.public_subnet_count <= 3
    error_message = "public_subnet_count must be between 1 and 3."
  }
}
