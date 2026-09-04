#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/windows"
EXE="$DIST/MechPro-Setup-1.0.0.exe"
ZIP="$DIST/MechPro-Setup-1.0.0.zip"

for file in "$EXE" "$ZIP"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing $file — run npm run build:windows on Windows first." >&2
    exit 1
  fi
done

resolve_output() {
  local stack="$1" key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" \
    --output text 2>/dev/null || true
}

BUCKET="$(resolve_output MechProCdnStack SiteBucketName)"
if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  BUCKET="$(resolve_output MechProStaticSiteStack SiteBucketName)"
fi
if [[ -z "$BUCKET" || "$BUCKET" == "None" ]]; then
  echo "Could not resolve site bucket from CloudFormation outputs." >&2
  exit 1
fi

echo "Publishing to s3://$BUCKET/downloads/"
aws s3 cp "$EXE" "s3://$BUCKET/downloads/MechPro-Setup-1.0.0.exe" --content-type application/octet-stream --cache-control "public, max-age=300"
aws s3 cp "$ZIP" "s3://$BUCKET/downloads/MechPro-Setup-1.0.0.zip" --content-type application/zip --cache-control "public, max-age=300"

DIST_ID="$(resolve_output MechProCdnStack DistributionId)"
if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/downloads/*"
fi

echo "Done."
