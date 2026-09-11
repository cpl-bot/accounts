# Orchestrator harness policy

**Contract version:** 1
**Owner ruling:** 2026-08-08
**Canonical role:** `docs/orchestrator-role.md`

This document defines how the canonical orchestrator role is carried by Claude Code, Codex, or Prime Agent. Harness choice changes the transport and launch commands. It does not change ownership, collision discipline, verification, or permission boundaries.

## Selection order

Choose in this order:

1. Task shape
2. Harness
3. Model
4. Effort
5. Subagent and workflow policy

Record all five in the dispatch brief. Do not select a premium model before the task has a verified premise and an executable specification.

## Visibility is the default

Run every interactive Claude Code, Codex, and Prime Agent session as a visible pane in the current cmux workspace. The owner uses the shared pane layout to observe work and may take over a session directly.

**Without cmux**, visibility falls back to durable artifacts: every session still gets a committed dispatch brief, claims its lane in `docs/lanes.md`, and reports through the messaging channel. The pane-specific rules below (surface refs, input-line clearing, screen reads) do not apply; everything else in this policy does.

- Create builders with `cmux new-pane`, never a separate workspace.
- Validate the returned surface reference before sending anything. An empty reference can target the caller's own terminal.
- Start the process inside its claimed worktree.
- Give the session and pane a task or lane name.
- Read the pane before assuming it is working, stalled, or finished.
- **Clear the peer's input line before every send: `cmux send-key --surface "surface:N" "ctrl+u"`.** This applies to all three harnesses, because the hazard is the terminal, not the model.
- Keep the pane until its work is reviewed, landed, and handed off.

### Input-line hygiene, and why the obvious tell does not work

These builds autofill a suggested next action into the prompt. It is plausible, on-topic, and written by nobody. On 2026-08-08 it bit twice on two different panes; the second time a builder's input read `repoint instead of remove, thread the flag, implement al…`, which was almost exactly the ruling the orchestrator was about to issue. **Wording is not a tell.**

Autofilled text renders **dark gray** and real typed input **white**. That distinction is reliable for the owner looking at the screen and **unusable by any agent**: `cmux read-screen` is documented as returning terminal text as plain text, and its raw bytes carry no ANSI escapes, only box-drawing characters. Do not claim to detect it, and do not make the owner adjudicate every send.

So the rule is mechanical rather than perceptual. Clear the line first, and the question never arises: stray text can neither merge with your message nor be submitted by the newline that follows it. If a peer genuinely appears to have received an instruction you did not send, ask the owner in your own conversation rather than inferring from the screen.

Headless execution is an explicit exception for bounded work with a durable brief, a time or token limit, and a machine-readable result. Never use headless mode merely to hide a session the owner could otherwise inspect.

## Harness boundaries

### Claude Code

Launch Claude Code directly with the `claude` binary so it uses the owner's Claude subscription. Do not route Claude work through Prime Agent. Do not pass an Anthropic API key, and do not use `--bare`, which disables OAuth and keychain authentication.

Interactive shape:

```bash
cmux send --surface "$SID" "cd <worktree> && claude --name <lane> --model opus --effort high --permission-mode auto\n"
```

Headless shape, only when explicitly justified:

```bash
claude -p --output-format json --model <model> --effort <level> "Read <brief> and execute it"
```

Claude's `/orchestrate` command is the Claude-specific activation adapter.

### Codex

Use Codex for implementation, refactoring, repository investigation, and review when its coding workflow fits the brief. Run interactive Codex in a visible pane by default.

```bash
cmux send --surface "$SID" "cd <worktree> && codex -C <worktree>\n"
```

Use `codex exec` only for bounded headless work. The project-orchestrator skill is the Codex activation adapter.

### Prime Agent

Prime Agent is authenticated through the owner's Codex/OpenAI account. It is a Codex-backed harness, not a path to Claude subscription usage. Never select an Anthropic provider through Prime Agent.

Interactive shape:

```bash
cmux send --surface "$SID" "prime-agent --cwd <worktree>\n"
```

Prime Agent may also run in JSON, RPC, ACP, or daemon mode. When a daemon carries material work, open or attach a visible cmux pane so the owner can inspect it. Use `prime-agent send`, `status`, and `attach` as its durable control surface.

Load the project-orchestrator skill explicitly when automatic project skill discovery does not pick it up:

```bash
prime-agent --cwd <worktree> --skill <repo>/.agents/skills/project-orchestrator
```

## Claude model and effort policy

The orchestrator chooses model and effort at dispatch. Set both before sending the brief so a long-running pane does not invalidate its cache mid-task.

| Model | Good fit | Typical effort |
| --- | --- | --- |
| Haiku | status checks, extraction, inventory, mechanical triage, cheap read-only work | low or medium |
| Sonnet | bounded implementation, documentation, tests, routine fixes with a settled mechanism | medium or high |
| Opus | normal complex implementation, architecture, investigation, integration and adversarial review | high or xhigh |
| Fable | unusually difficult, ambiguous or long-horizon work that materially benefits from autonomous workflows or subagents | high, xhigh or max |

Fable is exceptionally expensive. Before every Fable dispatch:

1. Invoke the premium-model gate skill if one is installed (e.g. `fable-5-prompting`).
2. Record why Opus is insufficient for this task.
3. Bound the objective, cost or time, stopping condition, and expected artifact.
4. Do not leave the Fable pane idle after completion.
5. Do not use Fable for mechanical work or execution of an already complete specification.

If no gate skill is installed in your environment, the dispatch brief itself must carry the written justification before a top-tier dispatch; without either, do not dispatch to the top tier.

## Subagents and workflows

Every dispatch declares one of `forbidden`, `allowed`, or `required` for both subagents and workflows.

- Read-only children may investigate within the parent brief.
- Write-capable children require isolated ownership and their own worktree or workflow-provided isolation.
- A child may not widen the parent's owns-list, permissions, production authority, or external-publishing authority.
- The parent integrates and verifies every child result.
- Concurrency is capped by orchestrator review capacity, normally three active tracks.
- Mass fan-out requires explicit owner opt-in for that invocation.
- Prod data writes, destructive operations, live agent pushes, and live external publishing are never delegated.

Fable may use workflows and subagents when the brief allows them. That is one of its strongest uses, but it does not relax isolation or review.

## Durable content transport

The brief and result live in Git-visible files or another durable session record. cmux is the visual and control plane, not the sole store of task context.

- Use `docs/orchestrator-dispatch-template.md` for every material assignment.
- Send a short pointer to the brief when starting a pane.
- Use a harness-native durable message channel when available.
- When no durable message channel exists, wait until the target pane is ready and send only the brief pointer through cmux.
- Re-read the pane after owner intervention or before changing its task.

## Single-orchestrator claim

The conversational assignment remains authoritative: the role is assigned, never inferred. After assignment, claim the runtime role atomically:

```bash
bash .agents/skills/project-orchestrator/scripts/role-claim.sh claim \
  --assigned-by owner --harness <claude|codex|prime-agent> --mode interactive
```

The claim lives under Git's common directory, so all worktrees see the same lock. A stale claim is not self-authorizing. Report it and obtain the owner's explicit direction before force release.

Run preflight immediately after claiming:

```bash
bash .agents/skills/project-orchestrator/scripts/preflight.sh --role orchestrator --fetch
```

Release only after handoff or owner-approved shutdown:

```bash
bash .agents/skills/project-orchestrator/scripts/role-claim.sh release
```

For handoff, the predecessor keeps the lock and atomically transfers it to the
successor's verified cmux identity. The successor then runs preflight; there is
never an unclaimed gap or a second claim:

```bash
bash .agents/skills/project-orchestrator/scripts/role-claim.sh transfer \
  --harness <claude|codex|prime-agent> \
  --to-workspace <workspace:N> --to-surface <surface:N>
```
