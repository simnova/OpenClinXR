---
name: agent-session-continuity
description: Pointer to the canonical session/resume rules. A wrong session id CONFABULATES rather than erroring; killed dispatches write no ledger entry; resumes need three env vars. Canonical text lives in PROTO_VERIFY_DELEGATION — this exists only because that file is 4,000 lines deep and stopped binding.
when-to-use: resume a worker, --resume, session id, killed dispatch, maxTurns, worker died, continue a thread, updates.jsonl, worker-sessions.jsonl, retro
---

# Continuing a conversation with an agent — pointer

**This is a POINTER, not a copy.** Ruled 2026-08-20: an earlier version restated the tables and was a
second drifting copy. The canonical text is `agents/rules/PROTO_VERIFY_DELEGATION.md`. This file
exists only because that one is ~4,000 lines of append-only prose whose own header says the
directives were *"buried there is how they stopped binding"* — so the trigger lives here and the
content stays there.

## Read these before resuming anything

| topic | canonical section |
|---|---|
| a wrong session id **confabulates**, it does not error | §6c |
| verify the resumed session contains YOUR brief before trusting it | §7g |
| one slice can log **two** sessions; the dispatcher reports the LAST — take the one with most turns | §6b-bis |
| killed dispatches write **no ledger entry**; read the session directory | §10c |
| judge a kill by the **worktree**, not the task status; resume is ~5–10 turns vs a re-implement | §10d, §7i |
| a resume can restore and execute **nothing** — the tell is flat `updates.jsonl` | §10j |
| retro **after** landing, never mid-flight | §6b, §6c |

## The three env vars — the one thing NOT written down elsewhere as a command

```bash
OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1 \
  ~/.grok/bin/grok -p "<short delta>" --resume <id> --model <same> --output-format json --cwd <worktree>
```

Drop `OPENCLINXR_WORKER=1` and the SessionStart docs-hygiene hook fires: the worktree fills with
`docs/_archive/**` and `PROJECT_STATUS.md` churn before the worker reads a word. That was an open
mystery for weeks (§9r, §11g) and the cause is a missing env var on the resume — §11p.

**NEVER `dispatch({ worktree: true, resume })`** — it runs `git reset --hard main` + `git clean -fd`
before reattaching, destroying the work the resume exists to save. A bare `grok -p --resume` needs
`contract-verify-cli` afterwards, because only `dispatch()` writes a contract report (§11h).

## Liveness

Sample **≥90 s** and compare `updates.jsonl` growth. CPU misleads — a capture-heavy slice burns
wall-clock in subprocesses. Wedge signature: **~6 s CPU then flat**. A fresh no-resume session is the
control that separates a dead thread from a dead harness.
