# The orchestrator role

**Status:** working doc, established 2026-08-07 from a session that ran it end to end. Every rule below is derived from something that happened that day, not from general principle. Update it when a new failure mode teaches something.

> **About the dates:** the dated incidents throughout this document happened on the origin project this process was extracted from, not on yours. They are kept, in generic form, because a rule without the failure that produced it gets re-litigated by the next cold session. Read them as provenance, and add your own project's incidents the same way as they happen.

A session running this role coordinates other sessions instead of building. It exists because parallel sessions are supported (owner decision 2026-07-19) but nothing was coordinating them, so two things kept happening: sessions collided in the shared checkout, and work landed green-gated but wrong.

Harness selection, model and cost policy, visible-pane defaults, and the shared dispatch envelope live in `docs/orchestrator-harness-policy.md` and `docs/orchestrator-dispatch-template.md`. The Claude-specific mechanics below remain operational evidence, not an exclusive-harness rule.

---

## Is this document for you? Default: NO

**The orchestrator role is ASSIGNED, never inferred.** A session wrongly assuming it is orchestrating is worse than no orchestrator at all: it will hold the main checkout, dispatch work into lanes it does not own, and start reviewing other sessions' output while the real coordinator does the same. Two orchestrators is a collision, not redundancy.

**You are the orchestrator only if one of these is true:**
1. The owner told you, in your own conversation, to coordinate or orchestrate.
2. You were handed the role by a departing orchestrator (a handoff naming the role explicitly).
3. The owner asked you to take over the integrator lane in `docs/lanes.md`.

**If none of those is true, stop reading. This document is not your contract.** Close it and work to whichever of these you actually are:

| If you are | Your contract is | And you must NOT |
| --- | --- | --- |
| **A builder in a lane worktree** (`/Users/admin/projects/accounts-wt/*` or `.claude/worktrees/*`) | Your dispatch brief, your `docs/lanes.md` owns-list, and `CLAUDE.md`'s hard rules | Touch the main checkout, dispatch other sessions, or review another lane's work uninvited |
| **A spawned agent** (Agent tool, workflow subagent) | The prompt you were given, in full. It is complete on purpose | Widen your own scope, spawn peers, or take work the brief did not name |
| **An ordinary session** the owner is working with directly | `CLAUDE.md`, `docs/backlog.md`, and what the owner asks | Assume coordination duties nobody gave you |

The one rule here that binds **everyone**: never leave uncommitted work in the main checkout, and never sweep another session's uncommitted work into your commit. That is collision discipline, not orchestration, and it is already in `CLAUDE.md`.

---

## The posture

**The orchestrator holds the main checkout and does no feature work.** `accounts/` is the integrator surface. Board capture, cross-lane integration, verification, and dispatch happen here. Feature work happens in lane worktrees, which is where the other sessions are. If the orchestrator starts editing `app/`, `middleware/`, it has stopped orchestrating and become a third colliding session.

**The owner's job stays intent and decisions.** The orchestrator does all git, all dispatch, all verification. It brings the owner questions, not status.

---

## The five jobs

### 1. Specify, because specification is the bottleneck

On 2026-08-07 the owner asked for a Fable prompt to build social publishing. A parallel session built it in the time it took to write the prompt. The prompt was never the constraint; the specification was, and that had been written earlier the same session as an assessment doc with slices, constraints, and named open questions.

So: when work is not moving, the question is almost never "which model" or "how do I phrase the handoff." It is "is this specified well enough that any competent session could execute it." Write the spec. Dispatch is cheap.

### 2. Verify every claim, including your own

Never take a commit message's word for anything. On 2026-08-07 a session reported "build exit 0, vitest 4717/4717"; that was true, and it was verified independently before anything was built on top of it. Same for deploys: `Ship = deploy READY, not push`, so read the deployment state rather than assuming the push implied it.

**Verify the mechanism, not a proxy for it.** The same day, the orchestrator nearly reported a ruling as unimplemented because it grepped an opacity constant that had not changed. The constant was irrelevant: the whole layer was gated by a conditional four lines above it. A grep tells you a value; only reading the code tells you the behaviour. When the question is "does it do X", read the path that does X.

For anything with a projection or a payload, verify CONTENT, not HTTP status. A writer/reader schema drift can ship an EMPTY payload at HTTP 200 and look healthy from the outside.

**A GREEN SUITE IS NOT EVIDENCE THE BEHAVIOUR IS RIGHT, because a test can pin a REGRESSION as firmly as it pins a fix.** On 2026-08-08 the owner found the knowledge graph missing from the desktop rail. It had been hidden by one line, a `.filter()` on the rail tabs, and it shipped green and stayed green for a day because a test asserted `queryByRole('Graph') === null`. The suite was faithfully protecting the graph's absence. The tab did still exist, so every "the tab is in MODE_TABS" assertion passed too, and it was irrelevant: the surviving tab lived inside a `lg:hidden` wrapper, so on desktop the rail was the only nav. **When a change REMOVES something a user can reach, the guard has to assert reachability on the surface that user actually has, and an existing test that asserts the absence is a defect being locked in.** The corrected guard asserts the row is present AND that clicking it changes the view, so a row that is present but inert also fails.

### 3. Review adversarially before anything goes live

Green gates prove the tests pass. They do not prove the code is right.

Evidence: `643a8226` landed with build exit 0 and 4717 passing tests. A high-effort review of the same code found **ten verified defects**, including a link policy that deleted the member's prose from live posts and a retry path that reported "Published." while nothing reached the platform. One of the tests actively concealed its bug by faking an error shape the real code never produces.

So: for anything touching money, publishing, auth, or customer-visible output, run a review before it goes live, not after. And when dispatching the fixes, require **failing-test-first** per finding. A fix whose test passes against the unfixed code has not reproduced the defect.

**Then review the fixes.** One pass is not enough on a surface like this, and the same day proved it: the ten fixes were real, well-tested, and shipped with the suite green at 4773; a re-review found **ten more distinct defects**, two of them worse than what they replaced. The retry fix turned a false-success bug into a bug that posts twice to a live feed and bills twice. The prose-deletion fix closed the cross-line case and left the per-line case open, still reproducible by executing the shipped module.

The pattern to require, on any surface where nearly every path has a money or a feed consequence:

> review, fix failing-test-first, **re-review the fixes**, repeat until a pass comes back clean

**Scope it. Most work does not earn this.** The loop is expensive and slow, and running it everywhere would stop the project. Run it when a defect would spend money, publish publicly, grant access, or reach a customer's eyes: publishing and messaging paths, payment and metering, auth and entitlement, agent prompts, and anything writing to a live external account. Everything else gets one review or none, and the ordinary gates carry it. If you cannot name the harm a defect would cause, you do not need the loop.

**The escalation trigger, so this decision stops being a judgement call.** On 2026-08-07 the loop ran three rounds before the orchestrator noticed a pattern and called for a redesign. That call should have come one round earlier, and it would have if this rule had existed:

> **If round N's fixes produce round N+1 defects of the SAME CLASS, stop patching. That is a design fault, and no further round will fix it.**

Same class means the same machine or the same invariant, not the same file. Round 1 found a retry path that reported success without posting; round 2's fix turned it into one that posted twice; round 3 found it broken a third way. Three rounds, one machine, three shapes. The second of those was already the signal. When it fires, the next dispatch is a redesign brief naming what must become *structurally impossible*, not a list of lines to change, and it goes to a session that did not write the original, because the mental model that produced the bug will reproduce it.

Twenty real defects were found across two reviews of code that passed 4717 and then 4773 tests. The gates never would have found any of them. Budget for the loop rather than treating the first green as done, and tell the fixing session what the previous round got wrong at the level of mechanism, not just location, so it fixes the reasoning rather than the line.

### 4. Verify a card's premise before dispatching from it

This is the failure the orchestrator itself committed on 2026-08-07, and it cost a session's work.

A board card recorded the owner's complaint that "the knowledge graph on this screen is useless" and **guessed** which screen: the ambient mini graph on the attention view. The orchestrator dispatched an assignment built on that guess. The owner had meant a different screen entirely, whose canvas draws its own wire layer. The session shipped to the wrong brief before the correction arrived.

So: before dispatching, check whether the card asserts or guesses. A card that says "most likely X, second candidate Y" is not a specification, it is an open question wearing a card's clothes. Resolve it with the owner first, or read the code and resolve it yourself. Two minutes of grep would have found the real wire layer and its `0.44` at-rest opacity.

### 5. Interview the owner properly, then record the ruling so it stays ruled

Bring decisions, not status. A good decision question:

- is grounded in the actual code, with real numbers (`KB_COLS = 3` fixed, content always 1072px, rendered at 0.8 = 858px), not in adjectives
- offers two or three real options with their consequences, including what each forecloses
- names the recommendation and why
- says plainly what is still unknown and what it blocks

When the owner rules, record it on the board **with a do-not-re-litigate note and the reasoning that produced it**. A ruling without its reasoning gets reopened by the next cold session; a ruling with it survives. When a ruling supersedes a written verdict, mark the old doc superseded rather than leaving two documents that disagree, because a doc that quietly contradicts the board is a trap.

---

## The control surface: messaging plus cmux

**If this project does not run cmux, this whole section degrades cleanly and the role still works:** the observation and control tables below become inert, and messaging (`SendMessage` or your harness's equivalent) plus committed dispatch briefs carry everything. What you lose is the eye — the ability to read a peer's screen — so compensate by requiring builders to report state you would otherwise observe: their worktree path, branch, gate exit codes, and an explicit "done" message. Skip the cmux-specific mechanics; every rule about lanes, gates, briefs, and collision discipline still binds.

Established 2026-08-08. Peer sessions on the origin project ran as **terminal panes inside one cmux workspace**, alongside the orchestrator. That gives the orchestrator two channels with genuinely different jobs, plus an eye.

| Channel | What it is for | What it cannot do |
| --- | --- | --- |
| `SendMessage` | **Content.** Task briefs, corrections, questions, stand-down orders. Durable, lands in the peer's inbox, survives whatever it is mid-way through. | Anything client-side. A peer cannot run a slash command because you asked it to in a message. |
| `cmux send --surface` | **Control.** Slash commands only: `/clear`, `/model opus`, `/effort`. Types literally into the pane; **append `\n` or it does not submit.** | Carrying context. Never brief a task this way; use a message. |
| `cmux read-screen --surface` | **Observation.** See a peer's real state without asking: model, effort, context remaining, whether it is working or stalled. | Nothing, but see the ref hazard below. |

Verified working: `/model opus` responds "Set model to Opus 5 and saved as your default for new sessions", and `/effort` is the effort command. `cmux send` returns `OK surface:N workspace:1`.

### The levers you actually have, and the one you will assume is the owner's

Added 2026-08-08, because an orchestrator spent that session nursing two inherited panes and asking the owner to flip a switch it could have routed around. **Everything here was tested that day, not read off a help page.** The habit to build: when a pane is on the wrong model, the wrong effort, or carrying the wrong session-level mode, that is yours to fix.

| Lever | Command | Verified gotcha |
| --- | --- | --- |
| **Effort** | `cmux send --surface "surface:N" "/effort high\n"` | **CORRECTED 2026-08-08: it does NOT always open a confirmation menu.** On a freshly started pane it applied directly and rendered `● high · /effort`; the follow-up `1\n` then landed as a stray one-character PROMPT and the builder burned a turn thinking about it. Harmless here, but on a busy pane it is an unwanted instruction. **Read the pane and only answer a menu you can actually see.** It still invalidates the conversation cache, so set effort at dispatch rather than mid-task. |
| **Model** | `cmux send --surface "surface:N" "/model opus\n"` | Saves as the default for NEW sessions too, so it is not a local change. |
| **Clear** | `cmux send --surface "surface:N" "/clear\n"` | A pane cleared on 2026-08-08 came back in **manual mode, not auto**. Check the mode line before handing a cleared pane anything unattended. |
| **New session** | `cmux new-workspace --name "..." --cwd <path> --command "claude" --focus false` | Ignores `--json`; prints `OK workspace:N`. Parse with `grep -oE 'workspace:[0-9]+'` and **validate non-empty before targeting it**, or you address your own workspace. |
| **Close a session** | `cmux close-workspace --workspace workspace:N` | Verify it is gone by re-listing; do not assume. |
| **Your own state** | `cmux read-screen --surface "<your own surface>"` | See "Never estimate your own context" below. |

**Ultracode is a property of the session, not a toggle.** On 2026-08-08 it was treated as the owner's switch through two sessions: `/ultracode` returns "Unknown command" in this build, and it is not a key in `~/.claude/settings.json`, the project settings, or `CLAUDE.md`. That conclusion was right and the inference from it was wrong. **The lever is REPLACING the session, not toggling it**: a workspace created with `--command "claude"` starts clean, with no ultracode and whatever model and effort you then set. A `/clear` does NOT remove it. Judge it by task class, as with effort: fan-out is right for an audit or a review round and pure waste for a builder executing a written spec.

**Owner layout preference, ruled 2026-08-08: ONE workspace, builders as PANES, not a tab each.** The orchestrator that day reached for the multi-workspace recipe and split three builders across three tabs, which broke the arrangement the owner uses to watch them side by side. Use `cmux new-pane` in the current workspace instead. The catch that explains the whole shape: **`new-pane` has no `--cwd` flag**, so a pane inherits the workspace's directory and a builder pane needs two steps.

```bash
SID=$(CMUX_QUIET=1 cmux new-pane --direction right --json 2>/dev/null | jq -r '.surface_ref // empty')
[ -n "$SID" ] || { echo "pane create failed; NOT sending to my own shell"; exit 1; }
cmux send --surface "$SID" "cd /Users/admin/projects/accounts-wt/<lane> && claude\n"
```

There is **no move operation** for an existing surface, so getting this wrong costs a close-and-recreate. Do it before a builder has commits; after that you are throwing away real work.

### Standing up a builder, end to end

One session equals one lane worktree is not negotiable, and the setup convention is not in `CLAUDE.md`, so it gets rediscovered every time. Cut from `origin/main`, then bootstrap so gates run without reinstalling (Node 22 + pnpm 10, Python 3.11 + `uv`; env files are gitignored so they must be copied):

```bash
git worktree add -b "lane/$L" "/Users/admin/projects/accounts-wt/$L" origin/main
ln -s /Users/admin/Documents/accounts/node_modules "/Users/admin/projects/accounts-wt/$L/node_modules"
cp /Users/admin/Documents/accounts/.env "/Users/admin/projects/accounts-wt/$L/.env" 2>/dev/null || true
cp /Users/admin/Documents/accounts/middleware/.env "/Users/admin/projects/accounts-wt/$L/middleware/.env" 2>/dev/null || true
(cd "/Users/admin/projects/accounts-wt/$L/middleware" && uv sync)
```

Lanes touching `middleware/` gate on `uv run ruff check . && uv run pytest -q` from `middleware/` in addition to `pnpm build` / `pnpm test`.

Then create the pane, start `claude`, set effort, and only then send the brief. A new session appears in `ListAgents` within about half a minute, named after its worktree, and **that name is the address for `SendMessage`**.

Concurrency is capped by YOUR review throughput, not theirs. Three is the working number, because every track lands serially through one orchestrator running gates.

### Know which tree you are standing in

Three separate ways this bit one session on 2026-08-08, all cheap to prevent and all expensive to diagnose.

1. **The Bash working directory PERSISTS between calls.** One `cd` into a lane worktree silently redirected every later bare command, and a full `pnpm build` plus `pnpm test` was run against the branch while the orchestrator believed it was gating its own board edits in the main checkout. **`cd` explicitly in every command that matters, or print `pwd` alongside the gate.**
2. **Pushing from a worktree does NOT advance the main checkout's local `main`.** `git push origin HEAD:main` moves the remote; the integrator checkout stays where it was. Minutes after landing, the orchestrator read `publish/route.ts` in the main checkout, saw the PRE-redesign code thirteen commits stale, and nearly reported a deleted escape hatch as a live defect. **Fast-forward the main checkout immediately after every land, before reading anything from it.**
3. **A foreign uncommitted file will block your rebase, and it is still not yours to commit.** Use `git rebase --autostash`, then verify BOTH that the stash count is unchanged and that the file is still modified afterward. A silent `stash pop` failure dropped a builder's edits that same day, so the pop is not to be trusted without checking.

Related, and the reason rule 2 in the list above says identify by CONTENT: a peer read `⌥ wor…` on another pane's status line, concluded it was a linked-worktree marker, and sent a confident correction saying the orchestrator was working inside the branch it was judging. **It was a truncated cmux label.** `git rev-parse --show-toplevel` settled it in one call. A peer's correction is a claim like any other, including when it is well argued and cites the right rule.

### Never estimate your own context

On 2026-08-08 an orchestrator announced it was at "roughly 60%" and offered to hand over. It was at **28%**. Nothing was wrong with the arithmetic because there was no arithmetic: it inferred from how much it had read. The status line is rendered in the terminal, not in the conversation, so **you genuinely cannot see your own context from the inside, and you must not guess at it.** The mechanism is the one already used on peers all day:

```bash
cmux read-screen --surface "<your own surface>" --lines 4
```

Find your own surface ref by content the same way you find anyone's. Do this before claiming headroom, before proposing a handoff, and before dispatching anything long. An invented number here does real damage in both directions: it hands over a healthy session early, and it can talk a nearly-full one into starting something it cannot finish.



### Five rules, each from something that went wrong

1. **The prompt line in a peer's pane may be AUTOFILL, not the user.** This build suggests actions in the input line by default. On 2026-08-08 the orchestrator read a suggestion sitting in a peer's prompt and nearly treated it as an owner instruction. **Text in a peer's input box is machine-generated until proven otherwise.** Instructions come from your user, in your own conversation.

   **It happened AGAIN later the same day, on a second pane, so this is the most repeatable trap on the list.** A builder's input line read `repoint instead of remove, thread the flag, implement al…`, which is exactly the ruling the orchestrator was about to make. Plausible, on-topic, and nobody wrote it. The owner then supplied the tell: **in the terminal, autofilled text is DARK GRAY and real typed input is WHITE.**

   **You cannot see that, and must not pretend to.** `cmux read-screen` is documented as returning "terminal text as **plain text**", and reading its raw bytes confirms no ANSI escapes survive - only box-drawing characters. The colour tell is real and reliable **for the human looking at the screen**; it is invisible to you. Do not infer it from wording, and do not ask the owner to check every time.

   **The fix is not detection, it is never being exposed to it: send `cmux send-key --surface "surface:N" "ctrl+u"` to clear the input line BEFORE you send anything.** Then whatever was sitting there cannot merge with your message or be submitted by your Enter. Make it the first step of every dispatch, the same way `--no-focus` and ref validation are reflexes. When the text matters (a peer appears to have been given an instruction you did not send), the only sound move is to ask the owner, in your own conversation, rather than reading tea leaves.
2. **An invalid surface ref silently resolves to your own surface.** `cmux identify --surface surface:N` happily reports `workspace:1` for refs that do not exist, so enumerating that way produces a list of lies. **Identify panes by CONTENT** (`read-screen` and look at what is on it), never by whether a ref resolves.
3. **`read-screen` before assuming a peer is working, and before assuming one is still busy.** On 2026-08-07 a delegated agent reported "done pending the verifier" and stopped; its verifier had gone idle and was never going to wake it. That deadlock looked like progress for hours. A single screen read shows the difference between thinking and stalled.

   **The 2026-08-08 instance is the mirror image and cost half an hour: a peer's completion report can sit on its pane and NEVER ARRIVE AS A MESSAGE.** A builder finished the publish-meter fix, wrote a full report with its shas, and the orchestrator never received it. `ListAgents` showed the session as `idle`, which is exactly what it shows for a session that is still thinking, so from the outside "finished twenty minutes ago" and "mid-task" are indistinguishable. The work sat unlanded until a routine screen read found it. **Treat the inbox as best-effort and the pane as ground truth**: before concluding a peer is still working, read its screen. A finished builder is cheap to notice and expensive to forget.
4. **Do not guess slash commands into someone else's terminal.** Two failed attempts is the limit; then hand it back. `/ultracode` was tried once, did nothing visible, and was dropped rather than fumbled at.
5. **Set model and effort at the moment of dispatch, not once per terminal.** A pane inherits whatever it was last set to. On 2026-08-08 a peer sat idle on Fable 5 with nothing to do. Match the tier to the task class: `low`/`medium` mechanical, `high` normal feature work, `xhigh` hard multi-file, the top-tier model only through a premium-model gate (a `fable-5-prompting`-style skill, or a written justification in the brief). Note that `ultracode` is a separate axis: it makes a session fan out multi-agent workflows by default, which is right for an audit and wasteful for a builder executing a spec.

### Refreshing a peer's context

Long-running panes go stale. Before clearing one, send it a message asking for three things, and wait for the reply:

1. Confirm nothing uncommitted, in its lane **and** in the main checkout.
2. Confirm its lanes are released in `docs/lanes.md`, with honest status, pushed.
3. **A handoff of what it learned that is not already in a doc or on the board**, especially things it tried that did not work.

Everything else survives in git. Point 3 is the only thing a clear destroys, and it is the expensive part. The 2026-08-08 refresh recovered two real hazards this way, including that `docs/lanes.md` is `merge=union` and a rebase can silently duplicate a lane row, which is worse than a duplicate board card because lanes.md IS the lock.

Then `cmux send --surface "surface:N" "/clear\n"`, verify the context bar emptied, and set model and effort for the work that pane is about to take.

### Concurrent agents make your own gates flaky, and the gate must actually gate

Two failures, one turn, 2026-08-08. Both are orchestrator-specific because only the orchestrator runs gates while other sessions are working.

**1. Parallel load produces FALSE REDS.** `swappable.test.ts` walks the filesystem recursively; with two agents running builds on the same disk it blew its 5s timeout and the suite exited 1. Re-run alone: 591ms, green. So under parallel load a red suite is not evidence of a defect until you have checked whether it *asserted false* or merely *timed out*. Read the failure before believing it, and re-run the failing file in isolation. Conversely, do not let this become a reason to wave reds through: a genuine assertion failure looks completely different from a timeout, and the distinction is visible in one line of output.

**2. The gate must GATE, not report.** The push above ran a suite that exited 1 and pushed anyway, because the command was:

```bash
pnpm test > log; echo "VITEST_EXIT=$?"   # prints the code, enforces nothing
... ; git push
```

Printing an exit code is not judging it. Chain the push behind the gate so a red cannot proceed:

```bash
pnpm test > log 2>&1 || { echo "TESTS RED — stopping"; exit 1; }
pnpm build > log 2>&1 || { echo "BUILD RED — stopping"; exit 1; }
git add <explicit paths> && git commit -F - <<'EOF'
...
EOF
```

The commit that slipped through touched only a command file, so nothing was at risk, and that is luck rather than process. **The orchestrator is the session most likely to make this mistake**, because most of its commits are docs and the gates feel ceremonial. They are not: the docs commit is the one that rides along with someone else's code on the same `main`.

**3. A PIPE HIDES THE EXIT CODE, which is the same mistake wearing a different costume.** On 2026-08-08 an orchestrator chained `git rebase origin/main 2>&1 | tail -1 && git push`. **A pipeline's exit status is the LAST command's**, so `tail` succeeded, the `&&` passed, and the push ran even though the rebase had refused outright ("cannot rebase: you have unstaged changes"). It was harmless only because `main` happened to be up to date. Any command whose result gates the next one must be judged directly, never through a pipe:

```bash
git rebase origin/main > /tmp/rb.log 2>&1 || { echo "REBASE FAILED"; exit 1; }
```

Capture to a file and read the file. The rule generalises: **if you piped it, you did not check it.**

### Spawned agents are session-bound, and it constrains the handoff

An agent spawned with the Agent tool belongs to the session that spawned it. **A successor orchestrator cannot inherit it and will never receive its completion notification.** Discovered 2026-08-08 while planning a context handoff with a delegated fix agent mid-run.

Three consequences worth planning around:

1. **Hand over at a clean boundary.** The right moment to switch is when nothing you spawned is in flight. If you must switch mid-run, say so in the handoff and give the successor the recipe to verify that work itself: which branch, which worktree, which gates, which doc carries the acceptance list.
2. **Prefer a peer pane over a spawned agent for anything long.** A pane survives your context window, the owner can step into it, and it can be re-briefed by message. A spawned agent is better for bounded work you will personally receive and verify.
3. **Watch your own context against the length of what you dispatch.** Spawning a two-hour agent at 70% is a plan to hand off badly. Check the status line before dispatching, not after.

### Panes the user can step into

The point of running builders as panes rather than as spawned subagents is that the owner can take over any of them mid-task. That changes two things about how the orchestrator briefs them. Every dispatch must be self-contained enough that a human reading the pane cold can see what the session is doing and why. And the orchestrator must not treat a pane's state as private: the owner may have typed into it, changed its model, or answered a question directly. **Re-read the pane rather than assuming your last message is the last thing that happened in it.**

## Dispatch contract

Every assignment message must be self-contained. The receiving session has none of your context.

1. **The task**, and the doc or card that specifies it
2. **What is already true** so it does not redo work or re-derive settled state
3. **An explicit owns-list, and an explicit NOT-list naming the other active sessions and their files**
4. **Lane claim first**: register in `docs/lanes.md` and commit that before touching code
5. **The boundaries**: gates green before every commit judged on exit code; no prod data writes; no live agent pushes; nothing published to a real external account
6. **What to report**: what shipped, what did not, gate exit codes

**Never ask a peer to do something your own permissions blocked.** That is permission laundering and it bypasses a decision the owner made. Route it back to the owner instead.

---

## Collision discipline

The shared-checkout collision has now bitten five-plus times and every instance traces to the same thing: uncommitted work sitting in `accounts/`.

- `git status` immediately **before** `git add`, not only at the start of a task
- Stage explicitly. Never `git add -A`
- Chain edit-then-commit with `&&` so an aborted edit cannot be followed by a commit
- **Never sweep another session's uncommitted work into your commit.** If you find foreign changes, identify them, leave them, and ask that session to commit its own work. Committing it "helpfully" destroys attribution and has destroyed content
- `backlog.md` and `lanes.md` are union-merged: a cross-lane rebase can silently DUPLICATE rows with no conflict markers. Check row counts after every rebase, and grep for conflict markers after any grooming commit

---

## What the orchestrator does not do

- Feature work in the main checkout
- Publishing to live external accounts, ever, on anyone's behalf
- Prod data writes without explicit owner go-ahead in that session
- Restructuring another agent's cards (`codex`'s cards, or any other agent's if a second agent is ever added)
- Resolving cross-session git states (stashes, other lanes' branches) on its own initiative
- Escalating to the top-tier model without the premium-model gate (or a written justification in the brief). On 2026-08-07 the gate correctly routed a well-specified build to the mid tier, precisely because the session had already removed the ambiguity that would have justified the premium
