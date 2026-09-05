import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { APP_ALLOWED_ORIGINS } from './allowed-origins';

/**
 * Multi-tenant single-table DynamoDB design plus private S3 storage for
 * shop-uploaded files (customer signatures, generated estimate documents).
 *
 * Table key shape:
 *   pk = SHOP#<shopId>
 *   sk = <ENTITY>#<id>            e.g. CUSTOMER#123, INVOICE#INV-2041, SETTINGS#tax
 *   gsi1pk = SHOP#<shopId>#TYPE#<ENTITY>
 *   gsi1sk = <sortableValue>#<id> e.g. date/status prefixed, for list views per entity type
 */
export class DataStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly filesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, 'MechProTable', {
      tableName: 'mechpro-data',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    this.filesBucket = new s3.Bucket(this, 'MechProFiles', {
      bucketName: undefined, // let CloudFormation generate a globally-unique name
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: APP_ALLOWED_ORIGINS,
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'expire-noncurrent-versions',
          noncurrentVersionExpiration: Duration.days(90),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
