import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

/**
 * ECR repository for the Outline wiki container image.
 * Imports existing repo (created before first deploy per learned pitfall:
 * images must exist in ECR before ECS service starts).
 */
export class Registry extends Construct {
  public readonly repo: ecr.IRepository;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.repo = ecr.Repository.fromRepositoryName(
      this,
      "OutlineRepo",
      "outline-wiki"
    );

    new cdk.CfnOutput(this, "RepoUri", {
      value: this.repo.repositoryUri,
      description: "ECR repository URI",
    });
  }
}
