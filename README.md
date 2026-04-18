# Gnarlysoft Outline Fork

A fork of [Outline](https://github.com/outline/outline) packaged for one-shot
deployment to AWS, with a few opinionated additions on top of upstream:

- **First-class Excalidraw editor** — draw diagrams inline, no external hosting
- **Azure / Microsoft 365 SSO** — configured via CloudFormation parameters
- **AWS CDK + CloudFormation infra** — ECS Fargate, RDS Postgres, ElastiCache
  Redis, S3, ALB, ACM, Route 53

This is a community fork. It is distributed free under the
[Business Source License 1.1](LICENSE) and is **not a commercial product**.
See [NOTICE](NOTICE) for the list of modifications and the license terms that
apply to downstream use.

> Upstream Outline is an independent product from General Outline, Inc. For
> Outline's hosted SaaS, user documentation, or commercial support, visit
> [getoutline.com](https://www.getoutline.com). This repository is not
> affiliated with, endorsed by, or sponsored by General Outline.

---

## Deploy to AWS

Customers deploy Outline into their own AWS account using the included
CloudFormation template. No third-party service is involved — you own the
infrastructure, the data, and the domain end-to-end.

### Easy mode — let Claude Code do it

If you have [Claude Code](https://claude.com/claude-code) installed, this repo
ships a skill at `.claude/skills/deploy-to-aws/` that walks you through the
full deploy. Fork or clone the repo, `cd` into it, open Claude Code, and run:

> **`Use the deploy-to-aws skill to help me deploy this to my AWS account.`**

Claude will interview you for the required values (domain, Route 53 hosted
zone, SSO choice, sizing), check your AWS CLI setup and IAM permissions,
build and push the container image to your ECR, and run CloudFormation
end-to-end. The interview confirms every parameter before spending money.

### Manual mode

1. Fork or clone this repo.
2. See [docs/deploy.md](docs/deploy.md) for prerequisites and step-by-step
   CloudFormation deployment.
3. For SSO configuration, see:
   - [docs/sso-google.md](docs/sso-google.md)
   - [docs/sso-azure.md](docs/sso-azure.md)
   - [docs/sso-oidc.md](docs/sso-oidc.md)

Email magic-link sign-in works out of the box once SMTP is configured — no
SSO provider is strictly required.

---

## License

This fork is licensed under the [Business Source License 1.1](LICENSE),
inherited from upstream Outline. Key points:

- You may deploy this fork for your own team's production use.
- You may **not** offer it as a hosted "Document Service" to third parties
  (including any paid SaaS / AWS Marketplace listing) without first obtaining
  a commercial license from General Outline, Inc.
- On 2030-03-18 the license converts automatically to Apache 2.0.

Read the full terms in [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

## Development

Setup and contribution docs follow upstream Outline conventions. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for an architectural overview
of the core application.

Backend / frontend / shared code is organized under `server/`, `app/`,
`shared/`. Deployment infrastructure lives in `infra/` (AWS CDK) and
`cfn/` (generated CloudFormation).

```bash
yarn install
yarn dev:watch   # backend + Vite dev server
yarn tsc         # type check
yarn lint        # oxlint
yarn test path/to/file.test.ts
```

### Tests

Test files live next to the code they cover as `*.test.ts`. Jest runs them.

```bash
# Run a specific test (preferred)
yarn test path/to/file.test.ts

# Backend / frontend / shared suites
yarn test:server
yarn test:app
yarn test:shared
```

### Migrations

Outline uses Sequelize migrations. Upstream may add new migrations on every
sync; run them after pulling.

```bash
yarn db:create-migration --name my-migration
yarn db:migrate
yarn db:rollback

# Migrations against the test database
yarn db:migrate --env test
```

In production the server process runs pending migrations automatically on
boot (`server/utils/startup.ts → checkPendingMigrations`). Pass
`--no-migrate` to disable this and run them manually.

---

## Upstream

This fork tracks [outline/outline](https://github.com/outline/outline) on the
`main` branch. Bug reports and feature requests that are not specific to our
modifications should go to the upstream project.

## Activity

![Repo analytics](https://repobeats.axiom.co/api/embed/ff2e4e6918afff1acf9deb72d1ba6b071d586178.svg "Repobeats analytics image")
