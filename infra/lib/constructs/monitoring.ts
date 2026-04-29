import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";

export interface MonitoringProps {
  readonly config: EnvironmentConfig;
  readonly dbInstance: rds.DatabaseInstance;
  readonly redisClusterName: string;
  readonly alb: elbv2.ApplicationLoadBalancer;
}

/**
 * CloudWatch alarms that surface the non-ECS bottlenecks: RDS CPU/memory
 * pressure, Redis CPU saturation, and bursts of backend 5xx on the ALB.
 *
 * Alarms are created with `actionsEnabled=false` — they light up the
 * CloudWatch console but do not fan out to SNS. Wire an SNS topic in
 * later if these signals prove useful.
 */
export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const { config, dbInstance, redisClusterName, alb } = props;
    const envName = config.envName;

    new cloudwatch.Alarm(this, "RdsCpuHigh", {
      alarmName: `Outline-${envName}-RdsCpuHigh`,
      alarmDescription: "RDS CPU utilization above 80% for 10 minutes. Adding Fargate tasks will not help — consider a larger DbInstanceClass.",
      metric: dbInstance.metricCPUUtilization({ period: cdk.Duration.minutes(5) }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: false,
    });

    // 100 MiB threshold is a universal floor — Postgres instances of any
    // size legitimately steady-state above this. Higher thresholds (e.g.
    // 256 MiB) false-alarm on t4g.micro, which idles at ~180 MiB free.
    new cloudwatch.Alarm(this, "RdsLowMemory", {
      alarmName: `Outline-${envName}-RdsLowMemory`,
      alarmDescription: "RDS FreeableMemory below 100 MiB for 10 minutes. Consider a larger DbInstanceClass.",
      metric: dbInstance.metricFreeableMemory({ period: cdk.Duration.minutes(5) }),
      threshold: 100 * 1024 * 1024,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: false,
    });

    new cloudwatch.Alarm(this, "RedisCpuHigh", {
      alarmName: `Outline-${envName}-RedisCpuHigh`,
      alarmDescription: "ElastiCache Redis engine CPU above 80% for 10 minutes. Consider a larger cache.* node type.",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ElastiCache",
        metricName: "EngineCPUUtilization",
        dimensionsMap: { CacheClusterId: redisClusterName },
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.AVERAGE,
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: false,
    });

    new cloudwatch.Alarm(this, "Alb5xxBurst", {
      alarmName: `Outline-${envName}-Alb5xxBurst`,
      alarmDescription: "More than 10 backend 5xx responses per minute for 5 minutes. Investigate ECS task logs; scaling alone won't fix this.",
      metric: alb.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: cdk.Duration.minutes(1),
        statistic: cloudwatch.Stats.SUM,
      }),
      threshold: 10,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: false,
    });
  }
}
