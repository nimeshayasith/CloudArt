# The production environment: wires the modules together. Each module has a single job and a small interface
# (see modules/*/variables.tf and outputs.tf); this file is the only place that knows how they connect.
#
#   network ─┐                      ┌─> cdn ──────────┐
#   storage ─┼─> server <───────────┤                 ├─> settings (the server reads these settings when deployed)
#   operations ┘   (alarms watch it)└─ auth ──────────┘
#
# There are no circular dependencies: `server` only needs the settings parameter's ARN (for its permissions), while `settings`
# needs values from `cdn` and `auth`, and `cdn` needs only the server's public DNS name.

locals {
  log_group    = "/cloudart/prod/api"
  snapshot_tag = { Snapshot = "daily" } # shared contract: the server tags its database disk, operations snapshots disks with it
}

module "network" {
  source = "../../modules/network"

  name   = var.name
  region = var.region
}

module "storage" {
  source = "../../modules/storage"

  name = var.name
}

module "auth" {
  source = "../../modules/auth"

  name                = var.name
  deletion_protection = var.cognito_deletion_protection
}

module "operations" {
  source = "../../modules/operations"

  name           = var.name
  region         = var.region
  instance_id    = module.server.instance_id
  log_group_name = local.log_group
  budget_usd     = var.budget_usd
  alert_email    = var.alert_email
  snapshot_tag   = local.snapshot_tag
}

module "server" {
  source = "../../modules/server"

  name                   = var.name
  region                 = var.region
  instance_type          = var.instance_type
  root_volume_gb         = var.root_volume_gb
  data_volume_gb         = var.data_volume_gb
  snapshot_tag           = local.snapshot_tag
  subnet_id              = module.network.public_subnet_ids[0]
  availability_zone      = module.network.public_subnet_azs[0]
  security_group_ids     = [module.network.api_security_group_id]
  uploads_bucket_arn     = module.storage.bucket_arns["uploads"]
  backups_bucket_arn     = module.storage.bucket_arns["backups"]
  settings_parameter_arn = module.settings.parameter_arn
  log_group_arn          = module.operations.log_group_arn
}

module "cdn" {
  source = "../../modules/cdn"

  name                             = var.name
  price_class                      = var.cloudfront_price_class
  csp_mode                         = var.csp_mode
  site_bucket_id                   = module.storage.site_bucket_id
  site_bucket_arn                  = module.storage.bucket_arns["site"]
  site_bucket_regional_domain_name = module.storage.site_bucket_regional_domain_name
  api_origin_domain                = module.server.origin_dns
}

module "settings" {
  source = "../../modules/settings"

  region               = var.region
  log_group_name       = local.log_group
  site_origin          = "https://${module.cdn.domain_name}"
  origin_verify_secret = module.cdn.origin_verify_secret
  uploads_bucket       = module.storage.bucket_names["uploads"]
  backups_bucket       = module.storage.bucket_names["backups"]
  cognito_pool_id      = module.auth.user_pool_id
  cognito_client_id    = module.auth.app_client_id
  admin_email          = var.admin_email
}
