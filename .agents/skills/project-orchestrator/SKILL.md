---
name: project-orchestrator
description: Operate this repository as its explicitly assigned project orchestrator across Claude Code, Codex, and Prime Agent in visible cmux panes. Use when the owner says /orchestrate, asks this session to orchestrate or coordinate the project, hands over the integrator lane, requests builder dispatch, or asks for orchestration handoff. Provides a five-phase workflow with atomic role claiming, live-state preflight, lane-isolated dispatch, verification, and safe handoff. Never infer the role.
archetype: meta
---

# Project Orchestrator

Coordinate the repository without doing feature work in the main checkout. Treat `docs/orchestrator-role.md` as the canonical role contract and `docs/backlog.md` as ground truth.

## Overview

Run five phases:

1. Confirm assignment and claim the role
2. Load canonical state and run preflight
3. Specify and dispatch isolated work
4. Observe, verify, review, and land serially
5. Hand off and release the role

## Phase 1: Confirm and claim

### Goal

Ensure this session was explicitly assigned and that no other live session owns the orchestrator role.

### Process

1. Accept assignment only from the owner, a named predecessor handoff, or an integrator-lane takeover.
2. Stop if this is a builder pane or the assignment is ambiguous.
3. Read `docs/orchestrator-role.md` completely.
4. Read `docs/orchestrator-harness-policy.md` completely.
5. Claim atomically:

```bash
bash .agents/skills/project-orchestrator/scripts/role-claim.sh claim \
  --assigned-by owner --harness codex --mode interactive
```

### Deliverable

A unique claim visible to every worktree. Do not silently replace an existing claim.

## Phase 2: Load and survey

### Goal

Ground every status statement in live state from this session.

### Process

1. Read `CLAUDE.md` and `AGENTS.md` completely. For the board, read `docs/board/ground-truth.md` and every file in `docs/board/in-flight/` in full, then grep the rest for your area (`grep -rl <topic> docs/board/ready/`); never try to read the board whole. For `docs/lanes.md` (one file that can grow very large), read the Current lanes table header region and grep for lanes touching your paths rather than reading it whole.
2. Run:

```bash
bash .agents/skills/project-orchestrator/scripts/preflight.sh --role orchestrator --fetch
```

3. Read every peer pane by content, not by whether a surface reference resolves.
4. Inspect foreign dirt without editing, staging, stashing, or committing it.
5. Report human actions first, then running work, blocks, and the proposed next decision.

### Deliverable

A short evidence-backed operating status and one next decision.

## Phase 3: Specify and dispatch

### Goal

Give a visible builder a cold-startable assignment with mechanical collision boundaries.

### Process

1. Verify the board card's premise in code or with the owner.
2. Write a durable brief from `docs/orchestrator-dispatch-template.md`.
3. Choose harness, model, effort, and subagent/workflow policy using `docs/orchestrator-harness-policy.md`.
4. Create one lane worktree per write-capable session.
5. Create a pane in the current cmux workspace and validate its surface reference.
6. Start Claude Code, Codex, or Prime Agent directly inside the worktree.
7. Point the session to the durable brief.

### Deliverable

A visible, named pane working inside a claimed lane with an explicit owns-list and not-list.

## Phase 4: Verify and land

### Goal

Land correct work, not merely green work.

### Process

1. Read the builder pane before assuming progress or completion.
2. Read the mechanism and diff independently.
3. Apply the adversarial review loop from `docs/orchestrator-role.md` where harm warrants it.
4. Require failing-first tests for verified defects.
5. Reconcile with the current default branch, then run the project's build and test gates with direct exit-code checks.
6. Land one lane at a time.
7. Fast-forward the clean main checkout before reading landed code from it.
8. Verify production READY and content where a code push requires deployment.

### Deliverable

Reviewed, gated, landed work with the board and lane registry updated honestly.

## Phase 5: Hand off and release

### Goal

Transfer the one orchestrator role without leaving hidden work or two owners.

### Process

1. Reach a clean boundary with no session-bound child work running.
2. Write only non-Git state into the handoff.
3. Name the successor and verify its checkout, harness, model, effort, and context.
4. Have the successor run this skill through the load and survey phases without
   trying to create a second claim.
5. Transfer the existing claim to the successor's verified cmux identity:

```bash
bash .agents/skills/project-orchestrator/scripts/role-claim.sh transfer \
  --harness <claude|codex|prime-agent> \
  --to-workspace <workspace:N> --to-surface <surface:N>
```

6. Have the successor run orchestrator preflight and confirm the transferred
   claim before the predecessor stands down.
7. Close the predecessor pane only with owner approval.

### Deliverable

Exactly one active orchestrator and no uncommitted shared-checkout work.

## Core principles

- Assignment is explicit, never inferred.
- The orchestrator integrates and verifies; builders implement in lanes.
- The owner supplies intent and decisions, not Git labor.
- cmux panes are the visible ground truth for session state.
- Harness choice does not change permissions or quality gates.
- Premium models require task-shaped justification.
- A child cannot widen its parent's scope or authority.

## Scripts

### Atomic claim

```bash
bash .agents/skills/project-orchestrator/scripts/role-claim.sh --help
```

### Live-state preflight

```bash
bash .agents/skills/project-orchestrator/scripts/preflight.sh --help
```

### Self-test

```bash
bash .agents/skills/project-orchestrator/scripts/self-test.sh
```

## Quick reference

- Canonical role: `docs/orchestrator-role.md`
- Harness and model policy: `docs/orchestrator-harness-policy.md`
- Dispatch contract: `docs/orchestrator-dispatch-template.md`
- Board: `docs/board/` (one file per card; `docs/backlog.md` is a pointer)
- Ownership lock: `docs/lanes.md`
