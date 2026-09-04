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
    const vehicleDecodeFn = nodeFn('VehicleDecodeFn', 'vehicles/decode.ts');
    const payrollSyncFn = nodeFn('PayrollSyncFn', 'payroll/sync.ts');
    const taxReportFn = nodeFn('TaxReportFn', 'tax/report.ts');
    const onboardingFn = nodeFn('OnboardingFn', 'onboarding/start.ts');
    const adminAccountsFn = new lambda.Function(this, 'AdminAccountsFn', {
      code: bundledLambdaCode(path.join(__dirname, '..', 'lambda', 'admin/accounts.ts')),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(15),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: { TABLE_NAME: props.table.tableName, USER_POOL_ID: props.userPool.userPoolId },
    });
    const checkoutFn = nodeFn('CheckoutFn', 'payments/checkout.ts');
    const entitlementFn = nodeFn('SubscriptionEntitlementFn', 'subscription/entitlement.ts');
    const diagnosticsCoverageFn = nodeFn('DiagnosticsCoverageFn', 'diagnostics/coverage.ts');
    const diagnosticsAuditFn = nodeFn('DiagnosticsAuditFn', 'diagnostics/audit.ts');
    const diagnosticsAuthFn = nodeFn('DiagnosticsAuthFn', 'diagnostics/auth-proxy.ts');
    const webhookFn = nodeFn('StripeWebhookFn', 'payments/webhook.ts');
    const assistantFn = nodeFn('AssistantFn', 'ai/assistant.ts');
    assistantFn.addEnvironment('BEDROCK_MODEL_ID', 'us.amazon.nova-lite-v1:0');
    const agentPhoneWebhookFn = nodeFn('AgentPhoneWebhookFn', 'ai/agentphone-webhook.ts');
    agentPhoneWebhookFn.addEnvironment('BEDROCK_MODEL_ID', 'us.amazon.nova-lite-v1:0');
    const agentPhoneConfigureFn = nodeFn('AgentPhoneConfigureFn', 'ai/agentphone-configure.ts');
    agentPhoneConfigureFn.addEnvironment('API_URL', 'https://njz0co209l.execute-api.us-east-1.amazonaws.com');
    const presignCode = bundledLambdaCode(path.join(__dirname, '..', 'lambda', 'files/presign.ts'));
    const presignEnv = {
      TABLE_NAME: props.table.tableName,
      FILES_BUCKET_NAME: props.filesBucket.bucketName,
    };
    const presignUploadFn = new lambda.Function(this, 'PresignUploadFn', {
      code: presignCode,
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: presignEnv,
    });
    const presignDownloadFn = new lambda.Function(this, 'PresignDownloadFn', {
      code: presignCode,
      handler: 'index.getHandler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: presignEnv,
    });
    props.filesBucket.grantPut(presignUploadFn);
    props.filesBucket.grantRead(presignDownloadFn);
    for (const fn of [presignUploadFn, presignDownloadFn]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [props.table.tableArn],
      }));
    }

    for (const fn of [entitiesFn, vehicleDecodeFn, payrollSyncFn, taxReportFn, checkoutFn, diagnosticsAuditFn]) {
      props.table.grantReadWriteData(fn);
    }
    for (const fn of [diagnosticsCoverageFn, diagnosticsAuthFn]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [props.table.tableArn],
      }));
    }
    props.table.grantReadData(assistantFn);
    props.table.grantReadWriteData(agentPhoneWebhookFn);
    assistantFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    agentPhoneWebhookFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    agentPhoneWebhookFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:mechpro/*`],
    }));
    agentPhoneWebhookFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [props.table.tableArn],
    }));
    agentPhoneConfigureFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:mechpro/*`],
    }));
    agentPhoneConfigureFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [props.table.tableArn],
    }));
    onboardingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:BatchWriteItem', 'dynamodb:PutItem'],
      resources: [props.table.tableArn],
    }));
    props.table.grantReadData(entitlementFn);
    adminAccountsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:UpdateItem',
        'dynamodb:TransactWriteItems',
      ],
      resources: [props.table.tableArn, `${props.table.tableArn}/index/*`],
    }));
    adminAccountsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminResetUserPassword',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminUserGlobalSignOut',
        'cognito-idp:ListUsers',
      ],
      resources: [props.userPool.userPoolArn],
    }));
    webhookFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
      resources: [props.table.tableArn],
    }));

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
        // Browser SPA + local/dev origins. Bearer tokens still required on routes.
        allowOrigins: [
          'https://www.yourcarguy806.com',
          'https://yourcarguy806.com',
          'http://127.0.0.1:3000',
          'http://localhost:3000',
        ],
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
    authorizedRoute('/vehicles/decode/{vin}', [apigwv2.HttpMethod.GET], vehicleDecodeFn);
    authorizedRoute('/diagnostics/coverage', [apigwv2.HttpMethod.GET], diagnosticsCoverageFn);
    authorizedRoute('/diagnostics/coverage/bundle', [apigwv2.HttpMethod.GET], diagnosticsCoverageFn);
    authorizedRoute('/diagnostics/audit', [apigwv2.HttpMethod.POST], diagnosticsAuditFn);
    authorizedRoute('/diagnostics/authorize', [apigwv2.HttpMethod.POST], diagnosticsAuthFn);
    authorizedRoute('/admin/accounts', [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], adminAccountsFn);
    authorizedRoute('/admin/accounts/{username}/reset-password', [apigwv2.HttpMethod.POST], adminAccountsFn);
    authorizedRoute('/admin/accounts/{username}/set-password', [apigwv2.HttpMethod.POST], adminAccountsFn);
    authorizedRoute('/admin/accounts/{shopId}/credits', [apigwv2.HttpMethod.POST], adminAccountsFn);
    authorizedRoute('/admin/accounts/{shopId}/status', [apigwv2.HttpMethod.POST], adminAccountsFn);
    authorizedRoute('/payroll/sync', [apigwv2.HttpMethod.POST], payrollSyncFn);
    authorizedRoute('/tax-report', [apigwv2.HttpMethod.GET], taxReportFn);
    authorizedRoute('/onboarding/start', [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], onboardingFn);
    authorizedRoute('/payments/checkout-session', [apigwv2.HttpMethod.POST], checkoutFn);
    authorizedRoute('/subscription/entitlement', [apigwv2.HttpMethod.GET], entitlementFn);
    authorizedRoute('/ai/assistant', [apigwv2.HttpMethod.POST], assistantFn);
    authorizedRoute('/agentphone/configure', [apigwv2.HttpMethod.POST], agentPhoneConfigureFn);
    authorizedRoute('/files/presign-upload', [apigwv2.HttpMethod.POST], presignUploadFn);
    authorizedRoute('/files/presign-download', [apigwv2.HttpMethod.GET], presignDownloadFn);

    // Stripe calls this directly; it verifies the Stripe-Signature header itself instead of using the Cognito authorizer.
    this.httpApi.addRoutes({
      path: '/payments/webhook/{shopId}',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('StripeWebhookIntegration', webhookFn),
    });
    this.httpApi.addRoutes({
      path: '/agentphone/webhook/{shopId}',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('AgentPhoneWebhookIntegration', agentPhoneWebhookFn),
    });
    // Note: AWS WAF does not support API Gateway HTTP APIs (v2) as an attachment target
    // (only REST APIs, ALB, CloudFront, AppSync, Cognito, App Runner). The CLOUDFRONT-scoped
    // WebACL from MechProWafStack will front this API once traffic is routed through CloudFront.

    const functions = [
      entitiesFn,
      vehicleDecodeFn,
      payrollSyncFn,
      taxReportFn,
      onboardingFn,
      adminAccountsFn,
      checkoutFn,
      entitlementFn,
      diagnosticsCoverageFn,
      diagnosticsAuditFn,
      diagnosticsAuthFn,
      webhookFn,
      assistantFn,
      agentPhoneWebhookFn,
      agentPhoneConfigureFn,
      presignUploadFn,
      presignDownloadFn,
    ];
    for (const fn of functions) {
      const logGroup = fn.node.findChild('LogGroup') as logs.LogGroup;
      const resource = logGroup.node.defaultChild as logs.CfnLogGroup;
      resource.retentionInDays = logs.RetentionDays.ONE_MONTH;
    }
    const aggregateFunctions = functions.filter(fn => fn !== onboardingFn && fn !== assistantFn && fn !== agentPhoneWebhookFn && fn !== agentPhoneConfigureFn);
    const sumMetrics = (metricName: string, metric: (fn: lambda.Function) => cloudwatch.IMetric) => {
      const chunkSize = 10;
      const chunks: cloudwatch.IMetric[] = [];
      for (let offset = 0; offset < aggregateFunctions.length; offset += chunkSize) {
        const slice = aggregateFunctions.slice(offset, offset + chunkSize);
        chunks.push(new cloudwatch.MathExpression({
          expression: slice.map((_, index) => `${metricName}${offset + index}`).join(' + '),
          usingMetrics: Object.fromEntries(slice.map((fn, index) => [`${metricName}${offset + index}`, metric(fn)])),
          period: Duration.minutes(1),
        }));
      }
      if (chunks.length === 1) return chunks[0];
      return new cloudwatch.MathExpression({
        expression: chunks.map((_, index) => `${metricName}Chunk${index}`).join(' + '),
        usingMetrics: Object.fromEntries(chunks.map((chunk, index) => [`${metricName}Chunk${index}`, chunk])),
        period: Duration.minutes(1),
      });
    };
    const invocations = sumMetrics('invocations', fn => fn.metricInvocations({ period: Duration.minutes(1) }));
    const errors = sumMetrics('errors', fn => fn.metricErrors({ period: Duration.minutes(1) }));

    const makeChunkedAlarm = (
      id: string,
      alarmName: string,
      metric: (fn: lambda.Function) => cloudwatch.IMetric,
    ): cloudwatch.IAlarm => {
      const chunkSize = 10;
      const chunkAlarms: cloudwatch.Alarm[] = [];
      for (let offset = 0; offset < aggregateFunctions.length; offset += chunkSize) {
        const slice = aggregateFunctions.slice(offset, offset + chunkSize);
        const expr = new cloudwatch.MathExpression({
          expression: slice.map((_, i) => `m${offset + i}`).join(' + '),
          usingMetrics: Object.fromEntries(slice.map((fn, i) => [`m${offset + i}`, metric(fn)])),
          period: Duration.minutes(1),
        });
        chunkAlarms.push(new cloudwatch.Alarm(this, `${id}Chunk${offset}`, {
          metric: expr,
          threshold: 1,
          evaluationPeriods: 3,
          datapointsToAlarm: 2,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          ...(offset === 0 && aggregateFunctions.length <= chunkSize ? { alarmName } : {}),
        }));
      }
      if (chunkAlarms.length === 1) return chunkAlarms[0];
      return new cloudwatch.CompositeAlarm(this, id, {
        compositeAlarmName: alarmName,
        alarmRule: cloudwatch.AlarmRule.anyOf(...chunkAlarms),
      });
    };
    const lambdaErrorAlarm = makeChunkedAlarm(
      'LambdaErrorAlarm',
      'MechPro-Api-Lambda-Errors',
      fn => fn.metricErrors({ period: Duration.minutes(1) }),
    );
    const lambdaThrottleAlarm = makeChunkedAlarm(
      'LambdaThrottleAlarm',
      'MechPro-Api-Lambda-Throttles',
      fn => fn.metricThrottles({ period: Duration.minutes(1) }),
    );
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
        left: [invocations, onboardingFn.metricInvocations({ period: Duration.minutes(1), label: 'Onboarding invocations' })],
        right: [errors, onboardingFn.metricErrors({ period: Duration.minutes(1), label: 'Onboarding errors' })],
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
