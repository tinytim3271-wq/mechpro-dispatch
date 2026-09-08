import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CdnStackProps extends StackProps {
  /** Set via `-c domainName=www.yourcarguy806.com -c enableCustomDomain=true` once the domain's hosted zone exists in Route 53. */
  domainName?: string;
  webAclArn?: string;
}

export class CdnStack extends Stack {
  readonly siteBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);

    this.siteBucket = new s3.Bucket(this, 'MechProSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const hasCustomDomain = Boolean(props.domainName);
    let certificate: acm.ICertificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;

    if (hasCustomDomain) {
      hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName: props.domainName!.replace(/^www\./, '') });
      certificate = new acm.Certificate(this, 'SiteCertificate', {
        domainName: props.domainName!,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    this.distribution = new cloudfront.Distribution(this, 'MechProDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
      domainNames: hasCustomDomain ? [props.domainName!] : undefined,
      certificate,
      webAclId: props.webAclArn,
      // CloudFront ignores minimumProtocolVersion without a custom cert; omit it in that case so --strict synth stays clean.
      ...(hasCustomDomain
        ? { minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 }
        : {}),
    });

    if (hasCustomDomain && hostedZone) {
      new route53.ARecord(this, 'SiteAliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
      });
    }

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
        ],
      })],
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      // Windows installer is published separately by CI into downloads/.
      exclude: ['downloads/*'],
    });

    new CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'SiteUrl', { value: hasCustomDomain ? `https://${props.domainName}` : `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
  }
}
