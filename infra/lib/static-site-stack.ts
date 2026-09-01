import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Interim static hosting via S3 static website hosting (plain HTTP, no custom
 * domain/TLS, no WAF in front — S3 website endpoints don't support any of
 * those). Swap this for CdnStack (CloudFront) once the AWS account is
 * verified for CloudFront and the CDN stack can deploy.
 */
export class StaticSiteStack extends Stack {
  readonly siteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.siteBucket = new s3.Bucket(this, 'MechProSiteBucket', {
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html', // SPA fallback for client-side routing
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
      // Windows installer is published separately by CI into downloads/.
      exclude: ['downloads/*'],
    });

    new CfnOutput(this, 'SiteUrl', { value: this.siteBucket.bucketWebsiteUrl });
    new CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
  }
}
