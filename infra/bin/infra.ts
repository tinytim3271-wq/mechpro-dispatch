#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { StaticSiteStack } from '../lib/static-site-stack';
import { GitHubActionsStack } from '../lib/github-actions-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };

const dataStack = new DataStack(app, 'MechProDataStack', { env });
const authStack = new AuthStack(app, 'MechProAuthStack', { env });

new ApiStack(app, 'MechProApiStack', {
  env,
  table: dataStack.table,
  filesBucket: dataStack.filesBucket,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

// Interim static hosting until the AWS account is verified for CloudFront (see MechProWafStack/MechProCdnStack, kept but not deployed).
new StaticSiteStack(app, 'MechProStaticSiteStack', { env });

const githubRepository = app.node.tryGetContext('githubRepository');
if (githubRepository) {
  new GitHubActionsStack(app, 'MechProGitHubActionsStack', {
    env,
    repository: githubRepository,
    subject: app.node.tryGetContext('githubSubject'),
  });
}
