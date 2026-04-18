# Troubleshooting

Common failures during `scripts/deploy-stack.sh` and after, with fixes.

## Stack fails during CREATE

### `Certificate validation failed` or cert stuck in `Pending`

ACM uses DNS validation via the Route 53 zone passed as `HostedZoneId`.

- Confirm the hosted zone is delegated: `dig NS <zone-apex>` should return
  the four AWS nameservers.
- Confirm the validation CNAME was created in the zone. ACM writes it
  automatically, but if the hosted zone was in a different account than
  the deploying principal, that write fails silently.
- Look up the cert in ACM console; the `Domain validation` panel shows the
  exact CNAME expected.

### `CREATE_FAILED` on `Domain: ExistsInAnotherAccount`

A different AWS account already owns an ACM cert for the exact domain.
Either transfer the existing cert or pick a different domain.

### `InsufficientCapabilityException`

You forgot `--capabilities CAPABILITY_NAMED_IAM`. `deploy-stack.sh` passes
it by default — this only surfaces if the user ran the AWS CLI directly.

### `CREATE_FAILED` on RDS subnet group

- The `SubnetIds` parameter must contain at least 2 subnets in *different*
  AZs. Putting two subnets from the same AZ fails.
- Subnets must be in the VPC specified by `VpcId`.

### `Requested resource not found` on ECS task start

The task definition's `Image` doesn't exist in the specified registry.

- Did the image push succeed? Re-run `scripts/build-and-push.sh`.
- Is the tag right? The CFN template passes `ContainerImage` verbatim —
  `sha256@…` digests also work, but typos fail silently.
- Is the image multi-arch? Fargate requires `linux/amd64`.
  `build-and-push.sh` sets this; if the user built manually check
  `--platform`.

## Stack reaches CREATE_COMPLETE but Outline doesn't work

### Tasks keep restarting

Check `/outline/<env>` CloudWatch log group.

- **`ECONNREFUSED` to Redis** — Redis security group ingress likely
  missing. Confirm `RedisSg` allows port 6379 from `AppSg`.
- **`ECONNREFUSED` to Postgres** — Same, for `DbSg` on 5432.
- **`SECRET_KEY is required`** — Secret didn't populate. Check
  `outline/<env>/secret-key` in Secrets Manager — CFN creates it with a
  generated value. If empty, delete the stack and re-create.
- **`Database migrations are pending`** — the `--no-migrate` flag got
  passed somewhere. Remove it.

### Domain doesn't resolve

```bash
dig <domain> +short
```

Should return the ALB's IPv4 address(es). If nothing:

- Confirm the `AliasRecord` resource in the stack is `CREATE_COMPLETE`.
- Check DNS propagation hasn't finished yet (up to 10 minutes typical).

### HTTPS loads but Outline shows a 502

ALB can't reach the ECS task.

- Check the target group health in the EC2 console → Target Groups →
  `outline-app-<env>` → Targets tab. Tasks should be `healthy`.
- The task's health check path is `/_health`. Hit it directly:
  `curl -v http://<task-ip>:3000/_health`.

### No SSO button on the login page

- Confirm the relevant SSO env vars made it into the task definition:
  `aws ecs describe-task-definition --task-definition outline-wiki-<env> | jq '.taskDefinition.containerDefinitions[0].environment'`.
- Redirect URI mismatch — Outline rejects the OAuth callback without a
  helpful message. Verify the redirect URI registered with the IdP is
  exactly `https://<domain>/auth/<provider>.callback`.

### Magic-link emails don't arrive

SMTP env vars not set. Required after deploy:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`,
`SMTP_FROM_EMAIL`, `SMTP_REPLY_EMAIL`.

Add them via a new task-definition revision and re-deploy the service.

## Tearing down

```bash
aws cloudformation delete-stack --stack-name <name> --profile <p> --region <r>
aws cloudformation wait stack-delete-complete --stack-name <name> --profile <p> --region <r>
```

The stack's S3 bucket is set to `RemovalPolicy.DESTROY` — it deletes with
the stack. Take a backup of important data first: all attachments live in
`outline-attachments-<account>-<region>-<stack>` and documents are in RDS.
