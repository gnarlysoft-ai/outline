import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "./config";
import { Networking } from "./constructs/networking";
import { Database } from "./constructs/database";
import { Secrets } from "./constructs/secrets";
import { Compute, type SSOParameters, type SMTPParameters } from "./constructs/compute";

/**
 * Customer-facing CloudFormation stack.
 *
 * Every customer-specific value flows in from a CfnParameter at deploy
 * time (VPC, subnets, domain, SSO credentials, container image URI, etc.)
 * so the same template can be deployed into any AWS account without code
 * edits. Defaults are sensible for a small-to-medium team (~50 users).
 */
export class GenericOutlineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -- Parameters -------------------------------------------------------

    const envName = new cdk.CfnParameter(this, "EnvName", {
      type: "String",
      default: "prod",
      description: "Environment name used in resource naming (e.g. 'prod', 'staging').",
      allowedPattern: "^[a-z][a-z0-9]{0,15}$",
    });

    const vpcId = new cdk.CfnParameter(this, "VpcId", {
      type: "AWS::EC2::VPC::Id",
      description: "VPC to deploy Outline into. Must have at least two public subnets in different AZs.",
    });

    const subnetIds = new cdk.CfnParameter(this, "SubnetIds", {
      type: "List<AWS::EC2::Subnet::Id>",
      description: "Public subnet IDs in the selected VPC (at least 2 in different AZs).",
    });

    const domain = new cdk.CfnParameter(this, "Domain", {
      type: "String",
      description: "Fully-qualified hostname for Outline (e.g. 'wiki.example.com'). Must be a subdomain of an existing Route 53 hosted zone.",
      allowedPattern: "^[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+$",
    });

    const hostedZoneId = new cdk.CfnParameter(this, "HostedZoneId", {
      type: "AWS::Route53::HostedZone::Id",
      description: "Route 53 hosted zone that will own the DNS record for Domain.",
    });

    const containerImage = new cdk.CfnParameter(this, "ContainerImage", {
      type: "String",
      description: "Full container image URI (e.g. ghcr.io/gnarlysoft-ai/outline:latest or <account>.dkr.ecr.<region>.amazonaws.com/outline:latest).",
    });

    // -- SSO parameters ---------------------------------------------------

    const ssoProvider = new cdk.CfnParameter(this, "SSOProvider", {
      type: "String",
      default: "None",
      allowedValues: ["None", "Google", "Azure", "OIDC"],
      description: "SSO provider. 'None' = email magic-link only (requires SMTP env vars).",
    });

    const googleClientId = new cdk.CfnParameter(this, "GoogleClientId", {
      type: "String",
      default: "",
      description: "Google OAuth client ID. Required if SSOProvider = Google.",
    });
    const googleClientSecret = new cdk.CfnParameter(this, "GoogleClientSecret", {
      type: "String",
      default: "",
      noEcho: true,
      description: "Google OAuth client secret. Required if SSOProvider = Google.",
    });

    const azureClientId = new cdk.CfnParameter(this, "AzureClientId", {
      type: "String",
      default: "",
      description: "Azure/Entra application (client) ID. Required if SSOProvider = Azure.",
    });
    const azureClientSecret = new cdk.CfnParameter(this, "AzureClientSecret", {
      type: "String",
      default: "",
      noEcho: true,
      description: "Azure/Entra client secret. Required if SSOProvider = Azure.",
    });
    const azureTenantId = new cdk.CfnParameter(this, "AzureTenantId", {
      type: "String",
      default: "",
      description: "Azure/Entra directory (tenant) ID. Required if SSOProvider = Azure.",
    });

    const oidcClientId = new cdk.CfnParameter(this, "OIDCClientId", {
      type: "String",
      default: "",
      description: "Generic OIDC client ID. Required if SSOProvider = OIDC.",
    });
    const oidcClientSecret = new cdk.CfnParameter(this, "OIDCClientSecret", {
      type: "String",
      default: "",
      noEcho: true,
      description: "Generic OIDC client secret. Required if SSOProvider = OIDC.",
    });
    const oidcAuthUri = new cdk.CfnParameter(this, "OIDCAuthUri", {
      type: "String",
      default: "",
      description: "OIDC authorize endpoint URL.",
    });
    const oidcTokenUri = new cdk.CfnParameter(this, "OIDCTokenUri", {
      type: "String",
      default: "",
      description: "OIDC token endpoint URL.",
    });
    const oidcUserInfoUri = new cdk.CfnParameter(this, "OIDCUserInfoUri", {
      type: "String",
      default: "",
      description: "OIDC userinfo endpoint URL.",
    });
    const oidcDisplayName = new cdk.CfnParameter(this, "OIDCDisplayName", {
      type: "String",
      default: "SSO",
      description: "Display name shown on the OIDC sign-in button.",
    });

    // -- SMTP parameters --------------------------------------------------
    // Email is required for magic-link sign-in and invitations. If left
    // blank the stack still deploys but email-dependent flows are disabled
    // until env vars are set out-of-band.

    const smtpHost = new cdk.CfnParameter(this, "SmtpHost", {
      type: "String",
      default: "",
      description: "SMTP server hostname. For AWS SES: email-smtp.<region>.amazonaws.com. Leave blank to disable email.",
    });
    const smtpPort = new cdk.CfnParameter(this, "SmtpPort", {
      type: "String",
      default: "587",
      description: "SMTP port. 587 (STARTTLS) is the common default; 465 for TLS.",
    });
    const smtpUsername = new cdk.CfnParameter(this, "SmtpUsername", {
      type: "String",
      default: "",
      description: "SMTP username. For SES: the SMTP credential access key (not your IAM user's AKIA).",
    });
    const smtpPassword = new cdk.CfnParameter(this, "SmtpPassword", {
      type: "String",
      default: "",
      noEcho: true,
      description: "SMTP password. For SES: the SMTP credential secret derived via smtp-password-v4 signing.",
    });
    const smtpFromEmail = new cdk.CfnParameter(this, "SmtpFromEmail", {
      type: "String",
      default: "",
      description: "The 'From' address used by Outline emails. Must be a verified sender at your SMTP provider.",
    });
    const smtpReplyEmail = new cdk.CfnParameter(this, "SmtpReplyEmail", {
      type: "String",
      default: "",
      description: "The 'Reply-To' address. Often the same as SmtpFromEmail.",
    });

    // -- Sizing parameters ------------------------------------------------

    const dbInstanceClass = new cdk.CfnParameter(this, "DbInstanceClass", {
      type: "String",
      default: "t4g.small",
      description: "RDS instance class (e.g. t4g.micro, t4g.small, m7g.large).",
    });
    const dbStorageGb = new cdk.CfnParameter(this, "DbStorageGb", {
      type: "Number",
      default: 50,
      minValue: 20,
      description: "RDS storage in GB. Will auto-scale up to 2x this value.",
    });
    const fargateCpu = new cdk.CfnParameter(this, "FargateCpu", {
      type: "Number",
      default: 1024,
      allowedValues: ["256", "512", "1024", "2048", "4096"],
      description: "Fargate task CPU in milli-vCPU (1024 = 1 vCPU).",
    });
    const fargateMemory = new cdk.CfnParameter(this, "FargateMemory", {
      type: "Number",
      default: 2048,
      description: "Fargate task memory in MiB. Must be compatible with chosen CPU.",
    });
    const desiredCount = new cdk.CfnParameter(this, "DesiredCount", {
      type: "Number",
      default: 2,
      minValue: 1,
      description: "Number of ECS tasks to run.",
    });

    // -- Build config -----------------------------------------------------

    const config: EnvironmentConfig = {
      mode: "generic",
      envName: envName.valueAsString,
      account: "",
      region: "",
      vpcId: vpcId.valueAsString,
      subnetIds: subnetIds.valueAsList,
      domain: domain.valueAsString,
      hostedZoneId: hostedZoneId.valueAsString,
      containerImage: containerImage.valueAsString,
      dbInstanceClass: dbInstanceClass.valueAsString,
      dbStorageGb: dbStorageGb.valueAsNumber,
      fargateCpu: fargateCpu.valueAsNumber,
      fargateMemory: fargateMemory.valueAsNumber,
      desiredCount: desiredCount.valueAsNumber,
      ssoProvider: ssoProvider.valueAsString,
      azureTenantId: azureTenantId.valueAsString,
    };

    const ssoParameters: SSOParameters = {
      provider: ssoProvider.valueAsString,
      googleClientId: googleClientId.valueAsString,
      googleClientSecret: googleClientSecret.valueAsString,
      azureClientId: azureClientId.valueAsString,
      azureClientSecret: azureClientSecret.valueAsString,
      azureTenantId: azureTenantId.valueAsString,
      oidcClientId: oidcClientId.valueAsString,
      oidcClientSecret: oidcClientSecret.valueAsString,
      oidcAuthUri: oidcAuthUri.valueAsString,
      oidcTokenUri: oidcTokenUri.valueAsString,
      oidcUserInfoUri: oidcUserInfoUri.valueAsString,
      oidcDisplayName: oidcDisplayName.valueAsString,
    };

    const smtpParameters: SMTPParameters = {
      host: smtpHost.valueAsString,
      port: smtpPort.valueAsString,
      username: smtpUsername.valueAsString,
      password: smtpPassword.valueAsString,
      fromEmail: smtpFromEmail.valueAsString,
      replyEmail: smtpReplyEmail.valueAsString,
    };

    cdk.Tags.of(this).add("project", "outline");
    cdk.Tags.of(this).add("environment", config.envName);

    const networking = new Networking(this, "Networking", { config });

    const database = new Database(this, "Database", {
      config,
      vpc: networking.vpc,
      subnets: networking.subnets,
      dbSecurityGroup: networking.dbSecurityGroup,
      redisSecurityGroup: networking.redisSecurityGroup,
    });

    const secrets = new Secrets(this, "Secrets", { config });

    new Compute(this, "Compute", {
      config,
      vpc: networking.vpc,
      subnets: networking.subnets,
      appSecurityGroup: networking.appSecurityGroup,
      dbEndpoint: database.dbEndpoint,
      dbPort: database.dbPort,
      dbSecret: database.dbSecret,
      redisEndpoint: database.redisEndpoint,
      appConfigSecret: secrets.appConfig,
      utilsSecret: secrets.utilsSecret,
      databaseUrlSecret: secrets.databaseUrl,
      targetGroup: networking.appTargetGroup,
      ssoParameters,
      smtpParameters,
    });

    // -- Parameter groupings for the CFN Console UX -----------------------

    this.templateOptions.metadata = {
      "AWS::CloudFormation::Interface": {
        ParameterGroups: [
          {
            Label: { default: "Environment" },
            Parameters: ["EnvName"],
          },
          {
            Label: { default: "Networking & DNS" },
            Parameters: ["VpcId", "SubnetIds", "Domain", "HostedZoneId"],
          },
          {
            Label: { default: "Application image" },
            Parameters: ["ContainerImage"],
          },
          {
            Label: { default: "Email (SMTP) — required for magic-link sign-in + invitations" },
            Parameters: [
              "SmtpHost",
              "SmtpPort",
              "SmtpUsername",
              "SmtpPassword",
              "SmtpFromEmail",
              "SmtpReplyEmail",
            ],
          },
          {
            Label: { default: "SSO (choose one provider, leave the rest blank)" },
            Parameters: [
              "SSOProvider",
              "GoogleClientId",
              "GoogleClientSecret",
              "AzureClientId",
              "AzureClientSecret",
              "AzureTenantId",
              "OIDCClientId",
              "OIDCClientSecret",
              "OIDCAuthUri",
              "OIDCTokenUri",
              "OIDCUserInfoUri",
              "OIDCDisplayName",
            ],
          },
          {
            Label: { default: "Sizing" },
            Parameters: [
              "DbInstanceClass",
              "DbStorageGb",
              "FargateCpu",
              "FargateMemory",
              "DesiredCount",
            ],
          },
        ],
      },
    };
  }
}
