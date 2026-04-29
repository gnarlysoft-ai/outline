import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "./config";
import { Networking } from "./constructs/networking";
import { Database } from "./constructs/database";
import { Registry } from "./constructs/registry";
import { Secrets } from "./constructs/secrets";
import { Compute } from "./constructs/compute";
import { Monitoring } from "./constructs/monitoring";

export interface OutlineStackProps extends cdk.StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * Main CDK stack for the Outline wiki deployment on ECS Fargate.
 */
export class OutlineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OutlineStackProps) {
    super(scope, id, props);

    const { config } = props;

    // -- Tag everything ---------------------------------------------------
    cdk.Tags.of(this).add("project", "outline");
    cdk.Tags.of(this).add("environment", config.envName);

    // -- Networking (SGs, ALB, TLS, DNS in existing VPC) ------------------
    const networking = new Networking(this, "Networking", { config });

    // -- Database (RDS PostgreSQL 16 + ElastiCache Redis) ------------------
    const database = new Database(this, "Database", {
      config,
      vpc: networking.vpc,
      subnets: networking.subnets,
      dbSecurityGroup: networking.dbSecurityGroup,
      redisSecurityGroup: networking.redisSecurityGroup,
    });

    // -- Container Registry (ECR) -----------------------------------------
    const registry = new Registry(this, "Registry");

    // -- Secrets Manager (app config) -------------------------------------
    const secrets = new Secrets(this, "Secrets", { config });

    // -- Compute (ECS Fargate service + S3 bucket) ------------------------
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
      repo: registry.repo,
      targetGroup: networking.appTargetGroup,
    });

    // -- Monitoring (RDS / Redis / ALB 5xx alarms) ------------------------
    new Monitoring(this, "Monitoring", {
      config,
      dbInstance: database.instance,
      redisClusterName: database.redisCluster.clusterName!,
      alb: networking.alb,
    });
  }
}
