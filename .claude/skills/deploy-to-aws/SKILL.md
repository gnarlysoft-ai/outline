---
name: deploy-to-aws
description: Deploys this Outline fork to the user's own AWS account, and updates an existing deployment with the latest code from upstream outline/outline. Use when the user has forked or cloned this repo and wants to (a) stand Outline up for the first time, or (b) pull in new upstream changes and redeploy. Triggers include "deploy to AWS", "set this up on AWS", "install this fork", "get this running", "deploy my Outline", "update from upstream", "sync with upstream", "pull the latest Outline", "upgrade my Outline", "redeploy with the new upstream code". Covers AWS CLI preflight, IAM permission guidance, Docker image build + ECR push, CloudFormation deploy via interactive parameter interview, and an upstream-sync + redeploy workflow with human checkpoints at merge conflicts and before the stack update.
---

# Deploy This Outline Fork to AWS

## Overview

Walk the user through deploying this Outline fork into their own AWS account
end-to-end. The CloudFormation template at `cfn/outline.yml` creates the
entire stack: VPC networking is brought by the customer, everything else —
ECS Fargate, RDS Postgres, ElastiCache Redis, S3, ALB, ACM cert, Route 53
alias — is created fresh inside their account.

Target user is a technical founder or admin with AWS access but limited
CloudFormation fluency. Do the work for them by driving the AWS CLI
directly. Don't dump docs; don't run opaque scripts.

## Operating principles

- **Drive the AWS CLI directly.** Each step is one `aws ...` command.
  Surface the raw error text to the user when something fails so you can
  troubleshoot together. Don't wrap commands in scripts that swallow
  stderr.
- **Persist parameters to `.deploy.env`.** Write collected interview
  answers (including SSO client secrets) to a `.deploy.env` file in the
  repo root, then `source` it before each step. This survives restarts,
  lets the user re-run failed steps, and — critically — keeps SSO secrets
  out of shell history. `.env*` is gitignored at the repo root, so
  `.deploy.env` matches the pattern and won't be committed.
- **Never echo the secret values back.** When reading `.deploy.env` to
  show the user a summary, mask anything matching `*_CLIENT_SECRET` or
  `*_SECRET` as `***`.
- **Confirm before spending money.** The full stack is billable. Show a
  summary and wait for explicit "yes" before running
  `aws cloudformation deploy`.
- **One CFN template.** Do not regenerate it; use the committed
  `cfn/outline.yml` as-is unless the user specifically asks to modify
  `infra/`.

## Two workflows

Pick which one based on what the user is asking:

- **Workflow A — First deploy** (this section onwards). Trigger: "deploy",
  "set up", "install", "get this running". Produces a fresh stack from
  nothing.
- **Workflow B — Update from upstream**. Trigger: "update", "sync",
  "pull latest", "upgrade". Used when a stack already exists. Read
  `references/update-from-upstream.md` for the full flow.

Both workflows reuse the same `.deploy.env` file and AWS profile.

## Workflow A — First deploy

### Step 1 — Preflight

Check the user's AWS CLI setup directly.

```bash
aws --version
docker version --format '{{.Client.Version}}'
```

If `aws` is missing, point to
https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
and stop until they install it.

#### 1a. Find or create an AWS profile

Ask the user: **"Which AWS profile should we use?"** If unsure, list what
exists:

```bash
aws configure list-profiles
```

**Profile exists?** Verify it works:
```bash
aws sts get-caller-identity --profile <profile>
aws configure get region --profile <profile>   # may be empty; then ask
```

**No profile or credentials invalid?** Walk the user through creating
one. Do NOT ask them to paste credentials into chat. The path:

1. **Confirm they have an AWS account.** If not, direct them to
   https://portal.aws.amazon.com/billing/signup — this requires billing
   setup and can't be automated from here.

2. **Recommend a dedicated IAM user for the deploy** (don't use root).
   Offer two modes:

   - **Easy mode**: in the AWS Console → IAM → Users → Create user →
     attach the AWS-managed `AdministratorAccess` policy. Simple;
     over-scoped. Fine for a first deploy; scope down after.
   - **Scoped mode**: create a user and attach the policy in
     `.claude/skills/deploy-to-aws/references/iam-policy.json`. Either
     inline or as a customer-managed policy. The scoped policy is long
     but covers exactly what this deploy needs.

3. Once the user has the access key pair (either mode), have them run:
   ```
   aws configure --profile outline
   ```
   and paste their Access Key ID, Secret Access Key, and default region
   (`us-east-1` is a safe default). **Don't ask them to paste the
   credentials to you** — `aws configure` reads them on stdin and
   stores them in `~/.aws/credentials`.

4. Re-run `aws sts get-caller-identity --profile outline` to confirm.

If the user already has an IAM user in a different profile they'd like
to re-use, that's fine. Just confirm the identity with
`get-caller-identity`.

#### 1b. Capture core values

Once the profile works, record:

- Account ID (`aws sts get-caller-identity ... --query Account`)
- Identity ARN (for the IAM simulation in step 2f)
- Region (from `aws configure get region` or ask)
- Whether docker is available locally (needed only if building image)

If `docker` is missing, continue only if the user will provide a
pre-built image URI later.

### Step 2 — Interview

Collect all values before starting any AWS work. For a new deploy, create
the `.deploy.env` file by writing these keys:

```env
# AWS target
AWS_PROFILE=<profile>
AWS_REGION=<region>

# Stack
STACK_NAME=outline-prod
ENV_NAME=prod

# Networking (see step 2a to discover)
VPC_ID=vpc-xxxxxxxx
SUBNET_IDS=subnet-xxx,subnet-yyy
DOMAIN=wiki.example.com
HOSTED_ZONE_ID=ZXXXXXXXXXXX

# Image (see step 4)
CONTAINER_IMAGE=

# SSO (fill in only the provider chosen, leave others blank)
SSO_PROVIDER=None   # None | Google | Azure | OIDC
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_AUTH_URI=
OIDC_TOKEN_URI=
OIDC_USERINFO_URI=
OIDC_DISPLAY_NAME=SSO

# Sizing (medium default — see references/sizing.md)
DB_INSTANCE_CLASS=t4g.small
DB_STORAGE_GB=50
FARGATE_CPU=1024
FARGATE_MEMORY=2048
MIN_TASK_COUNT=2
MAX_TASK_COUNT=6
TARGET_CPU_UTILIZATION=60
TARGET_REQUESTS_PER_TARGET=50

# SMTP (required for magic-link + invitations — see step 2e)
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_REPLY_EMAIL=
```

If `.deploy.env` already exists, read it and ask whether to re-use or
overwrite. Re-use is the common case after a failed deploy.

#### 2a. Network discovery

Help the user pick VPC + subnets via the AWS CLI:

```bash
# Default VPC is usually fine; list all:
aws ec2 describe-vpcs --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock,Default:IsDefault,Name:Tags[?Key==`Name`]|[0].Value}' \
  --output table

# Public subnets in the chosen VPC (must be >=2 different AZs):
aws ec2 describe-subnets --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" \
            "Name=map-public-ip-on-launch,Values=true" \
  --query 'Subnets[].{Id:SubnetId,Az:AvailabilityZone,Cidr:CidrBlock}' \
  --output table
```

#### 2b. Hosted zone discovery

```bash
aws route53 list-hosted-zones --profile "$AWS_PROFILE" \
  --query 'HostedZones[].{Id:Id,Name:Name,Records:ResourceRecordSetCount}' \
  --output table
```

Pick the zone whose `Name` is a parent of the `DOMAIN` (e.g. `example.com.`
for `wiki.example.com`). The `Id` comes back as `/hostedzone/Zxxxxxxxx` —
strip the prefix for `HOSTED_ZONE_ID`.

#### 2c. SSO choice

Use AskUserQuestion for the provider picker:

- **None** — email magic-link only. Still requires SMTP configured in
  step 2e.
- **Google** — Google Workspace or consumer Google accounts.
- **Azure / Entra** — Microsoft 365 tenants.
- **OIDC** — any OpenID Connect IdP (Okta, Auth0, Keycloak,
  Authentik, Zitadel, etc.).

If the user picks a real provider, **read `references/sso-interview.md`
now** for the exact per-provider interview — what to ask, how to validate
paste-ins, and which fields to write into `.deploy.env`. Each provider
needs different values (Google = client ID + secret; Azure = + tenant ID;
OIDC = + three endpoint URLs + display name).

The user must register an OAuth application with their IdP **before
continuing**, with redirect URI `https://<DOMAIN>/auth/<provider>.callback`.
Walk them through registration if they haven't — `references/sso-interview.md`
has the step-by-step per provider.

#### 2d. Sizing

See `references/sizing.md`. Default to medium if the user doesn't know.

#### 2e. SMTP setup

Email is required for magic-link sign-in and invitations. Offer the user
two paths:

1. **AWS SES** (recommended — same AWS account, no extra vendor). See
   `references/ses.md` for the full flow: verify identity, check sandbox
   status, create SMTP credentials.
2. **External SMTP** (SendGrid, Postmark, Mailgun, Resend, etc.) — user
   pastes the host / port / username / password they already have.

##### SES shortcut — list verified identities + sandbox status

```bash
# Verified sender identities
aws sesv2 list-email-identities --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query 'EmailIdentities[].{Identity:IdentityName,Type:IdentityType,Enabled:SendingEnabled,Status:VerificationStatus}' \
  --output table

# Sandbox state — if ProductionAccessEnabled is false, SES can only send
# to verified recipients. Outline works in sandbox for testing only.
aws sesv2 get-account --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --query '{SendEnabled:SendingEnabled,Production:ProductionAccessEnabled,DailyQuota:SendQuota.Max24HourSend}' \
  --output table
```

If the user's domain isn't verified yet, direct them to the SES console
to verify it via DKIM (SES will create Route 53 records automatically if
the domain is in the same account as SES). If they're in sandbox and
want real sending, they request production access via the SES console —
AWS usually approves within 24 hours.

##### SES SMTP host and credentials

The SES SMTP endpoint is `email-smtp.<region>.amazonaws.com` on port
`587` (STARTTLS). The username and password for SMTP are **not** the
user's IAM credentials — they're derived from an IAM user with
`ses:SendRawEmail` permission, signed with `smtp-password-v4`. Guide the
user to:

1. In IAM, create a user dedicated to SES SMTP (e.g. `outline-smtp`)
   with a policy allowing `ses:SendRawEmail`
2. Create an Access key for that user — the Access key ID becomes the
   SMTP username; the derived SMTP password is not the secret key
3. Derive the SMTP password with a helper: see
   https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html for
   the exact algorithm. AWS also ships a Python snippet. The Console's
   **Create SMTP credentials** button does this in one click.

Write the four SMTP env vars into `.deploy.env` plus `SMTP_FROM_EMAIL`
(must match a verified identity) and `SMTP_REPLY_EMAIL`.

##### External SMTP

Prompt for host, port (default 587), username, password, from email,
reply email. Write them into `.deploy.env`.

#### 2f. Validation pass

Before confirming the interview, run these proactive checks against the
real AWS account. Surface any failures to the user and fix before the
confirmation prompt:

```bash
source .deploy.env

# 1. Domain is a subdomain of the picked hosted zone
ZONE_NAME=$(aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" --profile "$AWS_PROFILE" \
  --query 'HostedZone.Name' --output text)
# ZONE_NAME has trailing dot; e.g. "example.com."
if [[ "$DOMAIN." != *".$ZONE_NAME" && "$DOMAIN." != "$ZONE_NAME" ]]; then
  echo "ERROR: $DOMAIN is not a subdomain of $ZONE_NAME"
fi

# 2. No existing Route 53 record for DOMAIN would conflict. The stack
#    creates an A alias record at DOMAIN pointing at the ALB — if ANY
#    record exists at that exact name (A, AAAA, CNAME, etc.), CFN will
#    fail with `RRSet already exists`.
aws route53 list-resource-record-sets \
  --profile "$AWS_PROFILE" \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --query "ResourceRecordSets[?Name=='$DOMAIN.'].{Name:Name,Type:Type,Value:ResourceRecords[0].Value || AliasTarget.DNSName}" \
  --output table
# If results present, the subdomain is already in use. Options:
#   - Pick a different DOMAIN (most common fix for first-time deploys)
#   - Delete the existing record if the user confirms it's unused:
#       aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
#         --change-batch '{"Changes":[{"Action":"DELETE","ResourceRecordSet":{...}}]}'
# Never auto-delete — always confirm with the user first; deleting a
# live record breaks whatever was using it.

# 3. IAM simulate — does the deploying principal have the permissions we
#    need? Run one simulation per critical action.
CALLER_ARN=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Arn --output text)
aws iam simulate-principal-policy \
  --profile "$AWS_PROFILE" \
  --policy-source-arn "$CALLER_ARN" \
  --action-names \
    cloudformation:CreateStack \
    ecs:CreateCluster \
    rds:CreateDBInstance \
    elasticache:CreateCacheCluster \
    s3:CreateBucket \
    iam:CreateRole \
    iam:PassRole \
    secretsmanager:CreateSecret \
    ecr:CreateRepository \
    acm:RequestCertificate \
    route53:ChangeResourceRecordSets \
    elasticloadbalancing:CreateLoadBalancer \
  --query 'EvaluationResults[?EvalDecision!=`allowed`].{Action:EvalActionName,Decision:EvalDecision}' \
  --output table
# If any action is not `allowed`, the deploy will fail — have user fix
# IAM before proceeding.
```

If any check fails, surface the specific issue and let the user decide
whether to fix or override. Don't silently continue.

#### 2g. Confirmation

Print a summary with secret values masked as `***` and ask for explicit
confirmation before continuing. Mention the approximate monthly cost
(from `references/sizing.md`).

### Step 3 — IAM permissions

The principal from step 1 needs broad permissions.

Show `references/iam-policy.json` to the user and ask whether their
principal has the listed permissions. If they're not sure, recommend
attaching the AWS-managed `AdministratorAccess` policy for the first
deploy and scoping down afterward.

Smoke-test permissions with:
```bash
aws cloudformation validate-template \
  --template-body file://cfn/outline.yml \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

If that fails with `AccessDenied`, iterate on IAM before continuing.

### Step 4 — Container image

Two paths: build it locally and push to ECR (the common case), or use a
pre-built image.

#### Path A — Build and push to ECR

```bash
source .deploy.env
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
TAG=$(git rev-parse --short HEAD)

# 1. Ensure ECR repo
aws ecr describe-repositories --repository-names outline \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" 2>/dev/null || \
  aws ecr create-repository --repository-name outline \
    --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --image-scanning-configuration scanOnPush=true

# 2. Docker login
aws ecr get-login-password --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

# 3. Build + push (linux/amd64 required for Fargate)
IMAGE_URI="$REGISTRY/outline:$TAG"
docker buildx build \
  --platform linux/amd64 \
  --file Dockerfile.production \
  --tag "$IMAGE_URI" \
  --tag "$REGISTRY/outline:latest" \
  --build-arg "BUILD_ID=$TAG" \
  --push .

echo "CONTAINER_IMAGE=$IMAGE_URI" >> .deploy.env   # if not already set
```

The `docker buildx build` step takes 5–15 minutes depending on host and
network. Stream the output so the user sees progress.

#### Path B — Use a pre-built image

Ask the user for the full image URI (e.g.
`ghcr.io/somebody/outline:v1.2.3`) and write it to `CONTAINER_IMAGE=`
in `.deploy.env`.

### Step 5 — Deploy the stack

Source `.deploy.env` and run CloudFormation deploy directly. Build the
`--parameter-overrides` list to include only the SSO values relevant to
the chosen provider (blanks for the rest):

```bash
source .deploy.env

PARAMS=(
  "EnvName=$ENV_NAME"
  "VpcId=$VPC_ID"
  "SubnetIds=$SUBNET_IDS"
  "Domain=$DOMAIN"
  "HostedZoneId=$HOSTED_ZONE_ID"
  "ContainerImage=$CONTAINER_IMAGE"
  "SSOProvider=$SSO_PROVIDER"
  "SmtpHost=$SMTP_HOST"
  "SmtpPort=$SMTP_PORT"
  "SmtpUsername=$SMTP_USERNAME"
  "SmtpPassword=$SMTP_PASSWORD"
  "SmtpFromEmail=$SMTP_FROM_EMAIL"
  "SmtpReplyEmail=$SMTP_REPLY_EMAIL"
  "DbInstanceClass=$DB_INSTANCE_CLASS"
  "DbStorageGb=$DB_STORAGE_GB"
  "FargateCpu=$FARGATE_CPU"
  "FargateMemory=$FARGATE_MEMORY"
  "MinTaskCount=$MIN_TASK_COUNT"
  "MaxTaskCount=$MAX_TASK_COUNT"
  "TargetCpuUtilization=$TARGET_CPU_UTILIZATION"
  "TargetRequestsPerTarget=$TARGET_REQUESTS_PER_TARGET"
)

# Add only the SSO params for the chosen provider
case "$SSO_PROVIDER" in
  Google)
    PARAMS+=("GoogleClientId=$GOOGLE_CLIENT_ID" "GoogleClientSecret=$GOOGLE_CLIENT_SECRET")
    ;;
  Azure)
    PARAMS+=("AzureClientId=$AZURE_CLIENT_ID" "AzureClientSecret=$AZURE_CLIENT_SECRET" "AzureTenantId=$AZURE_TENANT_ID")
    ;;
  OIDC)
    PARAMS+=("OIDCClientId=$OIDC_CLIENT_ID" "OIDCClientSecret=$OIDC_CLIENT_SECRET"
             "OIDCAuthUri=$OIDC_AUTH_URI" "OIDCTokenUri=$OIDC_TOKEN_URI"
             "OIDCUserInfoUri=$OIDC_USERINFO_URI" "OIDCDisplayName=$OIDC_DISPLAY_NAME")
    ;;
esac

aws cloudformation deploy \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --template-file cfn/outline.yml \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAMS[@]}"
```

CloudFormation masks `NoEcho` parameters (the SSO secrets) in the console,
API responses, and events.

While `aws cloudformation deploy` runs synchronously, stream events in
another shell (or offer the user to open the CFN Console for progress).
Typical time: 15–20 minutes (RDS dominates).

Monitor events if the deploy seems stuck:
```bash
aws cloudformation describe-stack-events \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query 'StackEvents[?ResourceStatus!=`CREATE_COMPLETE`] | [0:20].{Time:Timestamp,Resource:LogicalResourceId,Status:ResourceStatus,Reason:ResourceStatusReason}' \
  --output table
```

If deploy fails, see `references/troubleshooting.md`.

### Step 6 — Post-deploy

Once the stack is `CREATE_COMPLETE`, do three things.

#### 6a. Print the URL

```bash
aws cloudformation describe-stacks \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' --output table
```

The final URL is `https://<DOMAIN>`.

#### 6b. First sign-in

Ask the user to visit `https://<DOMAIN>`. Confirm:

- SSO button appears (if configured)
- Magic-link email arrives (after SMTP is set)
- First sign-in becomes team admin

Delete `.deploy.env` if the user is done and doesn't want it lying
around, or ask them to keep it for future updates.

## Reference material

Load these only when needed:

- **`references/iam-policy.json`** — Minimum IAM policy. Show in step 3.
- **`references/sizing.md`** — Tier → CFN parameter mapping with cost
  estimates. Read during step 2d.
- **`references/sso-interview.md`** — Per-provider interview prompts,
  paste-in format validation, and registration walkthrough. Read
  during step 2c when the user picks Google / Azure / OIDC.
- **`references/ses.md`** — AWS SES setup: identity verification,
  sandbox exit, SMTP credential derivation. Read during step 2e when
  the user picks SES.
- **`references/update-from-upstream.md`** — Workflow B (fetch + merge
  upstream, rebuild image, update the existing stack). Read when the
  user asks to sync/update/upgrade from upstream.
- **`references/troubleshooting.md`** — Stack failures, ECS task issues,
  DNS and HTTPS problems. Read on failure.

## Important constraints

- **Never write secrets to shell history, logs, or git.** `.deploy.env`
  is gitignored; don't echo secret values back in chat. When summarizing,
  mask `*_CLIENT_SECRET`, `*_SECRET`, `*_TOKEN`, `*_KEY` etc. as `***`.
- **Don't skip the confirmation in step 2e.** Creating the stack starts
  billable resources (~$40–450/month depending on sizing).
- **Don't modify `cfn/outline.yml` by hand.** If the template needs
  changes, modify `infra/lib/generic-stack.ts` and regenerate with
  `cd infra && npm run synth:cfn`.
- **`latest` tag is fine for first deploy, but pin to a SHA for updates.**
  Otherwise a `force-new-deployment` could pull a new image unexpectedly.
