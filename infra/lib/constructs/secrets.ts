import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface SecretsProps {
  readonly config: EnvironmentConfig;
}

/**
 * Imports existing Secrets Manager secrets for application configuration.
 * Secrets are created before first deploy and imported here using full ARNs
 * (per learned pitfall: ECS can't resolve partial ARNs, and retained secrets
 * block re-deploys if CDK tries to create them).
 */
export class Secrets extends Construct {
  public readonly appConfig: secretsmanager.ISecret;
  public readonly databaseUrl: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: SecretsProps) {
    super(scope, id);

    // Import existing secrets by full ARN (created before first deploy)
    this.appConfig = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AppConfig",
      `arn:aws:secretsmanager:us-east-1:809015461931:secret:outline/${props.config.envName}/app-config-DWyBYS`
    );

    this.databaseUrl = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "DatabaseUrl",
      `arn:aws:secretsmanager:us-east-1:809015461931:secret:outline/${props.config.envName}/database-url-uCTXqH`
    );

    new cdk.CfnOutput(this, "AppConfigSecretArn", {
      value: this.appConfig.secretArn,
      description: "App config secret ARN",
    });

    new cdk.CfnOutput(this, "DatabaseUrlSecretArn", {
      value: this.databaseUrl.secretArn,
      description: "Database URL secret ARN",
    });
  }
}
