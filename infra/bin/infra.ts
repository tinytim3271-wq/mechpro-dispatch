#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { StaticSiteStack } from '../lib/static-site-stack';
import { CdnStack } from '../lib/cdn-stack';
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

// Private staging bucket for CI; public traffic goes through CloudFront when the account is verified.
const staticSiteStack = new StaticSiteStack(app, 'MechProStaticSiteStack', { env });

// CloudFront may be blocked until AWS verifies the account. Skip with -c skipCdn=true.
const skipCdn = String(app.node.tryGetContext('skipCdn')).toLowerCase() === 'true';
let cdnStack: CdnStack | undefined;
if (!skipCdn) {
  cdnStack = new CdnStack(app, 'MechProCdnStack', {
    env,
    domainName: String(app.node.tryGetContext('enableCustomDomain')).toLowerCase() === 'true'
      ? 'www.yourcarguy806.com'
      : undefined,
  });
}

const githubRepository = app.node.tryGetContext('githubRepository');
if (githubRepository) {
  const publishBuckets: s3.IBucket[] = [staticSiteStack.siteBucket];
  if (cdnStack) publishBuckets.push(cdnStack.siteBucket);
  new GitHubActionsStack(app, 'MechProGitHubActionsStack', {
    env,
    repository: githubRepository,
    subject: app.node.tryGetContext('githubSubject'),
    siteBuckets: publishBuckets,
  });
}
