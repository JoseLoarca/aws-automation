import * as cdk from 'aws-cdk-lib/core';
import {CfnOutput, RemovalPolicy, SecretValue} from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import {PolicyDocument, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {Authorization, Connection} from "aws-cdk-lib/aws-events";
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment";
import {AttributeType, StreamViewType, Table} from "aws-cdk-lib/aws-dynamodb";
import {CfnPipe} from "aws-cdk-lib/aws-pipes";
import {LogGroup, RetentionDays} from "aws-cdk-lib/aws-logs";

export class AwsAutomationStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // -- DynamoDB Table --
        const dataTable = new Table(this, 'MyStepFunctionsDataTable', {
            tableName: 'my-step-functions-dynamodb-table',
            partitionKey: {
                name: 'id',
                type: AttributeType.STRING,
            },
            stream: StreamViewType.NEW_AND_OLD_IMAGES,
            removalPolicy: RemovalPolicy.DESTROY,
        })

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

        new BucketDeployment(this, 'DeployPrompts', {
            sources: [Source.asset('./prompts')],
            destinationBucket: dataBucket,
            destinationKeyPrefix: 'prompts/'
        });

        const perplexityAPIConnection = new Connection(this, 'StateMachineAIPerplexityAPIConnection', {
            connectionName: 'perplexity',
            description: 'Connection for Perplexity access through REST',
            authorization: Authorization.apiKey('Authorization', SecretValue.secretsManager('perplexity-api-key')),
        });

        const perplexityConnectionAccessPolicy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    actions: ['events:RetrieveConnectionCredentials'],
                    resources: [perplexityAPIConnection.connectionArn]
                }),
                new PolicyStatement({
                    actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
                    resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:events!connection/*`]
                })
            ]
        });

        const httpEndpointPolicy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    actions: ['states:InvokeHTTPEndpoint'],
                    resources: ['*']
                })
            ]
        })

        // -- Step Functions Role --
        const stateMachineRole = new Role(this, 'StateMachineAIRole', {
            assumedBy: new ServicePrincipal('states.amazonaws.com'),
            inlinePolicies: {
                S3AccessPolicy: s3AccessPolicy,
                perplexityConnectionAccessPolicy: perplexityConnectionAccessPolicy,
                httpEndpointPolicy: httpEndpointPolicy
            }
        });

        // -- Step Functions Workflow --
        const workflow = new StateMachine(this, 'MyStepFunctionsWorkflow', {
            stateMachineName: 'MyStepFunctionsWorkflow',
            role: stateMachineRole,
            definitionBody: DefinitionBody.fromFile('statemachine/definition.asl.json'),
            definitionSubstitutions: {
                DataBucketName: dataBucket.bucketName,
                PerplexityConnectionArn: perplexityAPIConnection.connectionArn,
            }
        });

        // -- EventBridge Pipe Role --
        const pipeLogGroup = new LogGroup(this, 'PipeLogGroup', {
            logGroupName: '/aws/pipes/dynamodb-to-stepfunctions-pipe-log-group',
            retention: RetentionDays.FIVE_DAYS,
            removalPolicy: RemovalPolicy.DESTROY,
        })

        const pipeRole = new Role(this, 'MyStepFunctionsPipeRole', {
            assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
            inlinePolicies: {
                DynamoStreamAccess: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator',
                                'dynamodb:ListStreams'],
                            resources: [dataTable.tableStreamArn!]
                        })
                    ]
                }),
                StepFunctionArn: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['states:StartExecution'],
                            resources: [workflow.stateMachineArn]
                        }),
                        new PolicyStatement({
                            actions: ['iam:PassRole'],
                            resources: [stateMachineRole.roleArn]
                        })
                    ]
                }),
                LogsAccess: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                            resources: [pipeLogGroup.logGroupArn]
                        })
                    ]
                }),
            }
        });

        const pipe = new CfnPipe(this, 'DynamoToStepFunctionsPipe', {
            roleArn: pipeRole.roleArn,
            source: dataTable.tableStreamArn!,
            target: workflow.stateMachineArn,
            targetParameters: {
                stepFunctionStateMachineParameters: {
                    invocationType: 'FIRE_AND_FORGET'
                }
            },
            sourceParameters: {
                dynamoDbStreamParameters: {
                    batchSize: 1,
                    startingPosition: 'LATEST'
                },
                filterCriteria: {
                    filters: [{
                        pattern: JSON.stringify({eventName: ['INSERT']})
                    }]
                }
            },
            logConfiguration: {
                cloudwatchLogsLogDestination: {
                    logGroupArn: pipeLogGroup.logGroupArn
                },
                level: 'INFO'
            }
        });

        // -- CloudFormation Outputs --
        new CfnOutput(this, 'CFOutputStateMachineArn', {
            value: workflow.stateMachineArn
        });

        new CfnOutput(this, 'CFNOutputPipeArn', {
            value: pipe.attrArn
        });

    }
}
