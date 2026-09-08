#Requires -Version 5.1
<#
.SYNOPSIS
  Full MechPro AWS CDK deploy (local), matching CI contexts.

.DESCRIPTION
  Prerequisites:
  1. aws login --profile mechpro  (admin/deploy-capable identity)
  2. DIAGNOSTICS_CAPABILITY_SECRET env var OR -DiagnosticsSecret
  3. If GitHub Actions OIDC fails with AssumeRoleWithWebIdentity, paste
     infra/oidc-trust-policy.mechpro-dispatch.json onto
     MechProGitHubActionsDeployRole Trust relationships in IAM.

.EXAMPLE
  $env:AWS_PROFILE = 'mechpro'
  $env:DIAGNOSTICS_CAPABILITY_SECRET = '...'
  ./scripts/deploy-aws.ps1
#>
param(
  [string]$Profile = $(if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { 'mechpro' }),
  [string]$DiagnosticsSecret = $env:DIAGNOSTICS_CAPABILITY_SECRET,
  [string]$Repository = 'tinytim3271-wq/mechpro-dispatch',
  [switch]$SkipCdn,
  [switch]$SynthOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $DiagnosticsSecret) {
  throw 'Set DIAGNOSTICS_CAPABILITY_SECRET or pass -DiagnosticsSecret (never use the public mechpro-dev-diagnostics-capability-v1 value in production).'
}

$env:AWS_PROFILE = $Profile
Write-Host "Using AWS profile: $Profile"
aws sts get-caller-identity | Out-Host

$cdkArgs = @(
  '--require-approval', 'never',
  '--strict',
  '-c', 'enableCustomDomain=true',
  '-c', "githubRepository=$Repository",
  '-c', "diagnosticsCapabilitySecret=$DiagnosticsSecret"
)
if ($SkipCdn) {
  $cdkArgs += @('-c', 'skipCdn=true')
}

Push-Location (Join-Path $root 'infra')
try {
  npm ci

  if ($SynthOnly) {
    & npx cdk synth --strict `
      -c allowDevDiagnosticsSecret=true `
      -c "githubRepository=$Repository"
    return
  }

  & npx cdk deploy --all @cdkArgs --outputs-file cdk-outputs.json

  Set-Location $root
  npm ci
  npm run build:web

  Set-Location (Join-Path $root 'infra')
  $stacks = @('MechProStaticSiteStack')
  if (-not $SkipCdn) { $stacks += 'MechProCdnStack' }
  & npx cdk deploy @stacks @cdkArgs
}
finally {
  Set-Location $root
}

Write-Host 'Deploy finished. Outputs: infra/cdk-outputs.json'
