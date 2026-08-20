---
name: agent-session-continuity
description: How to continue a conversation with an agent you already started — worker resumes, superagent threads, killed dispatches. Session ids come from durable records, never from memory; a wrong id CONFABULATES rather than erroring.
when-to-use: resume a worker, --resume, session id, killed dispatch, maxTurns, worker died, consult the superagent, continue a thread, updates.jsonl, worker-sessions.jsonl, retro
---

# Continuing a conversation with an agent

## The rule that governs all of it

**A wrong session id does not fail — it confabulates.** A fresh session loads project memory and answers confidently about work it never did. There is no error to catch. So an id must always come from a **durable record**, never from memory or a scrollback copy.

Confirm `Session <id> found locally` appears on stdout before trusting anything the reply says, and check the answer actually names the slice you asked about. A reply that discusses a different issue is discarded, not interpreted.

## Where ids live

| situation | source |
|---|---|
| dispatch returned normally | `.openclinxr/openclaw/worker-sessions.jsonl` — `grep '"slice":"issue-N"'` |
| **dispatch was killed** | **no ledger entry is ever written** — read the session dir instead |
| superagent / peer thread | the `sessionId` field of its own JSON reply; record it the moment it returns |

```bash
# killed dispatch — newest session for that worktree
d=~/.grok/sessions/%2F<url-encoded-worktree-path>
id=$(ls -dt "$d"/*/ | head -1 | xargs -n1 basename)
```

**One slice can log more than one session, and the dispatcher reports the LAST.** Take the session with the MOST turns — the other is usually a verification leg. A resumed worker that says *"I did not do this work"* is telling the truth; go find the one that did.

## Resuming a worker

```bash
OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 OPENCLINXR_RAW_GROK_SANCTIONED=1 \
  ~/.grok/bin/grok -p "<short delta>" --resume <id> --model <same model> \
  --output-format json --cwd <worktree>
```

**All three env vars are required.** Without `OPENCLINXR_WORKER=1` the SessionStart docs-hygiene hook fires and the worktree fills with unrequested `docs/_archive/**` + `PROJECT_STATUS.md` churn before the worker reads a word. That was an open mystery for weeks; the cause is a missing env var on the resume, not the model deciding to tidy.

**NEVER `dispatch({ worktree: true, resume })`.** `resolveWorkerWorktree` runs `git reset --hard main` + `git clean -fd` before reattaching — it destroys exactly the on-disk work the resume exists to save. A resume that must preserve a tree is a bare `grok -p --resume`, and the branch afterwards needs `contract-verify-cli` because only `dispatch()` writes a contract report.

## Judge a kill by the WORKTREE, not the status

```bash
git -C <worktree> status --porcelain | wc -l
```

Files present → resume, and say *"finish it, do not start over, do not re-plan"* plus the remaining steps; measured at ~5–10 turns versus a full re-implement. Empty tree at main's HEAD → the kill preceded the brief; dispatch fresh.

**Commit the worker's WIP to its branch before any resume.** Uncommitted work is a hostage to the next reap.

## A resume can restore and execute NOTHING

`Session <id> found locally` prints, and then no turns run. The tell is **`updates.jsonl` line count unchanged** across attempts. If two consecutive resumes leave it flat, stop resuming: commit the WIP, start a **fresh session in the same worktree**, and put the state in the prompt.

## Is it alive, or wedged?

Sample for **≥90 s** and compare growth, never a single reading:

```bash
a=$(wc -l <"$U"); sleep 90; b=$(wc -l <"$U")   # $U = the session's updates.jsonl
```

Rising line count = working. CPU alone misleads: a capture-heavy slice burns wall-clock in subprocesses and almost no CPU. The observed wedge signature is **~6 s CPU then permanently flat**; a healthy worker climbs.

**Distinguish a dead thread from a dead harness** with a control: a fresh session, no `--resume`, trivial prompt. If that answers, the thread is wedged and a replacement thread is the fix — carry the state forward in the first message and record the new id.

## Continuing the superagent

Same persistent thread all session, `--model grok-4.6`, same three env vars. Bring **measurements, never narrative**. Report only for: a grade it owes, a measurement that contradicts it, a worker `UNABLE:`, or a write-scope collision. Record `sessionId` from each reply so the thread survives a context loss.

## Retro after landing, not during

Reading a worker's tree mid-flight produces false accusations — it wrote the file a minute later. Resume once work lands and ask what it was *thinking*, not what it did. Attach the retro to a slice that just landed; a standalone sweep across many sessions is evidence work and displaces product work.
