# MechPro CDK infrastructure

TypeScript CDK app for DynamoDB, Cognito, API Gateway, Lambda, S3, CloudFront, and the GitHub Actions OIDC deploy role.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## GitHub Actions OIDC trust

`MechProGitHubActionsDeployRole` trusts two GitHub OIDC `sub` claims:

- `repo:OWNER/REPO:ref:refs/heads/main` for the main-branch `deploy` job in `.github/workflows/deploy.yml`
- `repo:OWNER/REPO:environment:production` for environment-gated publish jobs (for example `publish-download` in `.github/workflows/windows-desktop.yml`)

This dual-subject trust avoids deployment lockouts when one workflow uses branch-ref tokens while another uses environment tokens.

Optional repository variable `SITE_BUCKET_NAME` skips CloudFormation bucket lookup in the Windows `publish-download` job.
