variable "parameter_name" {
  description = "Name of the SSM parameter. The deploy script on the server reads exactly this name."
  type        = string
  default     = "/cloudart/prod/env"

  validation {
    condition     = startswith(var.parameter_name, "/")
    error_message = "parameter_name must start with a slash."
  }
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group the API container writes to."
  type        = string
}

variable "site_origin" {
  description = "Public address of the site including https:// and no trailing slash (the API's CORS_ORIGIN)."
  type        = string

  validation {
    condition     = startswith(var.site_origin, "https://") && !endswith(var.site_origin, "/")
    error_message = "site_origin must start with https:// and have no trailing slash."
  }
}

variable "origin_verify_secret" {
  description = "Secret that CloudFront sends as X-Origin-Verify and the API requires."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.origin_verify_secret) >= 24
    error_message = "origin_verify_secret must be at least 24 characters (the API refuses a shorter one at start-up)."
  }
}

variable "uploads_bucket" {
  description = "Name of the private uploads bucket."
  type        = string
}

variable "backups_bucket" {
  description = "Name of the backups bucket."
  type        = string
}

variable "cognito_pool_id" {
  description = "Production Cognito user pool id."
  type        = string
}

variable "cognito_client_id" {
  description = "Production Cognito app client id."
  type        = string
}

variable "admin_email" {
  description = "E-mail of the first administrator for the one-time seed. Empty means no admin is seeded yet."
  type        = string
  default     = ""

  validation {
    condition     = var.admin_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.admin_email))
    error_message = "admin_email must be empty or a valid e-mail address."
  }
}
