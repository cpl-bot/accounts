#!/usr/bin/env bash

set -eu

script_dir="$(cd "$(dirname "$0")" && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  echo "SELF-TEST FAILED: $1" >&2
  exit 1
}

bash "$script_dir/role-claim.sh" --help >/dev/null || fail "claim help failed"
bash "$script_dir/preflight.sh" --help >/dev/null || fail "preflight help failed"

claim_output="$(ORCHESTRATOR_LOCK_ROOT="$tmp_dir" bash "$script_dir/role-claim.sh" claim \
  --assigned-by owner --harness codex --mode headless)"
claim_id="$(printf '%s\n' "$claim_output" | sed -n 's/^claim_id=//p' | head -1)"
[ -n "$claim_id" ] || fail "claim did not return an id"

if ORCHESTRATOR_LOCK_ROOT="$tmp_dir" bash "$script_dir/role-claim.sh" claim \
  --assigned-by owner --harness claude --mode headless >/dev/null 2>&1; then
  fail "duplicate claim succeeded"
fi

status_output="$(ORCHESTRATOR_LOCK_ROOT="$tmp_dir" bash "$script_dir/role-claim.sh" status)"
printf '%s\n' "$status_output" | grep -q "claim_id=$claim_id" || fail "status lost claim metadata"

if ORCHESTRATOR_LOCK_ROOT="$tmp_dir" ORCHESTRATOR_CLAIM_ID=wrong \
  bash "$script_dir/role-claim.sh" transfer --harness claude \
    --to-workspace workspace:2 --to-surface surface:2 >/dev/null 2>&1; then
  fail "wrong claim id transferred the role"
fi

transfer_output="$(ORCHESTRATOR_LOCK_ROOT="$tmp_dir" ORCHESTRATOR_CLAIM_ID="$claim_id" \
  bash "$script_dir/role-claim.sh" transfer --harness claude \
    --to-workspace workspace:2 --to-surface surface:2)"
successor_claim_id="$(printf '%s\n' "$transfer_output" | sed -n 's/^claim_id=//p' | head -1)"
[ -n "$successor_claim_id" ] || fail "transfer did not return a successor claim id"

if ORCHESTRATOR_LOCK_ROOT="$tmp_dir" ORCHESTRATOR_CLAIM_ID="$claim_id" \
  bash "$script_dir/role-claim.sh" release >/dev/null 2>&1; then
  fail "predecessor released the transferred role"
fi

if ORCHESTRATOR_LOCK_ROOT="$tmp_dir" ORCHESTRATOR_CLAIM_ID=wrong \
  bash "$script_dir/role-claim.sh" release >/dev/null 2>&1; then
  fail "wrong claim id released the role"
fi

ORCHESTRATOR_LOCK_ROOT="$tmp_dir" ORCHESTRATOR_CLAIM_ID="$successor_claim_id" \
  bash "$script_dir/role-claim.sh" release >/dev/null

[ ! -d "$tmp_dir/project-orchestrator.lock" ] || fail "release left the lock behind"

bash "$script_dir/preflight.sh" --role builder --allow-no-cmux >/dev/null \
  || fail "builder preflight failed inside a worktree"

if bash "$script_dir/preflight.sh" --role orchestrator --allow-no-cmux >/dev/null 2>&1; then
  fail "orchestrator preflight accepted a linked worktree"
fi

echo "project-orchestrator scripts: PASS"
