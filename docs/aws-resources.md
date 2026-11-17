# CloudArt — AWS resources

Account: `589531223229` · Region: **ap-south-1 (Mumbai)**

Every resource created for CloudArt carries these tags:

| Tag | Value |
| --- | --- |
| `Project` | `CloudArt` |
| `Environment` | `dev` |
| `Component` | `auth` (use the component name for future resources) |
| `ManagedBy` | `ClaudeCode` |

## Inventory

| Resource | Name / ID | Tagged | Notes |
| --- | --- | --- | --- |
| Cognito User Pool | `cloudart-dev-users` · `ap-south-1_KXQljZJGU` | Yes (all 4 tags) | Email sign-in, email verification by code, password policy 8+ with upper/lower/number/symbol, deletion protection off (dev) |
| Cognito App Client | `cloudart-dev-web` · `49dh9ld22gg5kvoq84i9vrk77a` | n/a — app clients are not taggable; inherits from the pool | No secret, `USER_PASSWORD_AUTH` + refresh, user-existence errors suppressed |

Custom user attributes: `custom:organization`, `custom:prof_category` (Cognito attributes cannot be removed once created).

IDs are not secrets (they are visible in any browser calling Cognito). No IAM users, keys or other resources were created.

## Check the tags

```bash
aws cognito-idp list-tags-for-resource --region ap-south-1 \
  --resource-arn arn:aws:cognito-idp:ap-south-1:589531223229:userpool/ap-south-1_KXQljZJGU
```

## Remove everything (dev)

```bash
aws cognito-idp delete-user-pool --region ap-south-1 --user-pool-id ap-south-1_KXQljZJGU
```

## Notes

- Cognito's built-in email sender is limited (about 50 emails/day) — fine for development; switch to Amazon SES before launch.
- Automated tests use the SES mailbox-simulator address `success+<tag>@simulator.amazonses.com` and delete their users afterwards.
