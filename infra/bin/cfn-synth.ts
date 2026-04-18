#!/usr/bin/env node
/**
 * Entry point that synthesizes the generic customer-facing CloudFormation
 * template. Emits a single self-contained YAML file to `cfn/outline.yml`
 * (relative to the repo root), suitable for distribution via GitHub.
 *
 * Usage from `infra/`:
 *   yarn cdk:synth-cfn
 *
 * We use CliCredentialsStackSynthesizer so the output does NOT depend on
 * CDK bootstrap resources in the customer's AWS account — deploys work
 * straight out of the box via `aws cloudformation deploy` without
 * running `cdk bootstrap` first.
 */
import * as cdk from "aws-cdk-lib";
import { GenericOutlineStack } from "../lib/generic-stack";

const app = new cdk.App();

new GenericOutlineStack(app, "Outline", {
  description:
    "Outline knowledge base (Gnarlysoft fork) — ECS Fargate + RDS Postgres + ElastiCache Redis.",
  synthesizer: new cdk.LegacyStackSynthesizer(),
});
