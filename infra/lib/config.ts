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

  /** Lower bound for Application Auto Scaling; also used as the service's initial desired count. */
  readonly minTaskCount: number;

  /** Upper bound for Application Auto Scaling. Hard ceiling on Fargate spend. */
  readonly maxTaskCount: number;

  /** Target CPU utilization (percent) for the CPU target-tracking policy. */
  readonly targetCpuUtilization: number;

  /** Target ALB requests per target per minute for the request-count target-tracking policy. */
  readonly targetRequestsPerTarget: number;

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
// Account-specific values (account ID, VPC ID, subnet IDs, hosted zone ID,
// tenant ID) live in the gitignored `config.internal.ts` so they do not get
// committed to the public fork. To bootstrap a new internal-mode deploy,
// copy `config.internal.ts.example` to `config.internal.ts` and edit.
//
// Generic-mode (CloudFormation) deploys do not need that file — they bypass
// `getConfig()` entirely and feed values from CfnParameters at deploy time.

type InternalSharedShape = Pick<
  EnvironmentConfig,
  | "mode"
  | "account"
  | "region"
  | "vpcId"
  | "subnetIds"
  | "domain"
  | "hostedZoneId"
  | "azureTenantId"
  | "ssoProvider"
  | "containerImage"
>;

const PLACEHOLDER_INTERNAL_SHARED: InternalSharedShape = {
  mode: "internal",
  account: "",
  region: "",
  vpcId: "",
  subnetIds: [],
  domain: "",
  hostedZoneId: "",
  azureTenantId: "",
  ssoProvider: "",
  containerImage: "",
};

let INTERNAL_SHARED: InternalSharedShape = PLACEHOLDER_INTERNAL_SHARED;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  INTERNAL_SHARED = (require("./config.internal") as { INTERNAL_SHARED: InternalSharedShape }).INTERNAL_SHARED;
} catch {
  // config.internal.ts not present — only generic mode is usable.
  // getConfig() below throws a helpful error if internal mode is invoked.
}

const configs: Record<string, EnvironmentConfig> = {
  dev: {
    ...INTERNAL_SHARED,
    envName: "dev",

    dbInstanceClass: "t4g.micro",
    dbStorageGb: 20,

    fargateCpu: 512,
    fargateMemory: 1024,
    minTaskCount: 2,
    maxTaskCount: 8,
    targetCpuUtilization: 60,
    targetRequestsPerTarget: 50,
  },

  prod: {
    ...INTERNAL_SHARED,
    envName: "prod",

    dbInstanceClass: "t4g.small",
    dbStorageGb: 50,

    fargateCpu: 1024,
    fargateMemory: 2048,
    minTaskCount: 2,
    maxTaskCount: 6,
    targetCpuUtilization: 60,
    targetRequestsPerTarget: 50,
  },
};

/**
 * Return the hardcoded internal configuration for the given environment name.
 *
 * @param env - environment key (e.g. "dev", "prod").
 * @returns the matching environment config.
 * @throws if the environment name is not recognised, or if internal mode is
 *   requested but `infra/lib/config.internal.ts` is missing.
 */
export function getConfig(env: string): EnvironmentConfig {
  const config = configs[env];
  if (!config) {
    throw new Error(`Unknown environment: ${env}. Valid: ${Object.keys(configs).join(", ")}`);
  }
  if (config.mode === "internal" && !config.account) {
    throw new Error(
      "Internal-mode deploy requires infra/lib/config.internal.ts. " +
        "Copy infra/lib/config.internal.ts.example and fill in your values, " +
        "or use the generic CloudFormation flow instead (yarn cdk:synth-cfn)."
    );
  }
  return config;
}
