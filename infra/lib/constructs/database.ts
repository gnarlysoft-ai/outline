import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface DatabaseProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly subnets: ec2.ISubnet[];
  readonly dbSecurityGroup: ec2.SecurityGroup;
  readonly redisSecurityGroup: ec2.SecurityGroup;
}

/**
 * RDS PostgreSQL 16 instance and ElastiCache Redis single-node cluster.
 * Database credentials are auto-generated and stored in Secrets Manager.
 */
export class Database extends Construct {
  public readonly instance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbEndpoint: string;
  public readonly dbPort: string;
  public readonly redisEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const { config, vpc, subnets, dbSecurityGroup, redisSecurityGroup } = props;

    // -- RDS Subnet Group -------------------------------------------------

    const dbSubnetGroup = new rds.SubnetGroup(this, "DbSubnetGroup", {
      vpc,
      description: "Outline RDS subnet group",
      subnetGroupName: `outline-db-${config.envName}`,
      vpcSubnets: { subnets },
    });

    // -- RDS Parameter Group ----------------------------------------------

    const parameterGroup = new rds.ParameterGroup(this, "ParamGroup", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      parameters: {
        "rds.force_ssl": "0",
      },
      description: "Outline PostgreSQL 16 params",
    });

    // -- RDS Instance -----------------------------------------------------

    this.instance = new rds.DatabaseInstance(this, "Instance", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: new ec2.InstanceType(config.dbInstanceClass),
      vpc,
      subnetGroup: dbSubnetGroup,
      securityGroups: [dbSecurityGroup],
      parameterGroup,

      databaseName: "outline",
      credentials: rds.Credentials.fromGeneratedSecret("outline", {
        secretName: `outline/${config.envName}/db-credentials`,
      }),

      multiAz: false,
      allocatedStorage: config.dbStorageGb,
      storageType: rds.StorageType.GP3,
      maxAllocatedStorage: config.dbStorageGb * 2,

      instanceIdentifier: `outline-db-${config.envName}`,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deletionProtection: config.envName === "prod",

      backupRetention: cdk.Duration.days(config.envName === "prod" ? 14 : 3),
      preferredBackupWindow: "03:00-04:00",
      preferredMaintenanceWindow: "sun:04:00-sun:05:00",

      publiclyAccessible: true,
    });

    this.dbSecret = this.instance.secret!;
    this.dbEndpoint = this.instance.dbInstanceEndpointAddress;
    this.dbPort = this.instance.dbInstanceEndpointPort;

    // -- ElastiCache Redis ------------------------------------------------

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Outline Redis subnet group",
      cacheSubnetGroupName: `outline-redis-${config.envName}`,
      subnetIds: config.subnetIds,
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, "RedisCluster", {
      engine: "redis",
      cacheNodeType: "cache.t4g.micro",
      numCacheNodes: 1,
      clusterName: `outline-redis-${config.envName}`,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName!,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      engineVersion: "7.1",
    });

    redisCluster.addDependency(redisSubnetGroup);

    this.redisEndpoint = redisCluster.attrRedisEndpointAddress;

    // -- Outputs ----------------------------------------------------------

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: this.instance.dbInstanceEndpointAddress,
      description: "RDS endpoint",
    });

    new cdk.CfnOutput(this, "DbSecretArn", {
      value: this.dbSecret.secretArn,
      description: "DB credentials secret ARN",
    });

    new cdk.CfnOutput(this, "RedisEndpoint", {
      value: this.redisEndpoint,
      description: "Redis endpoint",
    });
  }
}
