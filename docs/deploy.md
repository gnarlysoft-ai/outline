# Deploying This Outline Fork to AWS

This fork ships a CloudFormation template at [`cfn/outline.yml`](../cfn/outline.yml)
that deploys Outline into your own AWS account using ECS Fargate, RDS
PostgreSQL, ElastiCache Redis, S3 for attachments, an ALB with ACM TLS, and a
Route 53 alias record.

You own the infrastructure, the data, and the domain end-to-end. This repo is
a free community fork — there is no SaaS layer, no vendor account, and no
recurring fee to anyone from using it.

---

## Prerequisites

1. **AWS account** where you have permission to create VPCs, IAM roles,
   Secrets Manager secrets, RDS instances, ElastiCache clusters, ECS
   services, and Route 53 records.
2. **A VPC with at least two public subnets** in different AZs. The stack
   does not create networking — it deploys into your existing VPC. (Using
   your account's default VPC is fine for small teams.)
3. **A Route 53 hosted zone** for the domain you want Outline at. For
   example, if you want `wiki.example.com`, you need a hosted zone for
   `example.com` (or any apex that contains `wiki.example.com`).
4. **A container image** of this fork published somewhere your AWS account
   can pull from. See [Container image](#container-image) below.
5. **SMTP credentials** for transactional email (magic-link sign-in,
   invitations). Any SMTP service works — AWS SES, Postmark, SendGrid,
   Mailgun, etc. You'll add these as env vars after deploy.
6. Optional but recommended: an **SSO provider** (Google, Azure/Entra, or
   generic OIDC). See the corresponding `docs/sso-*.md` file.

---

## Container image

The fork must be built and pushed to a registry your AWS account can pull
from. The simplest options:

### Option A — Push to your own ECR (recommended)

```bash
# In this repo
docker build -f Dockerfile.production -t outline:latest .

# Authenticate to your ECR, create the repo, and push
aws ecr create-repository --repository-name outline
aws ecr get-login-password --region <your-region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker tag outline:latest <account>.dkr.ecr.<region>.amazonaws.com/outline:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/outline:latest
```

Use `<account>.dkr.ecr.<region>.amazonaws.com/outline:latest` as the
`ContainerImage` CloudFormation parameter.

### Option B — Pull from the public Gnarlysoft image

If we've published a public image to GitHub Container Registry, you can
point `ContainerImage` at `ghcr.io/gnarlysoft-ai/outline:latest`. Verify the
tag exists before deploying — community images may lag behind this repo.

---

## Deploy

### Via the AWS Console

1. Navigate to **CloudFormation → Create stack → With new resources**.
2. Upload `cfn/outline.yml` from this repo.
3. Name the stack something like `outline-prod`.
4. Fill in the required parameters (see [Parameters](#parameters) below).
5. Check the IAM capabilities acknowledgement and create the stack.
6. Wait ~15–20 minutes for the RDS instance, ECS service, and ACM
   certificate validation to complete.

### Via the AWS CLI

```bash
aws cloudformation deploy \
  --template-file cfn/outline.yml \
  --stack-name outline-prod \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvName=prod \
    VpcId=vpc-xxxxxxxx \
    SubnetIds=subnet-aaaa,subnet-bbbb \
    Domain=wiki.example.com \
    HostedZoneId=Z0123456789ABCDEF \
    ContainerImage=123456789012.dkr.ecr.us-east-1.amazonaws.com/outline:latest \
    SSOProvider=None
```

---

## Parameters

| Parameter | Required | Description |
|-----------|:--------:|-------------|
| `EnvName` | yes | Environment name (lowercase letters/digits). Used in resource names. Default `prod`. |
| `VpcId` | yes | Existing VPC ID. |
| `SubnetIds` | yes | At least two public subnets in different AZs. |
| `Domain` | yes | Fully-qualified hostname for Outline, e.g. `wiki.example.com`. |
| `HostedZoneId` | yes | Route 53 hosted zone owning `Domain`. |
| `ContainerImage` | yes | Full image URI, including tag. |
| `SSOProvider` | no | `None`, `Google`, `Azure`, or `OIDC`. Default `None`. |
| `GoogleClientId` / `GoogleClientSecret` | conditional | Required when `SSOProvider=Google`. See [sso-google.md](sso-google.md). |
| `AzureClientId` / `AzureClientSecret` / `AzureTenantId` | conditional | Required when `SSOProvider=Azure`. See [sso-azure.md](sso-azure.md). |
| `OIDCClientId` / `OIDCClientSecret` / `OIDCAuthUri` / `OIDCTokenUri` / `OIDCUserInfoUri` / `OIDCDisplayName` | conditional | Required when `SSOProvider=OIDC`. See [sso-oidc.md](sso-oidc.md). |
| `DbInstanceClass` | no | RDS instance class. Default `t4g.small`. |
| `DbStorageGb` | no | RDS storage in GB. Default `50`, auto-scales to 2x. |
| `FargateCpu` | no | Task CPU (milli-vCPU). Default `1024`. Allowed: 256, 512, 1024, 2048, 4096. |
| `FargateMemory` | no | Task memory in MiB. Default `2048`. Must be valid for chosen CPU. |
| `DesiredCount` | no | Number of running tasks. Default `2`. |

---

## Post-deploy

1. **SMTP env vars.** The task definition needs SMTP credentials for magic-link
   sign-in and invitations to work. Update the ECS task definition (or use an
   out-of-band Secrets Manager secret) to add:
    - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`
    - `SMTP_FROM_EMAIL`, `SMTP_REPLY_EMAIL`
   Then redeploy the service.
2. **First sign-in.** Navigate to your `Domain` in a browser. If SSO is
   configured, sign in via the provider. Otherwise enter any email and click
   the magic-link in the resulting email.
3. **Invite teammates.** In Outline → Settings → Members. You can also
   invite external users as **Guests** (a built-in role that can only view
   documents/collections explicitly shared with them — no restriction on
   the guest's email domain).

---

## Troubleshooting

**Stack creation stuck on `CREATE_IN_PROGRESS` for the ACM certificate**
— The cert uses DNS validation via the Route 53 zone you specified.
Confirm the zone is delegated correctly (`dig NS <your-zone>`) and that
the CNAME validation records got created in the zone.

**ECS tasks crash-looping** — Check the `/outline/<env>` CloudWatch log
group. Common causes: missing SMTP env vars, unreachable Redis (wrong SG),
or the `ContainerImage` tag doesn't exist. The server won't start until it
can run migrations against RDS and connect to Redis.

**Database migrations did not run** — Outline auto-runs pending migrations
on boot (`server/utils/startup.ts`). If you see "Migrations pending"
errors, confirm the task has not been started with `--no-migrate`.

**Domain doesn't resolve** — Confirm the Route 53 A record was created
(CloudFormation output `Networking.AliasRecord`) and that your DNS
propagation has completed (`dig <your-domain>`).
