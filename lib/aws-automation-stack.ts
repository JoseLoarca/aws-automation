import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {PolicyDocument, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {CfnOutput, RemovalPolicy} from "aws-cdk-lib/core";

export class AwsAutomationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -- S3 --
    const dataBucket = new Bucket(this, 'MyStepFunctionsDataBucket', {
      bucketName: 'my-step-functions-s3-data-bucket',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const s3AccessPolicy = new PolicyDocument({
      statements: [
          new PolicyStatement({
            actions: ['s3:GetObject', 's3:PutObject'],
            resources: [
                dataBucket.bucketArn,
                `${dataBucket.bucketArn}/*`
            ],
          }),
      ],
    });

    // -- Step Functions Role --
    const stateMachineRole = new Role(this, 'StateMachineAIRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        S3AccessPolicy: s3AccessPolicy
      }
    });

    // -- Step Functions Workflow --
    const workflow = new StateMachine(this, 'MyStepFunctionsWorkflow', {
      stateMachineName: 'MyStepFunctionsWorkflow',
      role: stateMachineRole,
      definitionBody: DefinitionBody.fromFile('statemachine/definition.asl.json'),
      definitionSubstitutions: {
        DataBucketName: dataBucket.bucketName,
      }
    });

    // -- CloudFormation Output --
    new CfnOutput(this, 'CFOutputStateMachineArn', {
      value: workflow.stateMachineArn
    });

  }
}
