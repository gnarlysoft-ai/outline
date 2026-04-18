# Sizing Tiers

Map the user's answer in step 2 to concrete CFN parameters. All three tiers
are production-viable — the differences are headroom and redundancy. All
estimates are **rough monthly AWS costs in us-east-1, excluding data
transfer**, as of 2026.

## Small — up to ~20 users

Cheapest usable deploy. Single Fargate task, so brief downtime during
deploys and task restarts.

| CFN parameter | Value |
|---------------|-------|
| `DbInstanceClass` | `t4g.micro` |
| `DbStorageGb` | `20` |
| `FargateCpu` | `512` |
| `FargateMemory` | `1024` |
| `DesiredCount` | `1` |

**Est. monthly cost: ~$40–60/month**
(RDS t4g.micro + 20GB: ~$17, Fargate 1×0.5vCPU/1GB: ~$15, Redis t4g.micro:
~$12, ALB: ~$18, S3 / misc: negligible.)

## Medium — up to ~100 users (default)

Comfortable for most small teams. Two Fargate tasks, so rolling deploys
stay available.

| CFN parameter | Value |
|---------------|-------|
| `DbInstanceClass` | `t4g.small` |
| `DbStorageGb` | `50` |
| `FargateCpu` | `1024` |
| `FargateMemory` | `2048` |
| `DesiredCount` | `2` |

**Est. monthly cost: ~$100–150/month**

## Large — up to ~500 users

Room to grow. Consider enabling RDS Multi-AZ and bumping Redis to a
larger node size for HA (requires manual edits to `infra/` — the default
CFN template does not parametrize those).

| CFN parameter | Value |
|---------------|-------|
| `DbInstanceClass` | `m7g.large` |
| `DbStorageGb` | `100` |
| `FargateCpu` | `2048` |
| `FargateMemory` | `4096` |
| `DesiredCount` | `3` |

**Est. monthly cost: ~$300–450/month**

## Picking a tier

- Unsure? Start with **medium**. Scaling up later is just a stack update
  (no downtime for CPU/memory/count; short RDS downtime for class changes).
- If you'll have <10 users and want to minimize spend: **small**.
- If you already know the team is large (or scaling fast): **large**.

## Customizing

If none of these tiers fit, the user can pass any of the CFN parameters
individually via `scripts/deploy-stack.sh` env vars. Valid combinations:

- `FargateCpu` ∈ {256, 512, 1024, 2048, 4096}
- `FargateMemory` must be compatible with CPU per
  [Fargate sizing matrix](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html)
