# Which Terraform and which providers (plugins) this code needs, and where Terraform keeps its state.
terraform {
  required_version = ">= 1.10" # 1.10+ can lock the state with a plain S3 file, so no DynamoDB table is needed

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # The state file records what Terraform built and contains generated passwords, so it lives in a private,
  # encrypted, versioned bucket (created by deploy/aws/01-bootstrap-state.sh, the one thing Terraform cannot make for itself).
  backend "s3" {
    bucket       = "cloudart-prod-tfstate-589531223229"
    key          = "prod/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  # The mandatory tags are applied to EVERY resource automatically. Each resource adds its own "Component" tag.
  default_tags {
    tags = {
      Project     = "CloudArt"
      Environment = "prod"
      ManagedBy   = "ClaudeCode"
    }
  }
}
