import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubActionsStackProps extends StackProps {
  repository: string;
  subject?: string;
}

export class GitHubActionsStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubActionsStackProps) {
    super(scope, id, props);

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(props.repository)) {
      throw new Error('githubRepository must use the owner/repository format');
    }

    const provider = new iam.OpenIdConnectProvider(this, 'GitHubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const principal = new iam.OpenIdConnectPrincipal(provider).withConditions({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      },
      StringLike: {
        'token.actions.githubusercontent.com:sub': props.subject ?? `repo:${props.repository}:environment:production`,
      },
    });
    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'MechProGitHubActionsDeployRole',
      assumedBy: principal,
      description: `CDK deployment role for ${props.repository} main branch`,
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`],
    }));

    new CfnOutput(this, 'RoleArn', { value: role.roleArn });
  }
}
