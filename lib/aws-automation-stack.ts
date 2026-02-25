import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";

export class AwsAutomationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stateMachineRole = new Role(this, 'StateMachineAIRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
    });

    const workflow = new StateMachine(this, 'MyStepFunctionsWorkflow', {
      stateMachineName: 'MyStepFunctionsWorkflow',
      role: stateMachineRole,
      definitionBody: DefinitionBody.fromFile('statemachine/definition.asl.json')
    })
  }
}
