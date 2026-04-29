import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface SSOParameters {
  readonly provider: string;
  readonly googleClientId?: string;
  readonly googleClientSecret?: string;
  readonly azureClientId?: string;
  readonly azureClientSecret?: string;
  readonly azureTenantId?: string;
  readonly oidcClientId?: string;
  readonly oidcClientSecret?: string;
  readonly oidcAuthUri?: string;
  readonly oidcTokenUri?: string;
  readonly oidcUserInfoUri?: string;
  readonly oidcDisplayName?: string;
}

export interface SMTPParameters {
  readonly host?: string;
  readonly port?: string;
  readonly username?: string;
  readonly password?: string;
  readonly fromEmail?: string;
  readonly replyEmail?: string;
}

export interface ComputeProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly subnets: ec2.ISubnet[];
  readonly appSecurityGroup: ec2.SecurityGroup;
  readonly dbEndpoint: string;
  readonly dbPort: string;
  readonly dbSecret: secretsmanager.ISecret;
  readonly redisEndpoint: string;
  readonly appConfigSecret: secretsmanager.ISecret;
  readonly utilsSecret: secretsmanager.ISecret;
  readonly databaseUrlSecret: secretsmanager.ISecret;
  /** ECR repo for internal mode. Undefined in generic mode (image URI comes from config.containerImage). */
  readonly repo?: ecr.IRepository;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
  /** Only supplied in generic mode — SSO credentials come from CFN parameters instead of Secrets Manager. */
  readonly ssoParameters?: SSOParameters;
  /** Only supplied in generic mode — SMTP credentials from CFN parameters. */
  readonly smtpParameters?: SMTPParameters;
}

/**
 * ECS Fargate cluster with a single Outline wiki service, an S3 bucket for
 * file attachments, and the necessary IAM permissions.
 */
export class Compute extends Construct {
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id);

    const { config } = props;
    const isGeneric = config.mode === "generic";

    // -- S3 Bucket for attachments ----------------------------------------
    // Generic mode needs a globally-unique name per deployment; derive from
    // stack name + account + region so customers don't collide with us.
    const bucketName = isGeneric
      ? cdk.Fn.join("-", [
          "outline-attachments",
          cdk.Aws.ACCOUNT_ID,
          cdk.Aws.REGION,
          cdk.Aws.STACK_NAME,
        ])
      : "gnarlysoft-outline-attachments";

    const attachmentsBucket = new s3.Bucket(this, "AttachmentsBucket", {
      bucketName,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      cors: [
        {
          allowedOrigins: [`https://${config.domain}`],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
    });

    // -- ECS Cluster ------------------------------------------------------

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
      clusterName: `outline-${config.envName}`,
      enableFargateCapacityProviders: true,
    });

    // -- Log Group --------------------------------------------------------

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/outline/${config.envName}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -- Task Definition --------------------------------------------------

    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      cpu: config.fargateCpu,
      memoryLimitMiB: config.fargateMemory,
      family: `outline-wiki-${config.envName}`,
    });

    // -- Container image ---------------------------------------------------
    // Internal mode: pull from the Gnarlysoft ECR repo passed in via props.
    // Generic mode: pull from whatever registry the customer specified.
    // config.containerImage is a CFN parameter token at synth time, so we
    // can't detect whether the URI points at ECR. The execution role gets
    // ECR pull grants below so an ECR-hosted image works; a non-ECR URI
    // simply won't exercise those permissions.
    const containerImage = isGeneric
      ? ecs.ContainerImage.fromRegistry(config.containerImage)
      : ecs.ContainerImage.fromEcrRepository(props.repo!, "latest");

    // -- Environment variables --------------------------------------------
    const baseEnv: Record<string, string> = {
      NODE_ENV: "production",
      PORT: "3000",
      URL: `https://${config.domain}`,
      FILE_STORAGE: "s3",
      AWS_S3_UPLOAD_BUCKET_NAME: attachmentsBucket.bucketName,
      AWS_S3_UPLOAD_BUCKET_URL: isGeneric
        ? `https://s3.${cdk.Aws.REGION}.amazonaws.com`
        : `https://s3.${config.region}.amazonaws.com`,
      AWS_S3_ACL: "private",
      AWS_REGION: isGeneric ? cdk.Aws.REGION : config.region,
      FORCE_HTTPS: "true",
      PGSSLMODE: "disable",
      REDIS_URL: `redis://${props.redisEndpoint}:6379`,
      DATABASE_HOST: props.dbEndpoint,
      DATABASE_PORT: props.dbPort,
      DATABASE_NAME: "outline",
      DATABASE_USER: "outline",
    };

    // SMTP env vars (generic mode only — internal mode expects them to be
    // set out-of-band or in the imported secret).
    if (isGeneric && props.smtpParameters) {
      const smtp = props.smtpParameters;
      if (smtp.host) {
        baseEnv.SMTP_HOST = smtp.host;
      }
      if (smtp.port) {
        baseEnv.SMTP_PORT = smtp.port;
      }
      if (smtp.username) {
        baseEnv.SMTP_USERNAME = smtp.username;
      }
      if (smtp.password) {
        baseEnv.SMTP_PASSWORD = smtp.password;
      }
      if (smtp.fromEmail) {
        baseEnv.SMTP_FROM_EMAIL = smtp.fromEmail;
      }
      if (smtp.replyEmail) {
        baseEnv.SMTP_REPLY_EMAIL = smtp.replyEmail;
      }
      // Outline defaults SMTP_SECURE=true (implicit TLS, port 465). The
      // template default port is 587 which uses STARTTLS, so the socket
      // must start plaintext and upgrade. Without this, nodemailer
      // attempts a direct TLS handshake and fails with
      // "tls_validate_record_header: wrong version number".
      baseEnv.SMTP_SECURE = "false";
    }

    // SSO env vars — internal mode pulls from Secrets Manager, generic mode
    // takes them from CFN parameters (passed via props.ssoParameters).
    // In generic mode `sso.provider` and the client-id/secret strings are
    // CFN-parameter tokens, NOT literal strings — so we can't branch on
    // `provider === "Azure"` at synth time (it's always false). Always
    // emit every SSO env var; Outline plugins activate based on whether
    // the client id is non-empty at runtime.
    if (!isGeneric) {
      baseEnv.AZURE_TENANT_ID = config.azureTenantId;
    } else if (props.ssoParameters) {
      const sso = props.ssoParameters;
      baseEnv.AZURE_CLIENT_ID = sso.azureClientId ?? "";
      baseEnv.AZURE_CLIENT_SECRET = sso.azureClientSecret ?? "";
      baseEnv.AZURE_TENANT_ID = sso.azureTenantId ?? "";
      baseEnv.GOOGLE_CLIENT_ID = sso.googleClientId ?? "";
      baseEnv.GOOGLE_CLIENT_SECRET = sso.googleClientSecret ?? "";
      baseEnv.OIDC_CLIENT_ID = sso.oidcClientId ?? "";
      baseEnv.OIDC_CLIENT_SECRET = sso.oidcClientSecret ?? "";
      baseEnv.OIDC_AUTH_URI = sso.oidcAuthUri ?? "";
      baseEnv.OIDC_TOKEN_URI = sso.oidcTokenUri ?? "";
      baseEnv.OIDC_USERINFO_URI = sso.oidcUserInfoUri ?? "";
      baseEnv.OIDC_DISPLAY_NAME = sso.oidcDisplayName ?? "SSO";
    }

    // -- Secrets (Secrets Manager → ECS) ----------------------------------
    // Outline reads DATABASE_PASSWORD (env) or DATABASE_URL (env). Using
    // the discrete DATABASE_* vars avoids a DATABASE_URL placeholder
    // clashing with CannotUseWith("DATABASE_URL") in env.ts.
    const baseSecrets: Record<string, ecs.Secret> = {
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(props.dbSecret, "password"),
      SECRET_KEY: ecs.Secret.fromSecretsManager(props.appConfigSecret, "SECRET_KEY"),
      UTILS_SECRET: ecs.Secret.fromSecretsManager(props.utilsSecret, "UTILS_SECRET"),
    };

    if (!isGeneric) {
      baseSecrets.AZURE_CLIENT_ID = ecs.Secret.fromSecretsManager(props.appConfigSecret, "AZURE_CLIENT_ID");
      baseSecrets.AZURE_CLIENT_SECRET = ecs.Secret.fromSecretsManager(props.appConfigSecret, "AZURE_CLIENT_SECRET");
    }

    const container = taskDef.addContainer("OutlineContainer", {
      image: containerImage,
      containerName: "outline-wiki",
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "outline",
      }),
      environment: baseEnv,
      secrets: baseSecrets,
    });

    container.addPortMappings({ containerPort: 3000 });

    // -- IAM: grant execution role access to secrets ----------------------

    taskDef.executionRole?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:outline/*`,
      ],
    }));

    // -- IAM: grant execution role ECR pull (generic mode only) -----------
    // config.containerImage is a CFN parameter token so we can't detect
    // whether the URI is ECR at synth time. Grant ECR pull unconditionally
    // scoped to the stack's account/region — harmless if the image lives
    // elsewhere (Docker Hub, GHCR), required when it's ECR.
    if (isGeneric) {
      taskDef.executionRole?.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["ecr:GetAuthorizationToken"],
          resources: ["*"],
        })
      );
      taskDef.executionRole?.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          resources: [
            `arn:aws:ecr:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:repository/*`,
          ],
        })
      );
    }

    // -- IAM: grant task role access to S3 bucket -------------------------

    attachmentsBucket.grantReadWrite(taskDef.taskRole);

    // -- Fargate Service --------------------------------------------------

    const service = new ecs.FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition: taskDef,
      serviceName: `outline-wiki-${config.envName}`,
      desiredCount: config.minTaskCount,
      assignPublicIp: true,
      vpcSubnets: { subnets: props.subnets },
      securityGroups: [props.appSecurityGroup],
      capacityProviderStrategies: [
        { capacityProvider: "FARGATE", weight: 1 },
      ],
      circuitBreaker: { enable: true, rollback: true },
    });

    props.targetGroup.addTarget(service);

    // -- Application Auto Scaling -----------------------------------------
    // Two target-tracking policies: CPU handles sustained compute pressure,
    // request-count reacts faster to traffic bursts before CPU catches up.
    // Both policies auto-create their own CloudWatch alarms — we only
    // need to wire them up here.
    const scaling = service.autoScaleTaskCount({
      minCapacity: config.minTaskCount,
      maxCapacity: config.maxTaskCount,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: config.targetCpuUtilization,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnRequestCount("RequestCountScaling", {
      requestsPerTarget: config.targetRequestsPerTarget,
      targetGroup: props.targetGroup,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // -- Outputs ----------------------------------------------------------

    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      description: "ECS cluster name",
    });

    new cdk.CfnOutput(this, "ServiceName", {
      value: service.serviceName,
      description: "ECS service name",
    });
  }
}
