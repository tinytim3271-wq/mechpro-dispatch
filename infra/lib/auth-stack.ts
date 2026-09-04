import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * Cognito user pool for MechPro employee logins, replacing the plaintext
 * client-side password check. Each user carries a shopId custom attribute so
 * a single pool can serve multiple subscribing shops (multi-tenant), and a
 * Cognito group per job role (admin / technician / office / service_writer)
 * for coarse-grained authorization enforced again in the API layer per shop.
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'MechProUserPool', {
      userPoolName: 'mechpro-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        shopId: new cognito.StringAttribute({ minLen: 1, maxLen: 64, mutable: false }),
        // Role is admin-API-only. Existing pools keep mutability; SPA writeAttributes
        // below prevent clients from elevating their own custom:role claim.
        role: new cognito.StringAttribute({ minLen: 1, maxLen: 32, mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    for (const groupName of ['super_admin', 'admin', 'technician', 'office', 'service_writer']) {
      new cognito.CfnUserPoolGroup(this, `${groupName}Group`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
      });
    }

    this.userPoolClient = this.userPool.addClient('MechProSpaClient', {
      authFlows: { userSrp: true, userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: undefined,
      // SPA may update profile fields only — never custom:shopId / custom:role.
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, fullname: true, emailVerified: true })
        .withCustomAttributes('shopId', 'role'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, fullname: true }),
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
