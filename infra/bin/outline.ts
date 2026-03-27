#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OutlineStack } from "../lib/outline-stack";
import { getConfig } from "../lib/config";

const app = new cdk.App();

const env = app.node.tryGetContext("env") || "dev";
const config = getConfig(env);

new OutlineStack(app, `Outline-${config.envName}`, {
  config,
  env: {
    account: config.account,
    region: config.region,
  },
});
