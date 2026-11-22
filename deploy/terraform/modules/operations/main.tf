# Alerts, budget, logs, snapshots and alarms. One server holds the database (risk R2 in the deployment log), so these are not
# optional extras: they are what makes the design safe enough to run.

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

# ── Alerts ────────────────────────────────────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
  tags = { Component = "alerts" }
}

data "aws_iam_policy_document" "alerts" {
  statement {
    sid       = "AccountOwner"
    actions   = ["SNS:Publish", "SNS:Subscribe", "SNS:GetTopicAttributes", "SNS:ListSubscriptionsByTopic"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [local.account_id]
    }
  }
  # Without these two statements alarms and budget notices would be created but silently never delivered.
  statement {
    sid       = "CloudWatchAlarms"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }
  statement {
    sid       = "Budgets"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

# Optional e-mail subscription (the recipient must click the confirmation link AWS sends).
resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Monthly budget limited to resources tagged Project=CloudArt (the tag must be an activated cost-allocation tag; until it is,
# the budget shows 0). Credits are NOT counted, so it measures what is really used.
resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
  }

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$CloudArt"]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }
  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  tags = { Component = "alerts" }

  depends_on = [aws_sns_topic_policy.alerts]
}

# ── Logs ──────────────────────────────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = var.log_group_name
  retention_in_days = var.log_retention_days
  tags              = { Component = "logs" }
}

# ── Daily snapshots of the database disk ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "dlm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${var.name}-snapshots"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json
  tags               = { Component = "backups" }
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily" {
  description        = "CloudArt daily snapshot of the database disk - keep ${var.snapshot_retention_count}"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = var.snapshot_tag # the database disk carries this tag (server module)

    schedule {
      name = "daily"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["21:00"] # 02:30 in India
      }
      retain_rule {
        count = var.snapshot_retention_count
      }
      copy_tags = true
    }
  }

  tags = { Component = "backups" }
}

# ── Alarms (all publish to the alerts topic) ─────────────────────────────────────────────────────────────────
# The first one also lets AWS repair the server by itself: if the hardware under it fails, AWS moves it to healthy hardware
# (same disks, same Elastic IP).

resource "aws_cloudwatch_metric_alarm" "system_check" {
  alarm_name          = "${var.name}-server-hardware-failed"
  alarm_description   = "AWS reports a hardware/system problem with the server; it is recovered automatically."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn, "arn:aws:automate:${var.region}:ec2:recover"]
  tags                = { Component = "alerts" }
}

resource "aws_cloudwatch_metric_alarm" "instance_check" {
  alarm_name          = "${var.name}-server-not-responding"
  alarm_description   = "The server's operating system is not responding. Check it with SSM; reboot if needed."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = { Component = "alerts" }
}

resource "aws_cloudwatch_metric_alarm" "cpu_credits" {
  alarm_name          = "${var.name}-cpu-credits-low"
  alarm_description   = "CPU credits have been nearly empty for a full hour, so the server runs throttled. Image builds during a deploy use credits briefly (that is normal); a whole hour is not. Consider a bigger size."
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 12
  threshold           = 20
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = { Component = "alerts" }
}

# Disk and memory come from the CloudWatch agent on the server (namespace CloudArt/Server). "breaching" on missing data means
# that if the agent stops reporting, that is an alarm too, rather than silence.
resource "aws_cloudwatch_metric_alarm" "disk" {
  for_each            = { root = "/", data = "/data" }
  alarm_name          = "${var.name}-disk-${each.key}-full"
  alarm_description   = "The ${each.value} disk is over 80% full (a full disk stops the database)."
  namespace           = "CloudArt/Server"
  metric_name         = "disk_used_percent"
  dimensions          = { InstanceId = var.instance_id, path = each.value, fstype = "xfs" }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = { Component = "alerts" }
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  alarm_name          = "${var.name}-memory-high"
  alarm_description   = "Memory use is over 90%."
  namespace           = "CloudArt/Server"
  metric_name         = "mem_used_percent"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = { Component = "alerts" }
}

# A nightly database dump that did not happen is an alarm: the backup script sends BackupSuccess=1 after each upload.
resource "aws_cloudwatch_metric_alarm" "backup" {
  alarm_name          = "${var.name}-backup-missing"
  alarm_description   = "No successful database backup in the last 26 hours."
  namespace           = "CloudArt/Server"
  metric_name         = "BackupSuccess"
  dimensions          = { InstanceId = var.instance_id }
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = { Component = "alerts" }
}

# Server errors: the API writes one JSON line per request; count the ones with a 5xx status.
resource "aws_cloudwatch_log_metric_filter" "errors_5xx" {
  name           = "${var.name}-api-5xx"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.status >= 500 }"

  metric_transformation {
    name          = "Api5xx"
    namespace     = "CloudArt/Server"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "errors_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "The API answered with 5 or more server errors in 5 minutes."
  namespace           = "CloudArt/Server"
  metric_name         = "Api5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = { Component = "alerts" }
}
