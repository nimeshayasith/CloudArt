# ── S3 BUCKETS ─────────────────────────────────────────────────────────────────────────────────────────────
#  uploads  payment screenshots and client files. Private; only the server's role can read/write.
#  backups  database dumps (db/) and the shipped application archives (artifacts/).
#  site     the React build. Private; only our CloudFront distribution can read it.
# All of them: every kind of public access blocked, encrypted at rest, HTTPS-only.

locals {
  buckets = {
    uploads = "${var.name}-uploads-${local.account_id}"
    backups = "${var.name}-backups-${local.account_id}"
    site    = "${var.name}-site-${local.account_id}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value
  tags     = { Component = each.key }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced" # turns object ACLs off completely
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Uploads are versioned: a bug or a mistaken delete can be undone. Old versions are removed after 30 days.
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.this["uploads"].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket     = aws_s3_bucket.this["uploads"].id
  depends_on = [aws_s3_bucket_versioning.uploads]
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.this["backups"].id
  rule {
    id     = "expire-database-dumps"
    status = "Enabled"
    filter {
      prefix = "db/"
    }
    expiration {
      days = 30
    }
  }
  rule {
    id     = "expire-shipped-archives"
    status = "Enabled"
    filter {
      prefix = "artifacts/"
    }
    expiration {
      days = 14
    }
  }
  rule {
    id     = "abort-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.this["site"].id
  rule {
    id     = "abort-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# HTTPS-only policy for the private buckets.
data "aws_iam_policy_document" "tls_only" {
  for_each = toset(["uploads", "backups"])
  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "private" {
  for_each   = data.aws_iam_policy_document.tls_only
  bucket     = aws_s3_bucket.this[each.key].id
  policy     = each.value.json
  depends_on = [aws_s3_bucket_public_access_block.this]
}

# The site bucket: HTTPS-only, and readable ONLY by our CloudFront distribution (through Origin Access Control).
data "aws_iam_policy_document" "site" {
  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this["site"].arn, "${aws_s3_bucket.this["site"].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid       = "ReadOnlyFromOurCloudFront"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this["site"].arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.this["site"].id
  policy     = data.aws_iam_policy_document.site.json
  depends_on = [aws_s3_bucket_public_access_block.this]
}
