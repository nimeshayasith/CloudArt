variable "name" {
  description = "Prefix for resource names (for example cloudart-prod)."
  type        = string
}

variable "site_bucket_id" {
  description = "Id (name) of the private bucket that holds the website."
  type        = string
}

variable "site_bucket_arn" {
  description = "ARN of the website bucket."
  type        = string
}

variable "site_bucket_regional_domain_name" {
  description = "Regional domain name of the website bucket (the S3 origin)."
  type        = string
}

variable "api_origin_domain" {
  description = "DNS name of the API server (an EC2 public DNS name; CloudFront cannot use a bare IP address)."
  type        = string
}

variable "price_class" {
  description = "PriceClass_All includes India and the rest of Asia; PriceClass_100 does not."
  type        = string
  default     = "PriceClass_All"

  validation {
    condition     = contains(["PriceClass_All", "PriceClass_200", "PriceClass_100"], var.price_class)
    error_message = "price_class must be PriceClass_All, PriceClass_200 or PriceClass_100."
  }
}

variable "csp_mode" {
  description = "\"report-only\" logs Content-Security-Policy violations without blocking anything; \"enforce\" blocks them."
  type        = string
  default     = "report-only"

  validation {
    condition     = contains(["report-only", "enforce"], var.csp_mode)
    error_message = "csp_mode must be report-only or enforce."
  }
}

variable "content_security_policy" {
  description = "The Content-Security-Policy for the website. Allows YouTube (player script and frames) and Google Fonts."
  type        = string
  default     = "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://i.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
}
