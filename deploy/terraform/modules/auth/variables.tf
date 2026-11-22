variable "name" {
  description = "Prefix for resource names (for example cloudart-prod)."
  type        = string
}

variable "deletion_protection" {
  description = "ACTIVE blocks deleting the pool (and every student account in it). Set INACTIVE only to tear everything down."
  type        = string
  default     = "ACTIVE"

  validation {
    condition     = contains(["ACTIVE", "INACTIVE"], var.deletion_protection)
    error_message = "deletion_protection must be ACTIVE or INACTIVE."
  }
}
