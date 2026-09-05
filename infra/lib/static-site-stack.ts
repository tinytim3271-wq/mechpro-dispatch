import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Private staging bucket for CI artifact publish. Public S3 website hosting
 * was retired — serve the SPA through CdnStack (CloudFront + OAC) only.
 */
export class StaticSiteStack extends Stack {
  readonly siteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.siteBucket = new s3.Bucket(this, 'MechProSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..'), {
        exclude: [
          'infra/**',
          'desktop/**',
          'dist/**',
          'downloads/**',
          'node_modules/**',
          'package.json',
          'package-lock.json',
          'docs/**',
          '.git/**',
          '.github/**',
          '.vscode/**',
          '.gitignore',
        ],
      })],
      destinationBucket: this.siteBucket,
      exclude: ['downloads/*'],
    });

    new CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
    new CfnOutput(this, 'SiteNote', {
      value: 'Public website hosting retired — use MechProCdnStack CloudFront URL',
    });
  }
}
