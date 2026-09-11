#!/usr/bin/env bash

set -u

usage() {
  cat <<'USAGE'
Usage:
  role-claim.sh claim --assigned-by owner|handoff|integrator \
    --harness claude|codex|prime-agent [--mode interactive|headless|daemon]
  role-claim.sh status
  role-claim.sh transfer --harness claude|codex|prime-agent \
    --to-workspace ID --to-surface ID [--mode interactive|headless|daemon] \
    [--claim-id ID]
  role-claim.sh release [--claim-id ID] [--force]

The lock lives in Git's common directory, so every worktree sees it.
Force release additionally requires ORCHESTRATOR_OWNER_APPROVED_FORCE_RELEASE=1.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

command_name="${1:-status}"
if [ "$#" -gt 0 ]; then shift; fi

assigned_by=""
harness=""
mode="interactive"
provided_claim_id="${ORCHESTRATOR_CLAIM_ID:-}"
force_release=0
to_workspace=""
to_surface=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --assigned-by)
      assigned_by="${2:-}"
      shift 2
      ;;
    --harness)
      harness="${2:-}"
      shift 2
      ;;
    --mode)
      mode="${2:-}"
      shift 2
      ;;
    --claim-id)
      provided_claim_id="${2:-}"
      shift 2
      ;;
    --to-workspace)
      to_workspace="${2:-}"
      shift 2
      ;;
    --to-surface)
      to_surface="${2:-}"
      shift 2
      ;;
    --force)
      force_release=1
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

if [ -n "${ORCHESTRATOR_LOCK_ROOT:-}" ]; then
  common_dir="$ORCHESTRATOR_LOCK_ROOT"
else
  common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
    echo "Not inside a Git repository." >&2
    exit 2
  }
fi

lock_dir="$common_dir/project-orchestrator.lock"
metadata_file="$lock_dir/claim"

metadata_value() {
  key="$1"
  [ -f "$metadata_file" ] || return 1
  sed -n "s/^${key}=//p" "$metadata_file" | head -1
}

show_status() {
  if [ ! -d "$lock_dir" ]; then
    echo "status=unclaimed"
    return 1
  fi

  echo "status=claimed"
  if [ -f "$metadata_file" ]; then
    sed -n '1,40p' "$metadata_file"
  else
    echo "warning=claim directory exists without metadata"
  fi
}

caller_matches_claim() {
  stored_claim_id="$(metadata_value claim_id 2>/dev/null || true)"
  stored_workspace="$(metadata_value workspace 2>/dev/null || true)"
  stored_surface="$(metadata_value surface 2>/dev/null || true)"

  [ -n "$provided_claim_id" ] && [ "$provided_claim_id" = "$stored_claim_id" ] && return 0
  [ -n "${CMUX_WORKSPACE_ID:-}" ] && [ -n "${CMUX_SURFACE_ID:-}" ] \
    && [ "$CMUX_WORKSPACE_ID" = "$stored_workspace" ] \
    && [ "$CMUX_SURFACE_ID" = "$stored_surface" ]
}

case "$command_name" in
  status)
    show_status
    ;;

  claim)
    case "$assigned_by" in
      owner|handoff|integrator) ;;
      *)
        echo "Claim requires --assigned-by owner, handoff, or integrator." >&2
        exit 2
        ;;
    esac

    case "$harness" in
      claude|codex|prime-agent) ;;
      *)
        echo "Claim requires --harness claude, codex, or prime-agent." >&2
        exit 2
        ;;
    esac

    case "$mode" in
      interactive|headless|daemon) ;;
      *)
        echo "Unsupported mode: $mode" >&2
        exit 2
        ;;
    esac

    if [ "$mode" = "interactive" ]; then
      if [ -z "${CMUX_WORKSPACE_ID:-}" ] || [ -z "${CMUX_SURFACE_ID:-}" ]; then
        echo "Interactive orchestrators require CMUX_WORKSPACE_ID and CMUX_SURFACE_ID." >&2
        exit 2
      fi
      if ! command -v cmux >/dev/null 2>&1 || ! cmux ping >/dev/null 2>&1; then
        echo "cmux is not reachable. Re-run with socket permission; do not claim blind." >&2
        exit 2
      fi
    fi

    if ! mkdir "$lock_dir" 2>/dev/null; then
      echo "Another orchestrator claim already exists:" >&2
      show_status >&2 || true
      exit 3
    fi

    claim_id="$(uuidgen 2>/dev/null || printf '%s-%s-%s' "$(date +%s)" "$$" "$RANDOM")"
    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || printf 'unknown')"
    host_name="$(hostname 2>/dev/null || printf 'unknown')"

    # Only an INTERACTIVE claim records the pane identity (which then also
    # authorizes the caller via the env fallback). A headless/daemon claim
    # must be credential-only: recording live cmux env here would let any
    # later caller from the same pane pass caller_matches_claim with a wrong
    # claim id (found by self-test on 2026-08-11 when run inside a cmux pane).
    if [ "$mode" = "interactive" ]; then
      claim_workspace="${CMUX_WORKSPACE_ID:-headless}"
      claim_surface="${CMUX_SURFACE_ID:-headless}"
    else
      claim_workspace="headless"
      claim_surface="headless"
    fi

    umask 077
    if ! {
      printf 'claim_id=%s\n' "$claim_id"
      printf 'assigned_by=%s\n' "$assigned_by"
      printf 'harness=%s\n' "$harness"
      printf 'mode=%s\n' "$mode"
      printf 'workspace=%s\n' "$claim_workspace"
      printf 'surface=%s\n' "$claim_surface"
      printf 'repo_root=%s\n' "$repo_root"
      printf 'host=%s\n' "$host_name"
      printf 'pid=%s\n' "$$"
      printf 'started_at=%s\n' "$started_at"
      printf 'contract_version=1\n'
    } > "$metadata_file"; then
      rmdir "$lock_dir" 2>/dev/null || true
      echo "Failed to write claim metadata." >&2
      exit 2
    fi

    echo "status=claimed"
    echo "claim_id=$claim_id"
    echo "lock_dir=$lock_dir"
    echo "Keep ORCHESTRATOR_CLAIM_ID=$claim_id for headless release."
    ;;

  transfer)
    [ -d "$lock_dir" ] || {
      echo "Transfer denied: no orchestrator claim exists." >&2
      exit 4
    }

    case "$harness" in
      claude|codex|prime-agent) ;;
      *)
        echo "Transfer requires --harness claude, codex, or prime-agent." >&2
        exit 2
        ;;
    esac

    case "$mode" in
      interactive|headless|daemon) ;;
      *)
        echo "Unsupported mode: $mode" >&2
        exit 2
        ;;
    esac

    if [ -z "$to_workspace" ] || [ -z "$to_surface" ]; then
      echo "Transfer requires --to-workspace and --to-surface." >&2
      exit 2
    fi

    if ! caller_matches_claim; then
      echo "Transfer denied: caller does not match the claim." >&2
      show_status >&2 || true
      exit 4
    fi

    previous_claim_id="$stored_claim_id"
    claim_id="$(uuidgen 2>/dev/null || printf '%s-%s-%s' "$(date +%s)" "$$" "$RANDOM")"
    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || printf 'unknown')"
    host_name="$(hostname 2>/dev/null || printf 'unknown')"
    next_metadata="$lock_dir/.claim.$$"

    umask 077
    if ! {
      printf 'claim_id=%s\n' "$claim_id"
      printf 'previous_claim_id=%s\n' "$previous_claim_id"
      printf 'assigned_by=handoff\n'
      printf 'harness=%s\n' "$harness"
      printf 'mode=%s\n' "$mode"
      printf 'workspace=%s\n' "$to_workspace"
      printf 'surface=%s\n' "$to_surface"
      printf 'repo_root=%s\n' "$repo_root"
      printf 'host=%s\n' "$host_name"
      printf 'pid=%s\n' "$$"
      printf 'started_at=%s\n' "$started_at"
      printf 'contract_version=1\n'
    } > "$next_metadata" || ! mv "$next_metadata" "$metadata_file"; then
      rm -f "$next_metadata"
      echo "Failed to transfer claim metadata." >&2
      exit 4
    fi

    echo "status=transferred"
    echo "previous_claim_id=$previous_claim_id"
    echo "claim_id=$claim_id"
    echo "workspace=$to_workspace"
    echo "surface=$to_surface"
    ;;

  release)
    if [ ! -d "$lock_dir" ]; then
      echo "status=unclaimed"
      exit 0
    fi

    authorized=0

    if caller_matches_claim; then
      authorized=1
    fi

    if [ "$force_release" -eq 1 ]; then
      if [ "${ORCHESTRATOR_OWNER_APPROVED_FORCE_RELEASE:-}" != "1" ]; then
        echo "Force release requires ORCHESTRATOR_OWNER_APPROVED_FORCE_RELEASE=1 after explicit owner approval." >&2
        exit 4
      fi
      authorized=1
      echo "warning=owner-approved force release"
    fi

    if [ "$authorized" -ne 1 ]; then
      echo "Release denied: caller does not match the claim." >&2
      show_status >&2 || true
      exit 4
    fi

    if [ -f "$metadata_file" ]; then
      rm "$metadata_file"
    fi
    if ! rmdir "$lock_dir"; then
      echo "Release stopped: unexpected files remain in $lock_dir" >&2
      exit 4
    fi
    echo "status=released"
    echo "claim_id=$stored_claim_id"
    ;;

  *)
    echo "Unknown command: $command_name" >&2
    usage >&2
    exit 2
    ;;
esac
