# CloudArt — deployment options compared

Written 2026-11-21 for Phase 12. **Chosen: Option A** (one EC2 server), and it is now **deployed**: see `deployment-log.md` for
the step-by-step record, `deploy/terraform/README.md` for the code, and `aws-resources.md` for the inventory. The other options stay here
as study material and as upgrade paths. Two facts changed after this was written: the account is on the **Paid** plan (not the Free
Plan), and the container image is built **on the server** instead of being pulled from ECR (the ECR API is unreachable from the developer PC).

## Facts about the AWS account (checked 2026-11-20)

- The account is on the **AWS Free Plan**: about **125 USD of credits** left, and the plan **ends on 2027-03-10**. The account must be
  upgraded to the Paid plan before then or it closes. Only the owner can do the upgrade (Billing console).
- The account already hosts other projects (portfolio, foodloop, cloudfix, LankaResilience). CloudArt resources stay separate and tagged.
- No domain yet. Amazon SES is in **sandbox** (it can only send to verified addresses) with no verified identity.
- The AWS CLI uses the **root** access keys. Before deploying, create an admin IAM user with MFA and stop using root for daily work.
- App Runner is not enabled on the account (it returns a subscription error), so it is not an option.
- Prices below are for Mumbai (ap-south-1), taken from the AWS Pricing API (Lightsail and RDS instance prices are approximate).
  A **public IPv4 address costs 3.65 USD a month** each since 2024, which matters for the small designs.

## What every option shares

| Part | Design |
| --- | --- |
| Frontend | The React build in a private **S3** bucket behind **CloudFront**. One CloudFront address serves the site and forwards `/api/*` to the API, so there is no CORS and no domain is needed. |
| Files | A private S3 bucket for payment screenshots and request files (`payments/…`, `requests/…`), reached with the server's IAM role and never public. |
| Login | A **new production Cognito pool** (deletion protection on, same custom attributes). Cognito's built-in email (about 50 a day) until you own a domain; SES afterwards. |
| Database | PostgreSQL 16. Where it runs is the main difference between the options. Migrations run with `prisma migrate deploy`. |

## The options compared

Monthly cost at low traffic (730 hours a month).

| | **A. One EC2 server (API + Postgres in Docker)** | **A2. EC2 + RDS** | **B. Lightsail server** | **C. Serverless (Lambda + free external Postgres)** | **D. ECS Fargate + load balancer + RDS** |
| --- | --- | --- | --- | --- | --- |
| Estimated cost | **≈12 USD** (t4g.micro 4.09, disks 2.74, IPv4 3.65, snapshots and CloudFront ≈1.5). A t4g.small is ≈16 | ≈27 USD (RDS ≈15, storage 2.6, plus the server) | ≈8 USD (plan ≈7, approx.) | ≈0–1 USD | **≈60 USD** (load balancer 17, its two IPs 7.3, Fargate 10.6, task IP 3.65, RDS ≈15, storage and logs) |
| Credit runway (125 USD) | ~10 months, but the plan ends in 3.7 | ~4.5 months | ~15 months | not an issue | **~2 months** |
| Who patches and recovers | You: OS updates, Docker, database upgrades. A failed server means downtime until rebuilt | You patch the OS; AWS runs and backs up the database | You, as for A | AWS (Lambda), and the external database vendor | AWS. Nothing to patch |
| Database safety | Daily disk snapshots plus a nightly `pg_dump` to S3. The weakest option: restores are by hand | RDS automated backups, point-in-time restore, encryption | As A | Vendor free tier (0.5 GB, auto-suspends). Vendor terms can change | RDS backups. Multi-AZ optional (+15 USD) |
| Security | Good: no SSH (Session Manager), only CloudFront can reach port 80, server role for S3, secrets in SSM Parameter Store. One box holds app and data | Better: the database sits in a private subnet | **Weaker:** Lightsail servers cannot use AWS roles, so S3 needs a stored access key | Data outside AWS. No VPC, so the database is protected by password and TLS only | Best: private subnets, chained security groups, roles everywhere |
| Availability | Single point of failure (minutes to hours to rebuild) | Same for the app server | As A | Highly available app. Database cold start 0.5–1 s | Self-healing, easy to run two copies |
| Performance | Fast (database on the same machine) | Good | Fast | Slower: Lambda cold starts of 1–2 s, database in Singapore ≈60 ms per query | Good |
| Code changes | Small: S3 file storage, proxy setting, Docker image | Same as A | Same, plus key handling | **Large:** uploads straight to S3 (Lambda's 6 MB body limit vs our 10 MB files), rate limits moved to the database (in-memory limits break across instances), Lambda wrapper | Same as A |
| Effort for you | Medium: about 10 manual stages | Medium+ | Medium | Medium, plus the code work | Highest: VPC, load balancer, ECS, RDS, roles, ECR |
| AWS skills shown | EC2, EBS, IAM roles, SSM, CloudFront, S3, Cognito | + RDS, VPC design | Fewer (Lightsail is a simplified layer) | Lambda, CloudFront, S3 | The most: ECS, ALB, RDS, VPC, IAM |
| Growing later | Move the database to RDS with `pg_dump`, and the **same Docker image** moves to Fargate. No rewrite | Direct path to D | Move to A or D | Harder: leaving Lambda means undoing the upload and rate-limit design | Already there |
| Main risk | Your own admin mistakes; a full disk | Cost creep | Key leakage; skills do not transfer | Vendor limits; surprise latency | Cost, complexity, credits running out |

### Short verdicts

- **A** is the cheapest option that is still properly AWS. Best for learning plus a small live site. Its weak point is that it is one machine.
- **A2** buys safer data for about 15 USD more. Worth it once real students depend on the site.
- **B** saves about 4 USD over A but gives up security and skills. Not recommended.
- **C** is almost free but is a different application design and keeps your data outside AWS. Best only if cost is the single goal.
- **D** is the "real company" design and the best one to study, but at ≈60 USD it spends the credits in about two months.
  Better as a later upgrade or a short, time-boxed exercise that you tear down.

### Decision

**Option A, on a t4g.small (≈16 USD, 2 GB memory) or a t4g.micro (≈12 USD, 1 GB, with swap).** The API ships as a Docker image, so
moving to A2 or D later is a data move rather than a rewrite.

## Option A layout

```
Visitor ─► CloudFront (HTTPS, one address)
             ├─ /            ─► S3 bucket (React build, private, read through Origin Access Control)
             └─ /api/*       ─► EC2 server, port 80 (only CloudFront can connect; header X-Origin-Verify checked by the API)
                                 ├─ container "api"  (Node, the image from the private ECR repository)
                                 └─ container "db"   (PostgreSQL, data on a separate EBS disk, no published port)
EC2 server role ─► S3 uploads bucket (private), CloudWatch Logs, SSM, ECR pull
Backups: daily EBS snapshots + nightly pg_dump to S3
Login: production Cognito pool
```

## Things the code needed for production (done in Phase 12)

| Need | What was added |
| --- | --- |
| Files must not live on the server disk | `backend/src/shared/storage.js` has an **S3 driver** (`STORAGE_DRIVER=s3`) with the same `save/read/remove` interface, encrypted objects and no overwrite. Production refuses to start with the local driver |
| Rate limits identify users by IP | `TRUST_PROXY` makes Express use the visitor address CloudFront adds. Spoofed `X-Forwarded-For` entries are ignored. Production refuses to start without it |
| Anyone with a CloudFront distribution could reach the server's address | `ORIGIN_VERIFY_SECRET`: requests without the secret `X-Origin-Verify` header get 403 (the plain liveness check stays open for Docker) |
| Prisma CLI was a dev dependency | `prisma` is now a production dependency (with `effect` pinned to a patched version) so the image can run migrations |
| No container image | `backend/Dockerfile`: multi-stage, non-root user, health check, arm64 and x86 |
| No server logs | `accessLog` writes one JSON line per request (method, path, status, time, address; never the query, headers, bodies or user) |
| Database encryption | `DB_SSL=off|require|verify` for later use with RDS |
| Start-up mistakes | One readable error lists every misconfigured setting (`parseEnv`) |

## Pitfalls for the rest of the work

1. **CloudFront custom error pages turn API 404s into the website page.** Use a small CloudFront Function for the single-page-app
   fallback instead of error responses.
2. **Uploads** carry an `X-File-Name` header and bodies up to 10 MB: forward all viewer headers on `/api/*`, with caching off.
3. **The YouTube player** needs a Content-Security-Policy that allows `youtube-nocookie.com` frames and the YouTube script. Start in report-only mode.
4. **Admin bootstrap order:** run the seed with `ADMIN_EMAIL`, then register that same email in the app; the first login links the admin row.
5. **Browser tests use the local Docker database**, so a production smoke test must use only the API and Cognito.
6. **Email:** SES stays in sandbox until you have a domain and request production access. Sign-ups use Cognito's own sender until then.
7. **The disk on a one-server design is the single most important thing to watch**: alarm on free space, and keep Docker's logs rotated (the compose file does).

## The manual walkthrough (stages)

Each stage is done by you and checked by me with read-only commands. The runbook for each stage is written when we reach it.

0. Safety: root MFA, an admin IAM user, a billing budget alert, check what the Free Plan allows, plan the upgrade to Paid.
1. Names and tags (`Project=CloudArt`, `Environment=prod`, `Component=<name>`, `ManagedBy=Manual`).
2. S3 buckets (uploads private, frontend private behind CloudFront), TLS-only policies.
3. Production Cognito pool and app client.
4. The EC2 server: network, security group, IAM role, Session Manager, Docker, data disk.
5. Build and ship the image (private ECR), run migrations, seed the categories and the admin.
6. CloudFront: two origins, the `/api/*` behaviour, the single-page-app function, security headers.
7. Build and upload the frontend; cache invalidation.
8. Smoke test: health, sign-up, a request, an upload to S3 and download, the rate limit, deep-link reload, API 404 stays JSON.
9. Backups, alarms, budget, and a restore drill.
10. Upgrade to the Paid plan; final inventory and teardown commands in `docs/aws-resources.md`.
