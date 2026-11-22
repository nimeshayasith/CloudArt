# The server (Option A): API + PostgreSQL in Docker on one EC2 machine, with its permissions, its fixed address and a
# separate database disk.

# ── Permissions ──────────────────────────────────────────────────────────────────────────────────────────────
# The server never holds access keys. It has an IAM ROLE; the AWS SDK inside the API container obtains short-lived credentials
# for it automatically. The role can do only what the application needs (least privilege).

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
    resources = ["${var.uploads_bucket_arn}/payments/*", "${var.uploads_bucket_arn}/requests/*"]
  }

  # Backups (write dumps, read them back for a restore) and the shipped application archives (read).
  statement {
    sid       = "BackupsReadWrite"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.backups_bucket_arn}/db/*", "${var.backups_bucket_arn}/artifacts/*"]
  }
  statement {
    sid       = "BackupsList"
    actions   = ["s3:ListBucket"]
    resources = [var.backups_bucket_arn]
  }

  # The one SSM parameter that holds the server's settings (including secrets).
  statement {
    sid       = "ReadOwnSettings"
    actions   = ["ssm:GetParameter"]
    resources = [var.settings_parameter_arn]
  }

  # Docker's awslogs driver and the log files.
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${var.log_group_arn}:*"]
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

# ── The machine ───────────────────────────────────────────────────────────────────────────────────────────────

# Always start from the current patched Amazon Linux 2023 (ARM) image, found through AWS's public SSM parameter.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# A fixed public address, so the CloudFront origin never changes when the server is stopped and started.
resource "aws_eip" "api" {
  domain = "vpc"
  tags   = { Name = "${var.name}-api", Component = "server" }
}

# The database disk is SEPARATE from the system disk: the server can be rebuilt without touching the data, and the disk is
# snapshotted daily (the operations module's lifecycle policy looks for the snapshot tag).
resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = merge({ Name = "${var.name}-data", Component = "database-disk" }, var.snapshot_tag)

  lifecycle {
    prevent_destroy = true # a mistaken "terraform destroy" must not delete the database; see Teardown in the deployment log
  }
}

resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids
  iam_instance_profile   = aws_iam_instance_profile.server.name

  # No SSH key pair on purpose: access is by SSM Session Manager (logged, no open port).
  user_data = replace(templatefile("${path.module}/templates/userdata.sh.tftpl", {
    region         = var.region
    data_volume_id = replace(aws_ebs_volume.data.id, "-", "")
  }), "\r", "")

  # "standard" = when CPU credits run out the machine slows down instead of charging for extra bursts (no surprise bill).
  credit_specification {
    cpu_credits = "standard"
  }

  # IMDSv2 only (blocks the classic SSRF credential theft). Hop limit 2 is REQUIRED: the API runs inside a Docker container,
  # which is one network hop further away, and with the default of 1 the container could not get its S3 credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
    tags                  = { Name = "${var.name}-root", Component = "server" }
  }

  disable_api_termination = true # needs two deliberate steps to delete the server

  tags = { Name = "${var.name}-api", Component = "server" }

  lifecycle {
    # A newer AMI or an edited start-up script must NOT rebuild a server that holds the database.
    # The OS is patched in place (dnf-automatic); changes to the script are applied by hand (see the deployment log).
    ignore_changes = [ami, user_data]
  }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.api.id
  stop_instance_before_detaching = true
}

resource "aws_eip_association" "api" {
  instance_id   = aws_instance.api.id
  allocation_id = aws_eip.api.id
}
