# REFACTOR MAP. The infrastructure was first built from one flat set of files (resources at the top level). It was then split
# into modules. A `moved` block tells Terraform "this resource is the SAME real thing, it just has a new address", so the
# refactor changes only the state and nothing in AWS. (Without these blocks Terraform would plan to destroy every old resource
# and create new ones, including the database disk.)
# After the refactor was applied, the plan showed "0 to add, 0 to change, 0 to destroy". These blocks may be deleted once every
# environment that used the old layout has applied them; they are kept here as documentation of the history.

# ── network
moved {
  from = aws_vpc.main
  to   = module.network.aws_vpc.main
}
moved {
  from = aws_internet_gateway.main
  to   = module.network.aws_internet_gateway.main
}
moved {
  from = aws_subnet.public
  to   = module.network.aws_subnet.public
}
moved {
  from = aws_route_table.public
  to   = module.network.aws_route_table.public
}
moved {
  from = aws_route.internet
  to   = module.network.aws_route.internet
}
moved {
  from = aws_route_table_association.public
  to   = module.network.aws_route_table_association.public
}
moved {
  from = aws_vpc_endpoint.s3
  to   = module.network.aws_vpc_endpoint.s3
}
moved {
  from = aws_default_security_group.default
  to   = module.network.aws_default_security_group.default
}
moved {
  from = aws_security_group.api
  to   = module.network.aws_security_group.api
}

# ── storage
moved {
  from = aws_s3_bucket.this
  to   = module.storage.aws_s3_bucket.this
}
moved {
  from = aws_s3_bucket_public_access_block.this
  to   = module.storage.aws_s3_bucket_public_access_block.this
}
moved {
  from = aws_s3_bucket_ownership_controls.this
  to   = module.storage.aws_s3_bucket_ownership_controls.this
}
moved {
  from = aws_s3_bucket_server_side_encryption_configuration.this
  to   = module.storage.aws_s3_bucket_server_side_encryption_configuration.this
}
moved {
  from = aws_s3_bucket_versioning.uploads
  to   = module.storage.aws_s3_bucket_versioning.uploads
}
moved {
  from = aws_s3_bucket_lifecycle_configuration.uploads
  to   = module.storage.aws_s3_bucket_lifecycle_configuration.uploads
}
moved {
  from = aws_s3_bucket_lifecycle_configuration.backups
  to   = module.storage.aws_s3_bucket_lifecycle_configuration.backups
}
moved {
  from = aws_s3_bucket_lifecycle_configuration.site
  to   = module.storage.aws_s3_bucket_lifecycle_configuration.site
}
moved {
  from = aws_s3_bucket_policy.private
  to   = module.storage.aws_s3_bucket_policy.private
}

# ── auth
moved {
  from = aws_cognito_user_pool.main
  to   = module.auth.aws_cognito_user_pool.main
}
moved {
  from = aws_cognito_user_pool_client.web
  to   = module.auth.aws_cognito_user_pool_client.web
}

# ── server (permissions and the machine)
moved {
  from = aws_iam_role.server
  to   = module.server.aws_iam_role.server
}
moved {
  from = aws_iam_role_policy_attachment.ssm_core
  to   = module.server.aws_iam_role_policy_attachment.ssm_core
}
moved {
  from = aws_iam_role_policy.server
  to   = module.server.aws_iam_role_policy.server
}
moved {
  from = aws_iam_instance_profile.server
  to   = module.server.aws_iam_instance_profile.server
}
moved {
  from = aws_eip.api
  to   = module.server.aws_eip.api
}
moved {
  from = aws_ebs_volume.data
  to   = module.server.aws_ebs_volume.data
}
moved {
  from = aws_instance.api
  to   = module.server.aws_instance.api
}
moved {
  from = aws_volume_attachment.data
  to   = module.server.aws_volume_attachment.data
}
moved {
  from = aws_eip_association.api
  to   = module.server.aws_eip_association.api
}

# ── cdn
moved {
  from = random_password.origin
  to   = module.cdn.random_password.origin
}
moved {
  from = aws_cloudfront_origin_access_control.site
  to   = module.cdn.aws_cloudfront_origin_access_control.site
}
moved {
  from = aws_cloudfront_function.spa
  to   = module.cdn.aws_cloudfront_function.spa
}
moved {
  from = aws_cloudfront_response_headers_policy.site
  to   = module.cdn.aws_cloudfront_response_headers_policy.site
}
moved {
  from = aws_cloudfront_distribution.main
  to   = module.cdn.aws_cloudfront_distribution.main
}
moved {
  from = aws_s3_bucket_policy.site
  to   = module.cdn.aws_s3_bucket_policy.site
}

# ── settings
moved {
  from = random_password.db
  to   = module.settings.random_password.db
}
moved {
  from = aws_ssm_parameter.env
  to   = module.settings.aws_ssm_parameter.env
}

# ── operations
moved {
  from = aws_sns_topic.alerts
  to   = module.operations.aws_sns_topic.alerts
}
moved {
  from = aws_sns_topic_policy.alerts
  to   = module.operations.aws_sns_topic_policy.alerts
}
moved {
  from = aws_budgets_budget.monthly
  to   = module.operations.aws_budgets_budget.monthly
}
moved {
  from = aws_cloudwatch_log_group.api
  to   = module.operations.aws_cloudwatch_log_group.api
}
moved {
  from = aws_iam_role.dlm
  to   = module.operations.aws_iam_role.dlm
}
moved {
  from = aws_iam_role_policy_attachment.dlm
  to   = module.operations.aws_iam_role_policy_attachment.dlm
}
moved {
  from = aws_dlm_lifecycle_policy.daily
  to   = module.operations.aws_dlm_lifecycle_policy.daily
}
moved {
  from = aws_cloudwatch_metric_alarm.system_check
  to   = module.operations.aws_cloudwatch_metric_alarm.system_check
}
moved {
  from = aws_cloudwatch_metric_alarm.instance_check
  to   = module.operations.aws_cloudwatch_metric_alarm.instance_check
}
moved {
  from = aws_cloudwatch_metric_alarm.cpu_credits
  to   = module.operations.aws_cloudwatch_metric_alarm.cpu_credits
}
moved {
  from = aws_cloudwatch_metric_alarm.disk
  to   = module.operations.aws_cloudwatch_metric_alarm.disk
}
moved {
  from = aws_cloudwatch_metric_alarm.memory
  to   = module.operations.aws_cloudwatch_metric_alarm.memory
}
moved {
  from = aws_cloudwatch_metric_alarm.backup
  to   = module.operations.aws_cloudwatch_metric_alarm.backup
}
moved {
  from = aws_cloudwatch_log_metric_filter.errors_5xx
  to   = module.operations.aws_cloudwatch_log_metric_filter.errors_5xx
}
moved {
  from = aws_cloudwatch_metric_alarm.errors_5xx
  to   = module.operations.aws_cloudwatch_metric_alarm.errors_5xx
}
