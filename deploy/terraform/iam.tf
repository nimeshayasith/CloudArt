# ── SERVER PERMISSIONS ─────────────────────────────────────────────────────────────────────────────────────
# The server never holds access keys. It has an IAM ROLE; the AWS SDK inside the API container obtains short-lived
# credentials for it automatically. The role can do only what the application needs (least privilege).

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server" {
  name               = "${var.name}-server"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = { Component = "server" }
}

# SSM Session Manager and Run Command: how we reach the server without SSH or open ports.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "server" {
  # The API stores and serves uploaded files, only under the two folders it uses.
  statement {
    sid       = "UploadsReadWrite"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.this["uploads"].arn}/payments/*", "${aws_s3_bucket.this["uploads"].arn}/requests/*"]
  }

  # Backups (write dumps, read them back for a restore) and the shipped application archives (read).
  statement {
    sid       = "BackupsReadWrite"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.this["backups"].arn}/db/*", "${aws_s3_bucket.this["backups"].arn}/artifacts/*"]
  }
  statement {
    sid       = "BackupsList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.this["backups"].arn]
  }

  # The one SSM parameter that holds the server's settings (including secrets).
  statement {
    sid       = "ReadOwnSettings"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.env.arn]
  }

  # Docker's awslogs driver and the log files.
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  # Disk, memory and "backup succeeded" numbers, only in our own namespace.
  statement {
    sid       = "PublishOwnMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["CloudArt/Server"]
    }
  }
}

resource "aws_iam_role_policy" "server" {
  name   = "${var.name}-server"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server.json
}

resource "aws_iam_instance_profile" "server" {
  name = "${var.name}-server"
  role = aws_iam_role.server.name
  tags = { Component = "server" }
}
