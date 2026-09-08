# MechPro CDK infrastructure

TypeScript CDK app for DynamoDB, Cognito, API Gateway, Lambda, S3, CloudFront, and the GitHub Actions OIDC deploy role.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth -c allowDevDiagnosticsSecret=true`   local/CI template synth
* Production deploy requires `-c diagnosticsCapabilitySecret=...` (GitHub Actions secret `DIAGNOSTICS_CAPABILITY_SECRET`)

## Diagnostics capability secret

`/diagnostics/authorize` mints HMAC tokens for `clear_dtcs`. Never deploy with the public `mechpro-dev-diagnostics-capability-v1` fallback.

* Local/CI synth: `-c allowDevDiagnosticsSecret=true`
* Deploy: `-c diagnosticsCapabilitySecret=<long-random-value>` (set `DIAGNOSTICS_CAPABILITY_SECRET` in the GitHub `production` environment)
* Packaged desktop builds must use the same value via `MECHPRO_DIAG_CAPABILITY_SECRET`

## GitHub Actions OIDC trust

`MechProGitHubActionsDeployRole` trusts two GitHub OIDC `sub` claims:

- `repo:OWNER/REPO:ref:refs/heads/main` for the main-branch `deploy` job in `.github/workflows/deploy.yml`
- `repo:OWNER/REPO:environment:production` for environment-gated publish jobs (for example `publish-download` in `.github/workflows/windows-desktop.yml`)

This dual-subject trust avoids deployment lockouts when one workflow uses branch-ref tokens while another uses environment tokens.

Optional repository variable `SITE_BUCKET_NAME` skips CloudFormation bucket lookup in the Windows `publish-download` job.

## Cloudflare Pages (static PWA)

Path A hybrid: host the SPA on Cloudflare Pages while API/auth/AI remain on AWS.

1. Create a Pages project named `mechpro-dispatch` (or set `CLOUDFLARE_PAGES_PROJECT`).
2. Add GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Set repository variable `CLOUDFLARE_PAGES_ENABLED=true` to enable `.github/workflows/cloudflare-pages.yml`.
4. Allowlist `https://mechpro-dispatch.pages.dev` (already in `infra/lib/allowed-origins.ts`) plus any custom domain via `-c extraAllowedOrigins=https://...` on CDK deploy.
5. Add the Pages origin to Electron `trustedOrigins` (done for `mechpro-dispatch.pages.dev`).

