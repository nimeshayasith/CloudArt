variable "name" {
  description = "Prefix for resource names (for example cloudart-prod)."
  type        = string
}

variable "region" {
  description = "AWS region (used in the first-boot script and in the server's public DNS name)."
  type        = string
}

variable "subnet_id" {
  description = "Public subnet the server is placed in."
  type        = string
}

variable "availability_zone" {
  description = "Availability zone of that subnet. The database disk is created in the same zone."
  type        = string
}

variable "security_group_ids" {
  description = "Security groups attached to the server."
  type        = list(string)
}

variable "instance_type" {
  description = "Server size. Must be an ARM (Graviton) type: the first-boot script installs ARM binaries."
  type        = string
  default     = "t4g.small"

  validation {
    condition     = can(regex("^[a-z][0-9]g[a-z]*\\.", var.instance_type))
    error_message = "instance_type must be an ARM Graviton type such as t4g.small (the Docker Compose binary installed at boot is for aarch64)."
  }
}

variable "root_volume_gb" {
  description = "System disk size in GB (operating system, Docker images, build cache)."
  type        = number
  default     = 16

  validation {
    condition     = var.root_volume_gb >= 12
    error_message = "The system disk must be at least 12 GB (image builds need room)."
  }
}

variable "data_volume_gb" {
  description = "Database disk size in GB."
  type        = number
  default     = 20

  validation {
    condition     = var.data_volume_gb >= 10
    error_message = "The database disk must be at least 10 GB."
  }
}

variable "snapshot_tag" {
  description = "Tag put on the database disk. The operations module's daily snapshot policy selects disks by this tag."
  type        = map(string)
  default     = { Snapshot = "daily" }
}

variable "uploads_bucket_arn" {
  description = "ARN of the private uploads bucket the API may read and write."
  type        = string
}

variable "backups_bucket_arn" {
  description = "ARN of the backups bucket (database dumps and shipped releases)."
  type        = string
}

variable "settings_parameter_arn" {
  description = "ARN of the SSM parameter holding the server's settings. The role may read only this parameter."
  type        = string
}

variable "log_group_arn" {
  description = "ARN of the CloudWatch log group the API container writes to."
  type        = string
}
