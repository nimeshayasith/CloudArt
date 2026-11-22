variable "region" {
  description = "AWS region for everything except the global CloudFront service."
  type        = string
  default     = "ap-south-1"
}

variable "name" {
  description = "Prefix for every resource name, so everything is easy to find and delete."
  type        = string
  default     = "cloudart-prod"
}

variable "instance_type" {
  description = "Server size (ARM only). t4g.small = 2 GiB memory (about 8 USD a month); t4g.micro = 1 GiB (about 4 USD)."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gb" {
  description = "System disk. Holds the operating system, Docker images and the build cache."
  type        = number
  default     = 16
}

variable "data_volume_gb" {
  description = "Separate disk for the PostgreSQL data, snapshotted every day."
  type        = number
  default     = 20
}

variable "budget_usd" {
  description = "Monthly spend that triggers the budget alerts (the design costs about 16 USD)."
  type        = number
  default     = 25
}

variable "alert_email" {
  description = "Address that receives alarm and budget e-mails. Empty = no subscription (add one later). The recipient must click a confirmation link."
  type        = string
  default     = ""
}

variable "admin_email" {
  description = "E-mail of the first administrator, used by the one-time seed. Empty = no admin is seeded yet."
  type        = string
  default     = ""
}

variable "cloudfront_price_class" {
  description = "PriceClass_All includes India and the rest of Asia (PriceClass_100 would not)."
  type        = string
  default     = "PriceClass_All"
}

variable "csp_mode" {
  description = "Content-Security-Policy mode for the website: report-only (log violations) or enforce (block them)."
  type        = string
  default     = "report-only"
}
