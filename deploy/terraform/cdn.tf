# ── CLOUDFRONT: one HTTPS address for the website AND the API ───────────────────────────────────────────────
#   /api/*   → the EC2 server (never cached; every header, including Authorization and X-File-Name, is forwarded)
#   anything else → the private S3 bucket holding the React build
# One address for both means no CORS and no domain name are needed to go live.

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Sends all of the visitor's headers to the origin except Host (which must be the origin's own name).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# Origin Access Control: CloudFront signs its requests to S3, so the bucket can stay completely private.
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name}-site"
  description                       = "CloudFront to the private site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Single-page-app routing. A path with no file extension (/services/123) is a page of the React app, so it is answered with
# index.html; files (/assets/app.js) are served as they are. A function is used instead of CloudFront "custom error pages",
# because error pages would also turn the API's real JSON 404 answers into the website page.
resource "aws_cloudfront_function" "spa" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for React routes"
  publish = true
  code    = file("${path.module}/templates/spa-rewrite.js")
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name    = "${var.name}-site-headers"
  comment = "Security headers for the website"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=()"
      override = true
    }
    # REPORT-ONLY first: the browser logs anything the policy would block but blocks nothing, so a mistake cannot break the site.
    # It is switched to an enforcing Content-Security-Policy after the smoke test shows no violations (see the deployment log).
    items {
      header   = "Content-Security-Policy-Report-Only"
      value    = "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://i.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = var.cloudfront_price_class
  default_root_object = "index.html"
  comment             = "CloudArt production"

  # Origin 1: the website files in the private bucket.
  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.this["site"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Origin 2: the API server. CloudFront-to-server traffic is plain HTTP on port 80 inside AWS (the visitor's connection is
  # HTTPS); a custom CloudFront domain cannot present a certificate for an EC2 name. The secret header proves a request came
  # through THIS distribution: the security group already limits the port to CloudFront, and the API refuses requests without it.
  origin {
    origin_id   = "api"
    domain_name = local.api_origin_dns

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin.result
    }
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = false
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true # the *.cloudfront.net certificate; a custom domain would need its own
  }

  tags = { Component = "cdn" }
}
