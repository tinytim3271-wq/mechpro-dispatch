# MechPro CDK infrastructure

TypeScript CDK app for DynamoDB, Cognito, API Gateway, Lambda, S3, CloudFront, and the GitHub Actions OIDC deploy role.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## GitHub Actions OIDC bootstrap

CI assumes `MechProGitHubActionsDeployRole` via OIDC from jobs that target the GitHub Actions `production` environment. If `deploy` or `publish-download` fails with `Could not assume role with OIDC`, the live IAM trust policy is out of sync with the `repo:OWNER/REPO:environment:production` token subject those jobs emit.

Run once with admin AWS credentials (local profile or CloudShell), then re-run the failed workflows:

```bash
chmod +x infra/scripts/bootstrap-github-oidc-trust.sh
GITHUB_REPOSITORY=tinytim3271-wq/mechpro-dispatch ./infra/scripts/bootstrap-github-oidc-trust.sh
```

This temporarily widens trust to `repo:OWNER/REPO:*` so the next successful `cdk deploy` can reconcile the role back to the production-environment subject in `infra/lib/github-actions-stack.ts`.

Optional repository variable `SITE_BUCKET_NAME` skips CloudFormation bucket lookup in the Windows `publish-download` job.
