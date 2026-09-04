#!/usr/bin/env bash
# One-time bootstrap: widen MechProGitHubActionsDeployRole OIDC trust so GitHub
# Actions can assume the role again after MechProGitHubActionsStack narrowed it.
#
# Run with admin AWS credentials (not the GitHub Actions OIDC role):
#   GITHUB_REPOSITORY=tinytim3271-wq/mechpro-dispatch ./infra/scripts/bootstrap-github-oidc-trust.sh
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-tinytim3271-wq/mechpro-dispatch}"
ROLE_NAME="${GITHUB_ACTIONS_ROLE_NAME:-MechProGitHubActionsDeployRole}"
STACK_NAME="${GITHUB_ACTIONS_STACK_NAME:-MechProGitHubActionsStack}"
SUBJECT_PATTERN="${GITHUB_OIDC_SUBJECT:-repo:${REPO}:*}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

provider_arn="$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::IAM::OIDCProvider'].PhysicalResourceId | [0]" \
  --output text 2>/dev/null || true)"

if [[ -z "$provider_arn" || "$provider_arn" == "None" ]]; then
  provider_arn="$(aws iam list-open-id-connect-providers \
    --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" \
    --output text)"
fi

if [[ -z "$provider_arn" || "$provider_arn" == "None" ]]; then
  echo "Could not find GitHub OIDC provider in account." >&2
  exit 1
fi

trust_policy="$(mktemp)"
trap 'rm -f "$trust_policy"' EXIT

cat >"$trust_policy" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${provider_arn}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "${SUBJECT_PATTERN}"
        }
      }
    }
  ]
}
EOF

echo "Updating ${ROLE_NAME} trust policy:"
echo "  provider: ${provider_arn}"
echo "  subject:  ${SUBJECT_PATTERN}"
aws iam update-assume-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-document "file://${trust_policy}"

echo "Done. Re-run the Validate and deploy and Windows desktop release workflows on main."
