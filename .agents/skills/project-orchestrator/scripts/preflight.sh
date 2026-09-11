#!/usr/bin/env bash

set -u

usage() {
  cat <<'USAGE'
Usage: preflight.sh --role orchestrator|builder [--fetch] [--strict] [--allow-no-cmux]

Prints stable key=value state. Hard failures exit 2. Warnings exit 0 unless
--strict is supplied. The script never edits, stages, stashes, or commits files.
USAGE
}

role=""
fetch_first=0
strict=0
allow_no_cmux=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --role)
      role="${2:-}"
      shift 2
      ;;
    --fetch)
      fetch_first=1
      shift
      ;;
    --strict)
      strict=1
      shift
      ;;
    --allow-no-cmux)
      allow_no_cmux=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$role" in
  orchestrator|builder) ;;
  *)
    echo "--role orchestrator or --role builder is required." >&2
    exit 2
    ;;
esac

hard_failures=0
warnings=0

warn() {
  warnings=$((warnings + 1))
  printf 'warning=%s\n' "$1"
}

fail() {
  hard_failures=$((hard_failures + 1))
  printf 'failure=%s\n' "$1"
}

top="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "failure=not inside a Git repository"
  exit 2
}
common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  echo "failure=cannot resolve Git common directory"
  exit 2
}
main_root="$(dirname "$common_dir")"
branch="$(git branch --show-current 2>/dev/null || true)"

printf 'contract_version=1\n'
printf 'role=%s\n' "$role"
printf 'repo_root=%s\n' "$top"
printf 'main_root=%s\n' "$main_root"
printf 'branch=%s\n' "${branch:-detached}"

if [ "$fetch_first" -eq 1 ]; then
  if git fetch origin >/dev/null 2>&1; then
    echo "fetch=ok"
  else
    warn "git fetch origin failed; upstream counts may be stale"
  fi
fi

# Default branch resolved from origin/HEAD (this repo uses main; the origin
# project used master). Falls back to main if origin/HEAD is unset locally.
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
[ -n "$default_branch" ] || default_branch="main"

if git rev-parse --verify "origin/$default_branch" >/dev/null 2>&1; then
  relation="$(git rev-list --left-right --count HEAD..."origin/$default_branch" 2>/dev/null || printf 'unknown unknown')"
  ahead="$(printf '%s\n' "$relation" | awk '{print $1}')"
  behind="$(printf '%s\n' "$relation" | awk '{print $2}')"
  printf 'ahead_of_origin_default=%s\n' "$ahead"
  printf 'behind_origin_default=%s\n' "$behind"
else
  warn "origin/$default_branch is unavailable"
fi

current_dirty="$(git status --porcelain 2>/dev/null || true)"
main_dirty="$(git -C "$main_root" status --porcelain 2>/dev/null || true)"
current_dirty_count="$(printf '%s\n' "$current_dirty" | awk 'NF {n++} END {print n+0}')"
main_dirty_count="$(printf '%s\n' "$main_dirty" | awk 'NF {n++} END {print n+0}')"
printf 'current_dirty_paths=%s\n' "$current_dirty_count"
printf 'main_dirty_paths=%s\n' "$main_dirty_count"

if [ "$main_dirty_count" -gt 0 ]; then
  warn "main checkout has foreign or uncommitted work; do not stage, stash, commit, rebase, or fast-forward it"
  printf '%s\n' "$main_dirty" | sed 's/^/main_dirty=/'
fi

if [ "$role" = "orchestrator" ]; then
  [ "$top" = "$main_root" ] || fail "orchestrator is not in the main checkout"
  [ "$branch" = "$default_branch" ] || fail "orchestrator is not on $default_branch"
else
  [ "$top" != "$main_root" ] || fail "builder is in the main checkout instead of a lane worktree"
fi

cmux_ok=0
if command -v cmux >/dev/null 2>&1 \
  && [ -n "${CMUX_WORKSPACE_ID:-}" ] \
  && [ -n "${CMUX_SURFACE_ID:-}" ] \
  && cmux ping >/dev/null 2>&1; then
  cmux_ok=1
fi
printf 'cmux_reachable=%s\n' "$cmux_ok"
printf 'cmux_workspace=%s\n' "${CMUX_WORKSPACE_ID:-none}"
printf 'cmux_surface=%s\n' "${CMUX_SURFACE_ID:-none}"

if [ "$cmux_ok" -ne 1 ] && [ "$allow_no_cmux" -ne 1 ]; then
  fail "cmux is unavailable; interactive orchestration cannot proceed"
fi

worktree_count=0
dirty_worktree_count=0
while IFS= read -r worktree_path; do
  [ -n "$worktree_path" ] || continue
  worktree_count=$((worktree_count + 1))
  worktree_dirty="$(git -C "$worktree_path" status --porcelain 2>/dev/null || true)"
  if [ -n "$worktree_dirty" ]; then
    dirty_worktree_count=$((dirty_worktree_count + 1))
    printf 'dirty_worktree=%s\n' "$worktree_path"
  fi
done < <(git worktree list --porcelain | awk '/^worktree / {sub(/^worktree /, ""); print}')
printf 'worktree_count=%s\n' "$worktree_count"
printf 'dirty_worktree_count=%s\n' "$dirty_worktree_count"

lanes_file="$main_root/docs/lanes.md"
board_file="$main_root/docs/backlog.md"
board_dir="$main_root/docs/board"

if [ -f "$lanes_file" ]; then
  active_lanes="$(awk '
    /^## Current lanes/ {in_current=1; next}
    /^## Released lanes/ {in_current=0}
    in_current && /^\|/ && $0 !~ /^\|---/ {
      low=tolower($0)
      if (low ~ /\| (active|claimed|in flight)/) count++
    }
    END {print count+0}
  ' "$lanes_file")"
  printf 'registered_active_lanes=%s\n' "$active_lanes"
else
  fail "docs/lanes.md is missing"
fi

# The board is one file per card under docs/board/ (column = directory). A
# project that has not migrated yet still has the single docs/backlog.md, and
# this script serves both.
count_cards() {
  ls "$1"/*.md 2>/dev/null | wc -l | tr -d ' '
}

if [ -d "$board_dir" ]; then
  printf 'board_mode=files\n'
  printf 'board_inflight=%s\n' "$(count_cards "$board_dir/in-flight")"
  printf 'board_ready=%s\n' "$(count_cards "$board_dir/ready")"
  printf 'board_waiting=%s\n' "$(count_cards "$board_dir/waiting-on-owner")"
  printf 'board_done=%s\n' "$(count_cards "$board_dir/done")"
  if [ ! -f "$board_dir/ground-truth.md" ]; then
    fail "docs/board/ground-truth.md is missing"
  fi
elif [ -f "$board_file" ]; then
  printf 'board_mode=legacy\n'
  board_counts="$(awk '
    /^## / {
      section="other"
      if ($0 ~ /^## In flight/) section="inflight"
      else if ($0 ~ /^## Ready to start/) section="ready"
      else if ($0 ~ /^## Waiting on owner/) section="waiting"
      else if ($0 ~ /^## Done/) section="done"
      next
    }
    /^- \[[ xX]\]/ {
      if (section=="inflight") inflight++
      else if (section=="ready") ready++
      else if (section=="waiting") waiting++
      else if (section=="done") done++
    }
    END {printf "%d %d %d %d", inflight+0, ready+0, waiting+0, done+0}
  ' "$board_file")"
  printf 'board_inflight=%s\n' "$(printf '%s\n' "$board_counts" | awk '{print $1}')"
  printf 'board_ready=%s\n' "$(printf '%s\n' "$board_counts" | awk '{print $2}')"
  printf 'board_waiting=%s\n' "$(printf '%s\n' "$board_counts" | awk '{print $3}')"
  printf 'board_done=%s\n' "$(printf '%s\n' "$board_counts" | awk '{print $4}')"
else
  fail "no board found: neither docs/board/ nor docs/backlog.md"
fi

claim_script="$(dirname "$0")/role-claim.sh"
if [ -x "$claim_script" ] || [ -f "$claim_script" ]; then
  if claim_output="$(bash "$claim_script" status 2>/dev/null)"; then
    printf '%s\n' "$claim_output" | sed 's/^/orchestrator_/'
  else
    echo "orchestrator_status=unclaimed"
    [ "$role" != "orchestrator" ] || fail "orchestrator role has not been claimed atomically"
  fi
else
  fail "role-claim.sh is missing"
fi

printf 'warnings=%s\n' "$warnings"
printf 'hard_failures=%s\n' "$hard_failures"

if [ "$hard_failures" -gt 0 ]; then
  echo "result=FAIL"
  exit 2
fi

if [ "$warnings" -gt 0 ]; then
  echo "result=WARN"
  [ "$strict" -eq 0 ] || exit 2
else
  echo "result=PASS"
fi
