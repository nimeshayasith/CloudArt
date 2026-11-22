variable "name" {
  description = "Prefix for resource names (for example cloudart-prod)."
  type        = string
}

variable "region" {
  description = "AWS region (the automatic-recovery alarm action is regional)."
  type        = string
}

variable "instance_id" {
  description = "EC2 instance the alarms watch."
  type        = string
}

variable "log_group_name" {
  description = "Name of the CloudWatch log group the API container writes to."
  type        = string
  default     = "/cloudart/prod/api"
}

variable "log_retention_days" {
  description = "Days logs are kept."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be one of the values CloudWatch Logs accepts (for example 7, 14, 30, 90, 365)."
  }
}

variable "budget_usd" {
  description = "Monthly spend (USD) that triggers the budget alerts."
  type        = number
  default     = 25

  validation {
    condition     = var.budget_usd > 0
    error_message = "budget_usd must be greater than 0."
  }
}

variable "alert_email" {
  description = "Address that receives alarm and budget e-mails. Empty = no subscription. The recipient must confirm by clicking a link."
  type        = string
  default     = ""

  validation {
    condition     = var.alert_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be empty or a valid e-mail address."
  }
}

variable "snapshot_tag" {
  description = "Tag that marks the disks to snapshot daily. Must match the tag the server module puts on the database disk."
  type        = map(string)
  default     = { Snapshot = "daily" }
}

variable "snapshot_retention_count" {
  description = "How many daily snapshots to keep."
  type        = number
  default     = 7

  validation {
    condition     = var.snapshot_retention_count >= 1 && var.snapshot_retention_count <= 1000
    error_message = "snapshot_retention_count must be between 1 and 1000."
  }
}
