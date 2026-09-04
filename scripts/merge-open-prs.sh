#!/usr/bin/env bash
set -euo pipefail

DEFAULT_DRAFT_PRS="3,4,30,31,32,37,45"
DEFAULT_MERGE_PRS="1,3,4,30,31,32,37,42,45"
DEFAULT_MERGE_METHOD="merge"
DEFAULT_MAX_RETRIES=4
DEFAULT_RETRY_DELAY=2

DRAFT_PRS="${DRAFT_PRS:-$DEFAULT_DRAFT_PRS}"
MERGE_PRS="${MERGE_PRS:-$DEFAULT_MERGE_PRS}"
MERGE_METHOD="${MERGE_METHOD:-$DEFAULT_MERGE_METHOD}"
MAX_RETRIES="${MAX_RETRIES:-$DEFAULT_MAX_RETRIES}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-$DEFAULT_RETRY_DELAY}"
DRY_RUN=false

OWNER="${GITHUB_OWNER:-${OWNER:-}}"
REPO="${GITHUB_REPO:-${REPO:-}}"
if [[ -z "${OWNER}" || -z "${REPO}" ]]; then
  if [[ -n "${GITHUB_REPOSITORY:-}" && "${GITHUB_REPOSITORY}" == */* ]]; then
    OWNER="${GITHUB_REPOSITORY%%/*}"
    REPO="${GITHUB_REPOSITORY#*/}"
  fi
fi

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
API_BASE="${GITHUB_API_URL:-https://api.github.com}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Converts configured draft pull requests to ready-for-review, then merges configured open pull requests.

Required:
  --owner <owner>         GitHub repository owner (or set GITHUB_OWNER / GITHUB_REPOSITORY)
  --repo <repo>           GitHub repository name (or set GITHUB_REPO / GITHUB_REPOSITORY)
  --token <token>         GitHub token (or set GITHUB_TOKEN / GH_TOKEN)

Optional:
  --draft-prs <csv>       Draft PR numbers to convert (default: ${DEFAULT_DRAFT_PRS})
  --merge-prs <csv>       PR numbers to merge (default: ${DEFAULT_MERGE_PRS})
  --merge-method <method> merge|squash|rebase (default: ${DEFAULT_MERGE_METHOD})
  --max-retries <n>       Max retry attempts for transient failures (default: ${DEFAULT_MAX_RETRIES})
  --retry-delay <sec>     Delay between retry attempts in seconds (default: ${DEFAULT_RETRY_DELAY})
  --dry-run               Log operations without mutating pull requests
  --help                  Show this message

Examples:
  GITHUB_TOKEN=... GITHUB_REPOSITORY=tinytim3271-wq/mechpro-dispatch bash scripts/merge-open-prs.sh
  bash scripts/merge-open-prs.sh --owner tinytim3271-wq --repo mechpro-dispatch --token "\$GITHUB_TOKEN"
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner)
      OWNER="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --draft-prs)
      DRAFT_PRS="${2:-}"
      shift 2
      ;;
    --merge-prs)
      MERGE_PRS="${2:-}"
      shift 2
      ;;
    --merge-method)
      MERGE_METHOD="${2:-}"
      shift 2
      ;;
    --max-retries)
      MAX_RETRIES="${2:-}"
      shift 2
      ;;
    --retry-delay)
      RETRY_DELAY_SECONDS="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

log() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*"
}

require_non_empty() {
  local value="$1"
  local name="$2"
  if [[ -z "$value" ]]; then
    log ERROR "Missing required value: $name"
    exit 1
  fi
}

if [[ "$MERGE_METHOD" != "merge" && "$MERGE_METHOD" != "squash" && "$MERGE_METHOD" != "rebase" ]]; then
  log ERROR "Invalid merge method: $MERGE_METHOD"
  exit 1
fi

if ! [[ "$MAX_RETRIES" =~ ^[0-9]+$ ]]; then
  log ERROR "MAX_RETRIES must be a non-negative integer"
  exit 1
fi
if ! [[ "$RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  log ERROR "RETRY_DELAY_SECONDS must be a non-negative integer"
  exit 1
fi

require_non_empty "$OWNER" "owner"
require_non_empty "$REPO" "repo"
require_non_empty "$TOKEN" "token"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

API_LAST_STATUS=""
API_LAST_BODY=""

should_retry_status() {
  case "$1" in
    408|425|429|500|502|503|504) return 0 ;;
    *) return 1 ;;
  esac
}

api_request() {
  local method="$1"
  local endpoint="$2"
  local payload="${3:-}"
  local attempt=0

  while :; do
    attempt=$((attempt + 1))
    local body_file="$TMP_DIR/body-${RANDOM}.json"
    local status=""
    local curl_exit=0

    local args=(
      -sS
      --oauth2-bearer "$TOKEN"
      -X "$method"
      -H "Accept: application/vnd.github+json"
      -H "X-GitHub-Api-Version: 2022-11-28"
      "$API_BASE$endpoint"
      -o "$body_file"
      -w "%{http_code}"
    )

    if [[ -n "$payload" ]]; then
      args+=( -H "Content-Type: application/json" --data "$payload" )
    fi

    status="$(curl "${args[@]}")" || curl_exit=$?
    if [[ "$curl_exit" -ne 0 ]]; then
      status="000"
    fi

    API_LAST_STATUS="$status"
    API_LAST_BODY="$(cat "$body_file" 2>/dev/null || true)"
    rm -f "$body_file"

    if [[ "$curl_exit" -eq 0 ]] && ! should_retry_status "$status"; then
      return 0
    fi

    if [[ "$attempt" -le "$MAX_RETRIES" ]]; then
      if [[ "$curl_exit" -ne 0 ]]; then
        log WARN "Request failed (curl exit $curl_exit), retrying attempt $attempt/$MAX_RETRIES: $method $endpoint"
      else
        log WARN "Transient HTTP $status, retrying attempt $attempt/$MAX_RETRIES: $method $endpoint"
      fi
      sleep "$RETRY_DELAY_SECONDS"
      continue
    fi

    if [[ "$curl_exit" -ne 0 ]]; then
      log ERROR "Request failed after retries (curl exit $curl_exit): $method $endpoint"
    else
      log ERROR "Request failed after retries (HTTP $status): $method $endpoint"
    fi
    return 0
  done
}

json_field() {
  local json="$1"
  local field="$2"
  python3 - "$field" "$json" <<'PY'
import json
import sys

path = sys.argv[1].split('.')
raw = sys.argv[2]

try:
    data = json.loads(raw)
except Exception:
    print("")
    sys.exit(0)

cur = data
for part in path:
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        print("")
        sys.exit(0)

if isinstance(cur, bool):
    print("true" if cur else "false")
elif cur is None:
    print("")
else:
    print(cur)
PY
}

declare -i draft_converted=0
declare -i draft_already_ready=0
declare -i draft_skipped_closed=0
declare -i merge_success=0
declare -i merge_skipped_closed=0
declare -i total_failures=0
declare -a failure_details=()

record_failure() {
  local detail="$1"
  log ERROR "$detail"
  failure_details+=("$detail")
  total_failures=$((total_failures + 1))
}

normalize_pr_list() {
  local list_name="$1"
  local csv="$2"
  local -n output="$3"
  output=()

  IFS=',' read -r -a raw_values <<<"$csv"
  for raw in "${raw_values[@]}"; do
    local pr="${raw//[[:space:]]/}"
    if [[ -z "$pr" ]]; then
      continue
    fi
    if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
      log ERROR "Invalid PR number '$pr' in $list_name list"
      exit 1
    fi
    output+=("$pr")
  done
}

fetch_pr() {
  local pr="$1"
  api_request GET "/repos/$OWNER/$REPO/pulls/$pr"
  if [[ "$API_LAST_STATUS" != "200" ]]; then
    local message
    message="$(json_field "$API_LAST_BODY" message)"
    record_failure "PR #$pr fetch failed (HTTP $API_LAST_STATUS): ${message:-unknown error}"
    return 1
  fi
  return 0
}

convert_draft_pr() {
  local pr="$1"
  if ! fetch_pr "$pr"; then
    return
  fi

  local state draft
  state="$(json_field "$API_LAST_BODY" state)"
  draft="$(json_field "$API_LAST_BODY" draft)"

  if [[ "$state" != "open" ]]; then
    log INFO "PR #$pr is '$state'; skipping draft conversion"
    draft_skipped_closed=$((draft_skipped_closed + 1))
    return
  fi

  if [[ "$draft" != "true" ]]; then
    log INFO "PR #$pr is already ready for review"
    draft_already_ready=$((draft_already_ready + 1))
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log INFO "[dry-run] Would convert PR #$pr from draft to ready"
    draft_converted=$((draft_converted + 1))
    return
  fi

  api_request PATCH "/repos/$OWNER/$REPO/pulls/$pr" '{"draft": false}'
  if [[ "$API_LAST_STATUS" != "200" ]]; then
    local message
    message="$(json_field "$API_LAST_BODY" message)"
    record_failure "PR #$pr draft conversion failed (HTTP $API_LAST_STATUS): ${message:-unknown error}"
    return
  fi

  local updated_draft
  updated_draft="$(json_field "$API_LAST_BODY" draft)"
  if [[ "$updated_draft" != "false" ]]; then
    record_failure "PR #$pr draft conversion response invalid (expected draft=false)"
    return
  fi

  log INFO "Converted PR #$pr to ready for review"
  draft_converted=$((draft_converted + 1))
}

merge_pr() {
  local pr="$1"
  if ! fetch_pr "$pr"; then
    return
  fi

  local state
  state="$(json_field "$API_LAST_BODY" state)"
  if [[ "$state" != "open" ]]; then
    log INFO "PR #$pr is '$state'; skipping merge"
    merge_skipped_closed=$((merge_skipped_closed + 1))
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log INFO "[dry-run] Would merge PR #$pr using method '$MERGE_METHOD'"
    merge_success=$((merge_success + 1))
    return
  fi

  local payload
  payload="{\"merge_method\":\"$MERGE_METHOD\",\"commit_title\":\"Merge pull request #$pr\"}"
  api_request PUT "/repos/$OWNER/$REPO/pulls/$pr/merge" "$payload"

  if [[ "$API_LAST_STATUS" != "200" && "$API_LAST_STATUS" != "201" ]]; then
    local message
    message="$(json_field "$API_LAST_BODY" message)"
    record_failure "PR #$pr merge failed (HTTP $API_LAST_STATUS): ${message:-unknown error}"
    return
  fi

  local merged
  merged="$(json_field "$API_LAST_BODY" merged)"
  if [[ "$merged" != "true" ]]; then
    local message
    message="$(json_field "$API_LAST_BODY" message)"
    record_failure "PR #$pr merge API did not confirm merge: ${message:-no message}"
    return
  fi

  log INFO "Merged PR #$pr"
  merge_success=$((merge_success + 1))
}

log INFO "Starting PR automation for $OWNER/$REPO"
log INFO "Draft PRs: $DRAFT_PRS"
log INFO "Merge PRs: $MERGE_PRS"
log INFO "Dry run: $DRY_RUN"

declare -a DRAFT_PR_ARRAY=()
declare -a MERGE_PR_ARRAY=()
normalize_pr_list "draft-prs" "$DRAFT_PRS" DRAFT_PR_ARRAY
normalize_pr_list "merge-prs" "$MERGE_PRS" MERGE_PR_ARRAY

for pr in "${DRAFT_PR_ARRAY[@]}"; do
  log INFO "Processing draft conversion for PR #$pr"
  convert_draft_pr "$pr"
done

for pr in "${MERGE_PR_ARRAY[@]}"; do
  log INFO "Processing merge for PR #$pr"
  merge_pr "$pr"
done

echo
log INFO "Summary"
log INFO "  Drafts converted: $draft_converted"
log INFO "  Drafts already ready: $draft_already_ready"
log INFO "  Draft conversions skipped (not open): $draft_skipped_closed"
log INFO "  PRs merged: $merge_success"
log INFO "  Merges skipped (not open): $merge_skipped_closed"
log INFO "  Failures: $total_failures"

if [[ "$total_failures" -gt 0 ]]; then
  log ERROR "Failure details:"
  for failure in "${failure_details[@]}"; do
    log ERROR "  - $failure"
  done
  exit 1
fi

log INFO "All requested operations completed successfully"
