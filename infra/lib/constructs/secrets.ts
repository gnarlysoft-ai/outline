import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface SecretsProps {
  readonly config: EnvironmentConfig;
}

/**
 * Application secrets (SECRET_KEY, UTILS_SECRET, optional SSO client
 * secrets, database URL).
 *
 * - `internal` mode: imports pre-existing Secrets Manager secrets by full ARN.
 *   The secrets are created out-of-band before first deploy (per learned
 *   pitfall: ECS can't resolve partial ARNs, and retained secrets block
 *   re-deploys if CDK tries to create them).
 * - `generic` mode: creates fresh secrets in-stack — one Secret for
 *   `SECRET_KEY` and one for `UTILS_SECRET`, both auto-generated 64-char
 *   random strings. Compute reads from each separately. Database URL
 *   secret is created as a placeholder (populated out-of-band; for this
 *   stack the DB_* env vars use the RDS auto-generated credentials
 *   directly so DATABASE_URL is less critical).
 */
export class Secrets extends Construct {
  public readonly appConfig: secretsmanager.ISecret;
  public readonly utilsSecret: secretsmanager.ISecret;
  public readonly databaseUrl: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: SecretsProps) {
    super(scope, id);

    if (props.config.mode === "internal") {
      this.appConfig = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        "AppConfig",
        `arn:aws:secretsmanager:us-east-1:809015461931:secret:outline/${props.config.envName}/app-config-DWyBYS`
      );
      this.utilsSecret = this.appConfig;

      this.databaseUrl = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        "DatabaseUrl",
        `arn:aws:secretsmanager:us-east-1:809015461931:secret:outline/${props.config.envName}/database-url-uCTXqH`
      );
    } else {
      this.appConfig = new secretsmanager.Secret(this, "AppConfig", {
        secretName: `outline/${props.config.envName}/secret-key`,
        description: "Outline SECRET_KEY (auto-generated)",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: "SECRET_KEY",
          excludePunctuation: true,
          passwordLength: 64,
        },
      });

      this.utilsSecret = new secretsmanager.Secret(this, "UtilsSecret", {
        secretName: `outline/${props.config.envName}/utils-secret`,
        description: "Outline UTILS_SECRET (auto-generated)",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: "UTILS_SECRET",
          excludePunctuation: true,
          passwordLength: 64,
        },
      });

      this.databaseUrl = new secretsmanager.Secret(this, "DatabaseUrl", {
        secretName: `outline/${props.config.envName}/database-url`,
        description: "Outline DATABASE_URL (unused; DB_* env vars are used instead)",
        secretStringValue: cdk.SecretValue.unsafePlainText(
          "postgres://placeholder"
        ),
      });
    }

    new cdk.CfnOutput(this, "AppConfigSecretArn", {
      value: this.appConfig.secretArn,
      description: "App config secret ARN",
    });
  }
}
