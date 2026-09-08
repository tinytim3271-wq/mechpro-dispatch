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
        // Mutable so shop admins can change roles; API still trusts JWT claims only.
        // Employee role updates should sync via AdminUpdateUserAttributes (entities handler).
        role: new cognito.StringAttribute({ minLen: 1, maxLen: 32, mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      // MFA is OPTIONAL at the pool (Cognito cannot require it only for admins).
      // Shop policy: require TOTP enrollment for admin / super_admin before production cutover.
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

    // USER_SRP_AUTH is enabled for clients that support SRP. USER_PASSWORD_AUTH remains
    // for the vanilla SPA (no Amplify/SRP SDK) until the web client migrates to SRP-only.
    this.userPoolClient = this.userPool.addClient('MechProSpaClient', {
      authFlows: { userSrp: true, userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: undefined,
      enableTokenRevocation: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
