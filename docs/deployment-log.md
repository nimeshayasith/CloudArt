# CloudArt — production deployment log (Option A)

**Purpose.** A step-by-step record of how CloudArt was put on AWS, written so you can *reverse-engineer* it: for every step you get
**what** was done, **why** it was done that way, the **exact commands** (they live in re-runnable scripts under
[`deploy/aws/`](../deploy/aws/)), what the **result** was, how it was **verified**, how to **undo** it, and every **error** met on
the way with its fix. The design and the comparison with other options are in [`deployment-options.md`](deployment-options.md);
the resource inventory and teardown are in [`aws-resources.md`](aws-resources.md).

**How to read it.** Stages are in the order they were done. Each ends with "Verify" and "Undo". Section *Errors and fixes* collects
every problem (E1, E2, …). Section *Risks and decisions* lists choices that carry a trade-off (R1, R2, …). No secret appears
here: passwords and the origin secret are generated on the fly and stored only in SSM Parameter Store (encrypted).

**Conventions**

| Item | Value | Why |
| --- | --- | --- |
| Region | `ap-south-1` (Mumbai) | closest to the users; Cognito already there |
| Name prefix | `cloudart-prod-…` | one prefix makes everything easy to find and delete |
| Tags on every resource | `Project=CloudArt`, `Environment=prod`, `Component=<part>`, `ManagedBy=ClaudeCode` | your standing rule; `Environment` is `prod` here because the dev Cognito pool already used `dev`; `ManagedBy` stays `ClaudeCode` because the AWS CLI calls were made by Claude |
| Scripts | `deploy/aws/NN-name.sh`, all start with `source lib.sh` | repeatable; each one looks a resource up before creating it, so re-running is safe |
| Shell | Git Bash with `MSYS_NO_PATHCONV=1` | see error E2 |

---

## Risks and decisions

| # | Item | Decision and why |
| --- | --- | --- |
| R1 | **The AWS CLI uses the account's root access keys** | Everything was done with them because you asked me to continue with the CLI access you have. Root can do anything and cannot be limited. **Your action after deployment:** create an admin IAM user with MFA, switch the CLI to it, then deactivate and delete the root access keys in the console (Security credentials). The EC2 server itself never uses keys; it has a narrow IAM role. |
| R2 | **One server holds the API and the database** (Option A) | Cheapest properly-AWS design. The mitigations are in the Backups and Monitoring stages: daily disk snapshots, nightly dump to S3, alarms on disk and health. |
| R3 | **The account is now on the Paid plan with 0 credits** | The preflight showed `accountPlanType: PAID`. The Free Plan deadline (2027-03-10) no longer applies, but every resource now costs real money (about 16 USD a month for this design). A budget alert is created in Stage 1. |
| R4 | **The server builds its own image** instead of pulling from ECR | See error E1. Trade-off: builds use the server's CPU and disk for a minute or two; in return there is no registry to run or pay for, and the image is built natively for ARM. |

---

## Stage 0 — Preflight (read-only)

**What.** `deploy/aws/00-preflight.sh` checks who we are, the account plan, whether each AWS service we need answers, that the
instance type exists in the region, and finds the newest Amazon Linux 2023 ARM image.

**Why.** Earlier checks had shown RDS and ECR calls dropping, and App Runner disabled. Finding out which services work *before*
building avoids discovering it half-way.

**Result.**
- Identity: the account root user (risk R1).
- Plan: **PAID**, credits 0 (you had already upgraded; risk R3).
- Reachable: EC2, S3, SSM, IAM, CloudFront, CloudWatch (logs and metrics), SNS, DLM, Budgets, Cognito.
- **Not reachable: ECR** (error E1).
- `t4g.small` is offered (2 vCPU, 2 GiB). Image: `ami-09d0edabd3b722f64` (Amazon Linux 2023, arm64) via the public SSM parameter
  `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`; using the parameter at launch time means we always get the
  current patched image rather than a hard-coded old one.

**Verify / Undo.** Read-only; nothing to undo.

---

## Errors and fixes

| # | Stage | What happened | Cause | Fix |
| --- | --- | --- | --- | --- |
| E1 | 0 | `aws ecr describe-repositories` failed five times: "Connection was closed before we received a valid response". RDS did the same earlier. | The TLS handshake to the two AWS API addresses `13.234.9.96` (ECR API) and `13.234.9.93` (RDS API) never completes from this PC, while the TCP connection opens in 70 ms. `ec2.ap-south-1` (`13.200.93.194`) and the Docker registry host `589531223229.dkr.ecr…` answer normally. So it is the network path on the developer side (a middlebox dropping those addresses), not AWS. | Do not depend on ECR or RDS APIs from this PC. The server builds the Docker image itself from the shipped git archive (risk R4). RDS is not used in Option A; if it is needed later, create it from the console or from a different network. |
