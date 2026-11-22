# CloudArt infrastructure (Terraform)

Everything CloudArt runs on in AWS, described as code. Layout follows the usual Terraform conventions: small **modules** that
each do one job, and an **environment** that wires them together.

```
deploy/terraform/
├── environments/
│   └── prod/              the production environment: provider, remote state, module wiring, outputs
│       ├── versions.tf    Terraform + provider versions, the S3 backend, the mandatory tags (default_tags)
│       ├── variables.tf   the few knobs (server size, budget, e-mails, ...)
│       ├── main.tf        the ONLY place that connects modules to each other
│       ├── outputs.tf     what the deploy scripts read (site URL, bucket names, instance id, ...)
│       ├── moved.tf       history of the flat -> modules refactor (see below)
│       └── .terraform.lock.hcl   exact provider versions (committed on purpose)
└── modules/
    ├── network/           VPC, subnets, internet gateway, S3 endpoint, the API security group
    ├── storage/           the three private S3 buckets (uploads, backups, site) with encryption, versioning, lifecycle
    ├── auth/              the production Cognito user pool and its app client
    ├── server/            the EC2 server, its IAM role, Elastic IP and database disk
    ├── cdn/               CloudFront (site + /api), its security headers, the SPA function, the site-bucket policy
    ├── settings/          generated passwords and the encrypted SSM parameter the server reads (.env.prod)
    └── operations/        alert topic, budget, log group, daily snapshots, alarms
```

## How the modules connect

```
network ──► server ◄── storage (bucket ARNs)         operations ──► server (log group ARN)
   │           │  ▲                                       ▲
   │           ▼  └── settings (parameter ARN)            └── watches the server (alarms)
   │         cdn  ◄── storage (site bucket) , server (DNS name)
   └─ security group                  │
                    auth ─────────────┴──► settings (Cognito ids), cdn ──► settings (site address, origin secret)
```

There are no circular dependencies at the resource level (Terraform would refuse them): `server` needs only the settings
parameter's *ARN* for its permissions; `settings` needs values from `cdn` and `auth`; `cdn` needs only the server's public DNS name.

## Conventions used (and why)

| Convention | Why |
| --- | --- |
| One job per module, a small interface (`variables.tf` in, `outputs.tf` out) | easy to read, test and reuse; a change stays inside one module |
| Every variable has a `description` and a `type`; risky ones have a `validation` block | wrong values fail at `plan`, with a clear message, not half-way through an apply |
| Modules declare `required_providers` but never configure a provider | the environment decides region and credentials; modules stay reusable |
| Tags come from the provider's `default_tags`; each resource adds only `Component` | the four mandatory tags can never be forgotten |
| Secrets are `sensitive` and generated, never typed; state is a private, encrypted, versioned S3 bucket with native locking | no secret in git; no DynamoDB table needed |
| `prevent_destroy` on the database disk, `disable_api_termination` on the server, `deletion_protection` on Cognito | a mistaken `destroy` cannot delete data; teardown is deliberate (see the deployment log) |
| `lifecycle.ignore_changes = [ami, user_data]` on the server | a new AMI or an edited boot script must never rebuild the machine that holds the database |
| Provider lock file is committed | everyone gets the same provider versions |
| `moved` blocks for refactors | restructuring the code does not touch real infrastructure |

## Everyday commands

Use the wrapper (it sets PATH and UTF-8 and runs from the right folder):

```bash
deploy/aws/tf.sh plan        # what would change? (changes nothing)
deploy/aws/tf.sh apply       # make the change (asks first)
deploy/aws/tf.sh check       # format + validate + "no drift" check
```

Variables you may change are in `environments/prod/variables.tf`. Put personal values (an alert e-mail, the admin e-mail) in
`environments/prod/terraform.tfvars` (git-ignored; start from `terraform.tfvars.example`).

## The refactor from flat files to modules

The infrastructure was first built from one flat folder. It was then split into these modules **without touching AWS**:
each existing resource got a `moved` block (`environments/prod/moved.tf`) so Terraform treated it as the same object at a new
address. The proof: the plan after the refactor said *0 to add, 0 to change, 0 to destroy*, the server kept its instance id and
IP address, and the follow-up plan was empty. The details are in `docs/deployment-log.md` (Stage 10).
