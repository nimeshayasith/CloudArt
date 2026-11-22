variable "name" {
  description = "Prefix for bucket names (for example cloudart-prod). The AWS account id is appended to make the names globally unique."
  type        = string
}

variable "noncurrent_version_days" {
  description = "Days an old version of an uploaded file is kept after it is replaced or deleted (undo window)."
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_version_days >= 1
    error_message = "noncurrent_version_days must be at least 1."
  }
}

variable "backup_retention_days" {
  description = "Days a database dump is kept in the backups bucket."
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_days >= 7
    error_message = "Keep database dumps for at least 7 days."
  }
}
