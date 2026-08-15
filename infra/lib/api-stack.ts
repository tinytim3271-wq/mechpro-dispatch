import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import { bundledLambdaCode } from './esbuild-asset';

export interface ApiStackProps extends StackProps {
  table: dynamodb.Table;
  filesBucket: s3.Bucket;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
}

export class ApiStack extends Stack {
  public readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const nodeFn = (name: string, entry: string) =>
      new lambda.Function(this, name, {
        code: bundledLambdaCode(path.join(__dirname, '..', 'lambda', entry)),
        handler: 'index.handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: Duration.seconds(10),
        memorySize: 256,
        tracing: lambda.Tracing.ACTIVE,
        environment: { TABLE_NAME: props.table.tableName },
      });

    const entitiesFn = nodeFn('EntitiesFn', 'entities/handler.ts');
    const payrollSyncFn = nodeFn('PayrollSyncFn', 'payroll/sync.ts');
    const taxReportFn = nodeFn('TaxReportFn', 'tax/report.ts');
    const checkoutFn = nodeFn('CheckoutFn', 'payments/checkout.ts');
    const webhookFn = nodeFn('StripeWebhookFn', 'payments/webhook.ts');
    const presignCode = bundledLambdaCode(path.join(__dirname, '..', 'lambda', 'files/presign.ts'));
    const presignUploadFn = new lambda.Function(this, 'PresignUploadFn', {
      code: presignCode,
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: { FILES_BUCKET_NAME: props.filesBucket.bucketName },
    });
    const presignDownloadFn = new lambda.Function(this, 'PresignDownloadFn', {
      code: presignCode,
      handler: 'index.getHandler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: { FILES_BUCKET_NAME: props.filesBucket.bucketName },
    });
    props.filesBucket.grantPut(presignUploadFn);
    props.filesBucket.grantRead(presignDownloadFn);

    for (const fn of [entitiesFn, payrollSyncFn, taxReportFn, checkoutFn]) {
      props.table.grantReadWriteData(fn);
    }
    props.table.grantReadData(webhookFn);

    const secretsReadPolicy = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:mechpro/*`],
    });
    checkoutFn.addToRolePolicy(secretsReadPolicy);
    webhookFn.addToRolePolicy(secretsReadPolicy);

    this.httpApi = new apigwv2.HttpApi(this, 'MechProHttpApi', {
      apiName: 'mechpro-api',
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type', 'If-Match'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowOrigins: ['*'], // tighten to the deployed CloudFront domain once known
      },
    });

    const authorizer = new HttpJwtAuthorizer('CognitoAuthorizer', props.userPool.userPoolProviderUrl, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    });

    const authorizedRoute = (path_: string, methods: apigwv2.HttpMethod[], fn: lambda.IFunction) => {
      this.httpApi.addRoutes({
        path: path_,
        methods,
        integration: new HttpLambdaIntegration(`${path_}Integration`, fn),
        authorizer,
      });
    };

    authorizedRoute('/entities/{type}', [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], entitiesFn);
    authorizedRoute('/entities/{type}/{id}', [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE], entitiesFn);
    authorizedRoute('/payroll/sync', [apigwv2.HttpMethod.POST], payrollSyncFn);
    authorizedRoute('/tax-report', [apigwv2.HttpMethod.GET], taxReportFn);
    authorizedRoute('/payments/checkout-session', [apigwv2.HttpMethod.POST], checkoutFn);
    authorizedRoute('/files/presign-upload', [apigwv2.HttpMethod.POST], presignUploadFn);
    authorizedRoute('/files/presign-download', [apigwv2.HttpMethod.GET], presignDownloadFn);

    // Stripe calls this directly; it verifies the Stripe-Signature header itself instead of using the Cognito authorizer.
    this.httpApi.addRoutes({
      path: '/payments/webhook/{shopId}',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('StripeWebhookIntegration', webhookFn),
    });
    // Note: AWS WAF does not support API Gateway HTTP APIs (v2) as an attachment target
    // (only REST APIs, ALB, CloudFront, AppSync, Cognito, App Runner). The CLOUDFRONT-scoped
    // WebACL from MechProWafStack will front this API once traffic is routed through CloudFront.

    const functions = [
      entitiesFn,
      payrollSyncFn,
      taxReportFn,
      checkoutFn,
      webhookFn,
      presignUploadFn,
      presignDownloadFn,
    ];
    for (const fn of functions) {
      const logGroup = fn.node.findChild('LogGroup') as logs.LogGroup;
      const resource = logGroup.node.defaultChild as logs.CfnLogGroup;
      resource.retentionInDays = logs.RetentionDays.ONE_MONTH;
    }
    const sumMetrics = (metricName: string, metric: (fn: lambda.Function) => cloudwatch.IMetric) =>
      new cloudwatch.MathExpression({
        expression: functions.map((_, index) => `${metricName}${index}`).join(' + '),
        usingMetrics: Object.fromEntries(functions.map((fn, index) => [`${metricName}${index}`, metric(fn)])),
        period: Duration.minutes(1),
      });
    const invocations = sumMetrics('invocations', fn => fn.metricInvocations({ period: Duration.minutes(1) }));
    const errors = sumMetrics('errors', fn => fn.metricErrors({ period: Duration.minutes(1) }));
    const throttles = sumMetrics('throttles', fn => fn.metricThrottles({ period: Duration.minutes(1) }));

    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'MechPro-Api-Lambda-Errors',
      metric: errors,
      threshold: 1,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const lambdaThrottleAlarm = new cloudwatch.Alarm(this, 'LambdaThrottleAlarm', {
      alarmName: 'MechPro-Api-Lambda-Throttles',
      metric: throttles,
      threshold: 1,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmName: 'MechPro-Api-5xx-Errors',
      metric: this.httpApi.metricServerError({ period: Duration.minutes(1) }),
      threshold: 1,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: 'MechPro-Api-Latency-P99',
      metric: this.httpApi.metricLatency({ statistic: 'p99', period: Duration.minutes(1) }),
      threshold: 3000,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'ApiDashboard', {
      dashboardName: 'MechPro-Api-Operations',
      start: '-PT8H',
      periodOverride: cloudwatch.PeriodOverride.INHERIT,
    });
    dashboard.addWidgets(
      new cloudwatch.TextWidget({ width: 24, height: 1, markdown: '# MechPro API health' }),
      new cloudwatch.AlarmWidget({ width: 6, height: 6, title: 'Lambda errors', alarm: lambdaErrorAlarm }),
      new cloudwatch.AlarmWidget({ width: 6, height: 6, title: 'Lambda throttles', alarm: lambdaThrottleAlarm }),
      new cloudwatch.AlarmWidget({ width: 6, height: 6, title: 'API 5xx', alarm: api5xxAlarm }),
      new cloudwatch.AlarmWidget({ width: 6, height: 6, title: 'API p99 latency', alarm: apiLatencyAlarm }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'Lambda invocations and errors',
        left: [invocations],
        right: [errors],
      }),
      new cloudwatch.GraphWidget({
        width: 12,
        height: 6,
        title: 'API requests and p99 latency',
        left: [this.httpApi.metricCount({ period: Duration.minutes(1) })],
        right: [this.httpApi.metricLatency({ statistic: 'p99', period: Duration.minutes(1) })],
      }),
    );

    new CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
