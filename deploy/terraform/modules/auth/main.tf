# Login: a Cognito user pool for the production site, separate from the development pool so real students never mix with
# automated test accounts. The settings copy the dev pool (read with `aws cognito-idp describe-user-pool`) plus deletion protection.

resource "aws_cognito_user_pool" "main" {
  name                     = "${var.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = var.deletion_protection
  user_pool_tier           = "ESSENTIALS"

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false # students register themselves
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # Cognito's own e-mail sender (about 50 a day). Switch to Amazon SES once there is a domain and SES is out of sandbox.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your CloudArt verification code"
    email_message        = "Welcome to CloudArt! Your verification code is {####}"
  }

  # The two custom attributes the API sends at sign-up. Cognito attributes can never be removed once created.
  schema {
    name                = "organization"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 200
    }
  }
  schema {
    name                = "prof_category"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 50
    }
  }

  tags = { Component = "auth" }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret               = false # a browser app cannot keep a secret
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED" # login errors do not reveal whether an e-mail is registered
  access_token_validity         = 60
  id_token_validity             = 60
  refresh_token_validity        = 30
  enable_token_revocation       = true

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
