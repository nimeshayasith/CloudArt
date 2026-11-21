# ── THE SERVER (Option A: API + PostgreSQL in Docker on one EC2 machine) ───────────────────────────────────

# Always start from the current patched Amazon Linux 2023 (ARM) image, found through AWS's public SSM parameter.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# A fixed public address, so the CloudFront origin never changes when the server is stopped and started.
resource "aws_eip" "api" {
  domain = "vpc"
  tags   = { Name = "${var.name}-api", Component = "server" }
}

# The database disk is SEPARATE from the system disk: the server can be rebuilt without touching the data, and the
# disk is snapshotted daily (tag Snapshot=daily is what the lifecycle policy in ops.tf looks for).
resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public[0].availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.name}-data", Component = "database-disk", Snapshot = "daily" }

  lifecycle {
    prevent_destroy = true # a mistaken "terraform destroy" must not delete the database; see Teardown in the deployment log
  }
}

resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.api.id]
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

  depends_on = [aws_internet_gateway.main]

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

locals {
  # CloudFront needs a DNS NAME for the origin, not an IP. For an Elastic IP the name is fixed by AWS's naming rule.
  api_origin_dns = "ec2-${replace(aws_eip.api.public_ip, ".", "-")}.${var.region}.compute.amazonaws.com"
}
