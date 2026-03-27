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
  readonly databaseUrlSecret: secretsmanager.ISecret;
  readonly repo: ecr.IRepository;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
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

    // -- S3 Bucket for attachments ----------------------------------------

    const attachmentsBucket = new s3.Bucket(this, "AttachmentsBucket", {
      bucketName: "gnarlysoft-outline-attachments",
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

    const container = taskDef.addContainer("OutlineContainer", {
      image: ecs.ContainerImage.fromEcrRepository(props.repo, "latest"),
      containerName: "outline-wiki",
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "outline",
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        URL: `https://${config.domain}`,
        FILE_STORAGE: "s3",
        AWS_S3_UPLOAD_BUCKET_NAME: attachmentsBucket.bucketName,
        AWS_S3_UPLOAD_BUCKET_URL: `https://s3.${config.region}.amazonaws.com`,
        AWS_S3_ACL: "private",
        AWS_REGION: config.region,
        FORCE_HTTPS: "true",
        PGSSLMODE: "disable",
        AZURE_TENANT_ID: config.azureTenantId,
        REDIS_URL: `redis://${props.redisEndpoint}:6379`,
        DB_HOST: props.dbEndpoint,
        DB_PORT: props.dbPort,
        DB_NAME: "outline",
        DB_USER: "outline",
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dbSecret, "password"),
        DATABASE_URL: ecs.Secret.fromSecretsManager(props.databaseUrlSecret, "DATABASE_URL"),
        SECRET_KEY: ecs.Secret.fromSecretsManager(props.appConfigSecret, "SECRET_KEY"),
        UTILS_SECRET: ecs.Secret.fromSecretsManager(props.appConfigSecret, "UTILS_SECRET"),
        AZURE_CLIENT_ID: ecs.Secret.fromSecretsManager(props.appConfigSecret, "AZURE_CLIENT_ID"),
        AZURE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(props.appConfigSecret, "AZURE_CLIENT_SECRET"),
      },
    });

    container.addPortMappings({ containerPort: 3000 });

    // -- IAM: grant execution role access to secrets ----------------------

    taskDef.executionRole?.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:outline/*`,
      ],
    }));

    // -- IAM: grant task role access to S3 bucket -------------------------

    attachmentsBucket.grantReadWrite(taskDef.taskRole);

    // -- Fargate Service --------------------------------------------------

    const service = new ecs.FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition: taskDef,
      serviceName: `outline-wiki-${config.envName}`,
      desiredCount: config.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnets: props.subnets },
      securityGroups: [props.appSecurityGroup],
      capacityProviderStrategies: [
        { capacityProvider: "FARGATE", weight: 1 },
      ],
      circuitBreaker: { enable: true, rollback: true },
    });

    props.targetGroup.addTarget(service);

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
