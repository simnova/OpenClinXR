---
name: grok-worker-monitoring
description: How to watch a dispatched grok worker, converse with it across checkpoints, and route work to the right model. Three observation planes and what each can answer - the unified log is the only one that records CAUSES. Model capability table with verified capabilities and measured failure modes. Read when a worker looks stalled, before choosing a model, or before resuming a thread.
when-to-use: worker stalled, no output, zero files written, is it hung, unified.jsonl, inference_retry, empty_response, which model, model routing, ox-alpha, deepseek 402, multimodal, vision grading, resume a checkpoint, staged dispatch, checkpoint return, monitor a dispatch, kill a worker
---

# Watching a worker, talking to it, and routing to the right model

Complements: `orchestrator-dispatch-loop` (how to dispatch/integrate), `delegated-worker-contract`
(the worker's obligations), `agent-session-continuity` (resume/session-id rules),
`large-task-orchestration` (fan-out). This skill owns **observation, conversation and routing**.

---

## 1. THREE OBSERVATION PLANES - and only one records causes

Most wasted diagnosis comes from reading the wrong plane. They answer different questions.

| plane | path | answers | does NOT answer |
|---|---|---|---|
| **ledger** | `.openclinxr/openclaw/worker-sessions.jsonl` | did it spawn? did it complete? turns, proofsOk, model, worktree | anything mid-flight |
| **transcript** | `~/.grok/sessions/<url-encoded-cwd>/<sessionId>/updates.jsonl` | WHAT it is doing - tool calls, command titles, growth rate | WHY it stopped |
| **unified log** | `~/.grok/logs/unified.jsonl` | **WHY** - inference retries, empty responses, auth-lock contention, startup timing | fine-grained tool detail |

**The unified log is the one people forget.** It is documented in the bundled guide
(`~/.grok/docs/user-guide/`, "Internal log files") and it is where a stall explains itself.

```bash
L=~/.grok/logs/unified.jsonl
grep "<sessionId-prefix>" "$L" | grep -iE "retry|error|fail|429|rate" | tail -6
```

### The stall signature that cost a full dispatch

A worker at 0.1% CPU, transcript frozen, zero files, no crash. Read as "hung on a bad brief".
The log said otherwise:

```json
{"msg":"shell.turn.inference_retry",
 "ctx":{"attempt":1,"max_retries":15,"kind":"empty_response",
        "reason":"empty response from model (no_visible_content)"}}
```

**It was a provider failure in retry backoff, not a briefing failure.** Every symptom is explained:
low CPU = waiting on backoff; no transcript growth = nothing to emit; no crash = still retrying.

**Rule: symptoms constrain a cause, they never name it.** Before attributing a stall to a brief,
grep the unified log. It is one command.

### Liveness checklist, in order

```bash
# 1. Is it alive and burning CPU, or idle?
ps -o %cpu=,etime= -p "$PID"
# 2. Is it emitting? (compare over a real window, not once)
L1=$(wc -l < "$D/updates.jsonl"); sleep 120; L2=$(wc -l < "$D/updates.jsonl")
# 3. Is it isolated where you think? (NOT the main checkout)
lsof -a -p "$PID" -d cwd
# 4. WHY did it stop?
grep "<sid>" ~/.grok/logs/unified.jsonl | grep -iE "retry|error" | tail
# 5. Is there work to preserve before any kill?
git -C "$WORKTREE" status --porcelain | wc -l
```

### Monitoring traps, each paid for

- **`pgrep -f <pattern>` matches the monitor's own command line** - the pattern is in it. Reported a
  finished worker as live for a full cycle. Grep a durable artifact instead.
- **`pkill -f <tool>` kills your own worker** - it is running that tool too. Kill by PID, and guard
  with `|| true`. Never start a delegate while a long local job is running.
- **Never set `RUST_LOG` or `GROK_LOG_FILE` for debugging** - grok logs the bearer API token in
  plaintext. Read the existing unified log instead.
- **Do not judge a worker's TREE mid-flight** - it produced a false accusation once. Reading the log
  to check for a stall is fine; grading artifacts is not.
- **A worktree that looks empty may hold a commit.** `git status --porcelain` is clean after the
  worker commits. Check `git log --oneline main..HEAD` too.
- **Diff against the MERGE-BASE, not `main`.** Commits landed on main after the worktree was cut show
  as deletions in `main..HEAD` and look like the worker deleted your files.

---

## 2. MODEL ROUTING - verified capabilities and measured failure modes

Update this table when a capability is **measured**, not when it is claimed.

| model | route | context | tools | vision | status / failure mode |
|---|---|---|---|---|---|
| **`ox-alpha`** (OpenRouter `stealth/ox-alpha`) | `[model.ox-alpha]` in USER config, `env_key = OPENROUTER_API_KEY` | **1,048,576** | **VERIFIED** - wrote and read a file in 3 calls | **VERIFIED** - see calibration below | Free promotional window. **RISK: returns `empty_response` / `no_visible_content` on large accumulated context** (observed ~325 turns deep) and the harness then retries up to 15x, looking exactly like a hang. |
| `deepseek-v4-flash` / `deepseek-v4-pro` | `[subagents.models]` USER config | 1M | yes | **NO - text only** | Cheap tier. **Returned HTTP 402 Insufficient Balance on every dispatch** in the 2026-08-21 session. Check balance before routing here. |
| `grok-4.5` | spawn-time `model` | - | yes | yes | The sanctioned fallback **on a 402 only**. |
| `grok-4.6` | superagent thread, `--resume <id>` | - | yes | yes | **Never for worker tasks.** Reserve for: a grade it owes, a measurement that contradicts it, a worker `UNABLE:`, a write-scope collision. |

### Config facts that bind

- **Project `.grok/config.toml` does NOT merge `[subagents.models]`.** Child routing must go in the
  **USER** `~/.grok/config.toml`. Proven 2026-08-04.
- **Never put a literal `sk-...` in any `.toml`.** Use `env_key = "NAME"` and export in `~/.zshrc`,
  outside the repo. Verify with `grep -rl "sk-or-v1-" .` returning nothing.
- Spawn-time `model` overrides config. A role whose policy names a higher tier needs
  `modelDowngradeReason` or the dispatch **fails closed** (#461).
- A model must be listed by `grok models` before `--model <alias>` resolves.

### Vision calibration - what "multimodal" was actually verified to mean

Do not adopt a vision claim; test it against images whose ground truth you hold, using a filename that
gives nothing away, and offer an explicit "CANNOT VIEW" escape.

| probe | ground truth | result |
|---|---|---|
| texture atlas under a neutral filename | leopard print + rose panels | described rosettes on golden-mustard, the trim band, and the five-block lower third - **added detail the grader had not recorded** |
| 60x28 native crop at 6x LANCZOS, **unwarned** | SMOOTH | **SMOOTH** |
| same crop with a real 3px zigzag injected, **unwarned** | RAGGED | **RAGGED** |
| 100x120 thumbnail, fine pose question | not pixel-resolvable | **rejected interpolated upscale on its own**, switched to nearest-neighbor + pixel classification |

**The pair matters, not the single positive.** A model that always answers SMOOTH passes the second
row. The injected-zigzag control is what proves it discriminates.

**What vision does NOT change: the producer/grader split.** A worker may grade ANOTHER slice's
artifacts. It may **not** be the sole grader of its own output - a fabricated `score.json` in this
repo's history was an agent scoring itself, and seeing does not make a model disinterested. Put this
in the brief verbatim: *your visual report on your own output is EVIDENCE, not a verdict.*

---

## 3. CONVERSATION - checkpoint returns, not fire-and-forget

A live worker is **not addressable**. The session id is in the ledger the moment it spawns, but that
is for kill-recovery; two processes writing one `updates.jsonl` is a real hazard. **Talk at returns.**

### Staged dispatch

Split `done_when` into **groups**. Do not invent `stage:` rules - `briefFromIssue` refuses narrative
proofs. Stage N's gate is the existing rules for that group; integrate still requires the full list.

**The brief MUST say this, verbatim, or staging never happens:**

> Returning with GROUP A green and GROUP B UNRUN **IS SUCCESS for this process.**

Without it the worker finishes the whole slice - the same gradient that makes "optional wiring" never
happen.

### Checkpoints are ARTIFACTS, not pauses

Measured failure: a "giant effort" brief said *do not stop at a checkpoint*, and the worker read that
as *no artifacts until done*. It performed 82 correct sequential actions and wrote **zero files**,
because:

1. the first write was **ill-defined** - the brief coupled the artifact's schema to its last consumer,
   so nothing could be written until the whole chain was understood;
2. there was **no early `exists:` proof**, so intermediate files had no contractual existence -
   reading was safe, writing was risky, and the gradient was all-reconnaissance;
3. **"GIANT" scaled preparation to the declared size.**

**Fix, and it is wording:**

> STAGE GATE: `<a -> b -> c -> d -> e>`. **Proof 1 of 5 is due in your first ~10 actions**: write
> `<first artifact>` before ANY downstream code. Its schema is pinned below - do not read `<consumer>`
> first. **Checkpoints are artifacts, not pauses** - never stop the process, never skip a stage
> artifact.

### Resuming

```bash
OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1   ~/.grok/bin/grok -p "<short delta>" --resume <sessionId> --model <same>   --output-format json --max-turns <n> --cwd <worktree>
```

- **NEVER `dispatch({worktree:true, resume})`** - it resets the worktree and destroys the work.
- **Never resume a slice whose ledger shows `spawned` with no `completed`** - it is still live.
- The three env vars are not optional: without `OPENCLINXR_WORKER=1` a SessionStart hook runs doc
  hygiene and dirties the tree before the worker acts.
- A wrong-but-existing session id **confabulates** rather than erroring. Take it from the ledger
  programmatically; confirm `Session ... found locally` on stdout.

### What to put in a delta

Hand back **numbers and what you accept**, never a story.

1. the measurement, in full, including how you obtained it
2. what you ACCEPT of its work, by name, so it does not redo it
3. an explicit non-accusation when you disagree with a judgement rather than a fact
4. the ONE measurement that splits the remaining ambiguity

Rank *methods* if you have a preference; **never rank causes** - a ranked cause costs a turn of
story-fitting. "Candidates, unranked, and they may all be wrong" is free.

---

## 4. BRIEF HYGIENE THAT SHOWS UP IN MONITORING

- **Any number in a brief becomes a target.** Telling a worker "the source has 66 joints" makes a
  worker whose clip drives 31 pad to 66. Say: *that number is context; report the measured count.*
- **Convert `it.fails(` to `it(`** in the same change that makes a clause pass. A `run:` proof on a
  planted RED passes **only while the defect stands** - contract-green can mean nothing was fixed.
- **`gh` bodies with backticks go through `--body-file`**, never an inline double-quoted string -
  the shell expands them and mangles the record. Same for commit messages (`-F file`).
- **Give a stopping condition, not a work list.** Parallel delegation makes over-building nearly free.

---

## 4b. GIVE ABSOLUTE PATHS FOR EVERY OUT-OF-REPO INPUT

An early-artifact instruction cannot bind if the worker cannot reach the input.

**Measured.** A brief said *"proof 1 of 5 is due in your first ~10 actions"* and named its source as
`human-base-animations.glb` - a bare filename. The file lives OUTSIDE the repo under
`~/.openclinxr-tools/...`. The worker burned roughly ten actions searching for it:

```
find . -iname "*human-base-anim*"
grep -rln "human-base-animations" --include=...
mdfind -name "human-base-animations.glb"
find /Users/patrick -...
D=/Users/patrick/.openclinxr-tools/mesh2motion-app; find "$D" -name ...
```

By the time it had the path, the "first ~10 actions" budget was gone - **the instruction did not fail,
it was made unreachable.** The worker did nothing wrong; searching was the only way to proceed.

**Rule.** Every input the brief names gets an ABSOLUTE path if it is outside the repo, and a
repo-relative path if inside. Verify each one resolves before dispatching:

```bash
for f in "$SRC_CLIP" "$TARGET_MAP" "$SUBJECT_GLB"; do
  [ -e "$f" ] && echo "ok   $f" || echo "MISSING  $f"   # a MISSING here is a brief defect, not a worker one
done
```

This is the §6k family - *name the probe that already works*. Naming a thing is not naming where it
is. The same applies to tools installed outside the repo (Blender addons, provider caches, model
clones): give the full path once, in the brief.

**Corollary for monitoring.** When a worker's action trace shows repeated `find` / `mdfind` /
`grep -rln` for the same token, that is not exploration - it is a missing path in your brief. It is
visible in the transcript within the first few minutes, and it is cheap to prevent and expensive to
watch.

---

## 5. QUICK REFERENCE

```bash
# who is live, and where
ps -eo pid,etime,command | grep '[.]grok/bin/grok'
lsof -a -p "$PID" -d cwd

# the three planes
grep '"slice":"issue-N"' .openclinxr/openclaw/worker-sessions.jsonl        # spawned/completed
D=$(find ~/.grok/sessions -maxdepth 2 -type d -name "<sessionId>"); wc -l < "$D/updates.jsonl"
grep "<sid>" ~/.grok/logs/unified.jsonl | grep -iE "retry|error" | tail    # CAUSES

# distinct actions (is it looping, or traversing?)
python3 -c "import json,re;[...]"   # dedup consecutive update titles

# safe kill (worktree checked FIRST)
git -C "$WT" status --porcelain | wc -l && git -C "$WT" log --oneline main..HEAD
kill "$PID" 2>/dev/null || true
```
