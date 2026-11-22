# CloudArt — AWS resources

Account: `589531223229` · Region: **ap-south-1 (Mumbai)** (CloudFront is global)

Every resource created for CloudArt carries these tags:

| Tag | Value |
| --- | --- |
| `Project` | `CloudArt` |
| `Environment` | `prod` for production, `dev` for the development Cognito pool |
| `Component` | the part it belongs to (`network`, `server`, `database-disk`, `uploads`, `backups`, `site`, `auth`, `cdn`, `settings`, `alerts`, `backups`, `logs`, `terraform-state`) |
| `ManagedBy` | `ClaudeCode` |

Production is created by Terraform (the provider's `default_tags` add the first three tags to every resource, each resource adds `Component`).
The story of how it was built, and every error on the way, is in [`deployment-log.md`](deployment-log.md); the code is in `deploy/terraform`.

## Production (Terraform, 64 resources in 7 modules + 1 hand-made bucket)

| Module | Resources | Names / ids |
| --- | --- | --- |
| *(by hand)* | Terraform state bucket | `cloudart-prod-tfstate-589531223229` (private, encrypted, versioned) |
| `network` | VPC `10.20.0.0/16`, 2 public subnets, internet gateway, route table + default route, free S3 gateway endpoint, emptied default security group, **API security group** (port 80 from the CloudFront prefix list only) | `cloudart-prod-vpc`, `cloudart-prod-api` |
| `storage` | 3 private S3 buckets: **uploads** (versioned, 30-day old-version expiry), **backups** (`db/` 30 days, `artifacts/` 14 days), **site**; each with public-access block, SSE-S3 encryption, ACLs off, HTTPS-only policy | `cloudart-prod-{uploads,backups,site}-589531223229` |
| `auth` | Cognito user pool (deletion protection ON, e-mail sign-in, custom attributes `organization`, `prof_category`) and its app client (no secret) | pool `ap-south-1_MM2gQmNkS`, client `52mqqloarq51ujje31tqcvaoo` |
| `server` | EC2 `t4g.small` (Amazon Linux 2023 ARM, IMDSv2 only, hop limit 2, CPU credits `standard`, termination protection, no key pair), Elastic IP, encrypted 16 GB root + 20 GB **data disk** (`prevent_destroy`, tagged `Snapshot=daily`), IAM role + policy + instance profile | `i-0bfc411e093297906`, `13.233.62.38`, role `cloudart-prod-server` |
| `cdn` | CloudFront distribution (site from S3, `/api/*` to the server), origin access control, SPA routing function, security-headers policy (HSTS, nosniff, frame deny, referrer, permissions, CSP report-only), the secret origin header, site-bucket read policy | `E3QTN2LXUF87HH`, `d1b8136dpy9xwv.cloudfront.net` |
| `settings` | generated database password, SSM SecureString holding `.env.prod` | `/cloudart/prod/env` |
| `operations` | SNS topic + policy, monthly budget (25 USD, tag-filtered), CloudWatch log group (30 days), daily snapshot policy + role (keep 7), 8 alarms, 5xx log filter | `cloudart-prod-alerts`, `/cloudart/prod/api` |

Also changed in the account (not a resource): the cost-allocation tag **`Project` was activated** (needed for the budget filter).

## Development (older, created before Terraform)

| Resource | Name / ID | Tagged | Notes |
| --- | --- | --- | --- |
| Cognito User Pool | `cloudart-dev-users` · `ap-south-1_KXQljZJGU` | Yes (4 tags, `Environment=dev`) | used by local development and the automated tests; deletion protection off |
| Cognito App Client | `cloudart-dev-web` · `49dh9ld22gg5kvoq84i9vrk77a` | n/a (inherits) | no secret |

## Not CloudArt (do not touch)

The account also hosts other projects (a portfolio, foodloop, cloudfix, LankaResilience, their budgets and IAM users). CloudArt's scripts only ever
act on resources named `cloudart-prod-…`.

## Check the tags

```bash
aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=CloudArt \
  --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n'
```

## Cost (estimate, Mumbai, low traffic)

Server t4g.small 8.2 · disks (16 + 20 GB gp3) 3.3 · snapshots ≈0.5 · public IPv4 3.7 · CloudFront/S3/logs/alarms ≈1 → **about 16 USD a month**.
A budget alert is set at 25 USD. If the CPU-credit alarm stays on for days, move to `t4g.medium` (about +8 USD).

## Remove everything

See the *Teardown* section of [`deployment-log.md`](deployment-log.md) (two deliberate steps because of the protections; the dev pool is separate).
