/**
 * Environment-specific configuration for the Outline stack.
 *
 * Two config sources are supported:
 *
 * 1. Hardcoded per-environment configs (dev/prod) — used by the internal
 *    Gnarlysoft deployment via `infra/bin/outline.ts`.
 * 2. CloudFormation-parameter-driven config — used by the generic customer
 *    deployment via `infra/bin/cfn-synth.ts`, where every value flows in
 *    from a CfnParameter at deploy time.
 *
 * Both sources yield the same `EnvironmentConfig` shape so the constructs
 * in `infra/lib/constructs/` don't need to care which source was used.
 */

export type DeploymentMode = "internal" | "generic";

export interface EnvironmentConfig {
  /** Whether this stack is the Gnarlysoft-specific internal deploy or a generic customer deploy. */
  readonly mode: DeploymentMode;

  /** Environment name used in resource naming. */
  readonly envName: string;

  /** AWS account ID (required in `internal`; empty string in `generic` — resolves at deploy time). */
  readonly account: string;

  /** AWS region (required in `internal`; empty string in `generic` — resolves at deploy time). */
  readonly region: string;

  /** Existing VPC ID to deploy into. CFN token in `generic` mode. */
  readonly vpcId: string;

  /** Public subnet IDs within the VPC (minimum 2 AZs). CFN tokens in `generic` mode. */
  readonly subnetIds: string[];

  /** Fully-qualified hostname for the Outline instance, e.g. "wiki.example.com". */
  readonly domain: string;

  /** Route 53 hosted zone ID that owns the apex of `domain`. */
  readonly hostedZoneId: string;

  /** Container image URI (ECR repo URI or registry path). Empty string in `internal` (uses internal Registry construct). */
  readonly containerImage: string;

  // -- Database ---------------------------------------------------------

  /** RDS instance class. */
  readonly dbInstanceClass: string;

  /** Storage in GB. */
  readonly dbStorageGb: number;

  // -- Compute ----------------------------------------------------------

  /** Fargate CPU (in milli-vCPU: 256 = 0.25 vCPU). */
  readonly fargateCpu: number;

  /** Fargate memory (in MiB). */
  readonly fargateMemory: number;

  /** Desired task count. */
  readonly desiredCount: number;

  // -- SSO --------------------------------------------------------------

  /**
   * SSO provider identifier: "None" | "Google" | "Azure" | "OIDC".
   * In `internal` mode we hardcode "Azure". In `generic` mode this
   * comes from a CfnParameter the customer selects at deploy time.
   */
  readonly ssoProvider: string;

  /** Azure/Entra tenant ID — only required when ssoProvider === "Azure". */
  readonly azureTenantId: string;
}

// ---------------------------------------------------------------------------
// Internal (Gnarlysoft) configs
// ---------------------------------------------------------------------------
//
// Before making this repository public, move the account ID, VPC ID,
// subnet IDs, hosted zone ID, and Azure tenant ID out of this file (e.g.
// into a gitignored `config.internal.ts` loaded via `process.env` or
// `app.node.tryGetContext`). None of these values are credentials, but
// unnecessary exposure of internal infra identifiers is not ideal.

const INTERNAL_SHARED = {
  mode: "internal" as const,
  account: "809015461931",
  region: "us-east-1",
  vpcId: "vpc-889621f2",
  subnetIds: ["subnet-065945a74d9f344b8", "subnet-439ff96d"],
  domain: "wiki.gnarlysoft.com",
  hostedZoneId: "Z01372345YL6LKC37MDH",
  azureTenantId: "f64ae4c4-b8e2-453a-97bb-8e73450aed49",
  ssoProvider: "Azure",
  containerImage: "",
};

const configs: Record<string, EnvironmentConfig> = {
  dev: {
    ...INTERNAL_SHARED,
    envName: "dev",

    dbInstanceClass: "t4g.micro",
    dbStorageGb: 20,

    fargateCpu: 512,
    fargateMemory: 1024,
    desiredCount: 1,
  },

  prod: {
    ...INTERNAL_SHARED,
    envName: "prod",

    dbInstanceClass: "t4g.small",
    dbStorageGb: 50,

    fargateCpu: 1024,
    fargateMemory: 2048,
    desiredCount: 2,
  },
};

/**
 * Return the hardcoded internal configuration for the given environment name.
 *
 * @param env - environment key (e.g. "dev", "prod").
 * @returns the matching environment config.
 * @throws if the environment name is not recognised.
 */
export function getConfig(env: string): EnvironmentConfig {
  const config = configs[env];
  if (!config) {
    throw new Error(`Unknown environment: ${env}. Valid: ${Object.keys(configs).join(", ")}`);
  }
  return config;
}
