# Parallel multi-worktree agent throughput — measured facts

**Date:** 2026-08-05
**Status:** current-reference. Every number here was measured on this machine (M1 Max, 10 cores,
64 GB, repo on `/Volumes/files`). Where a measurement contradicted an assumption — mine or a
reviewer's — the measurement is recorded as the finding and the assumption is named.

---

## The unlock: hard write isolation

Feature throughput is roughly `N_safe_writers × work_rate`. `N` was pinned at **1** by policy,
because `--cwd` is a starting directory, not a boundary: a worker handed a worktree path still
wrote into the main checkout.

Two mechanisms were proposed and **rejected**:

- *Rewrite absolute paths in the worker's prompt.* Advisory only. A worker also reads `AGENTS.md`,
  `agents/rules/**` and its role memory, **5 of which name the main path literally**. A prompt
  cannot unsay those.
- *Post-run "did main get dirty" check.* That is detection **after** the damage, and with two
  concurrent writers it cannot even attribute which file came from which worker.

The mechanism that works is a **hard control**, proven with a control/treatment pair:

| Run | Command | Result |
|---|---|---|
| control | worker with `--cwd` elsewhere, asked to write an ABSOLUTE path under main | file created in main |
| treatment | same prompt + `--deny 'Write(<main>/**)' --deny 'Edit(<main>/**)'` | *"denied by a permission policy"*, no file |

Implemented in `tools/openclinxr/openclaw/dispatch-worker.ts`. `dispatch()` applies the boundary
itself rather than leaving it to callers, so no dispatch path can forget it. The dirty check
survives **only** as a tripwire that fails the dispatch if the boundary ever leaks.

**Constraint discovered:** worktrees must live OUTSIDE the main checkout, or the main-tree deny
blocks the worker's own edits. `resolveWorkerWorktree` throws on any path under main rather than
failing mysteriously later.

---

## Measured costs — three assumptions refuted

### A worktree costs 0.35 GB, not 1.2 GB

`du` reports ~1.2 GB of `node_modules`, and both I and an external reviewer treated that as the
per-agent disk cost. Measured properly — free-space delta across a real `git worktree add` +
`pnpm install`:

```
REAL disk consumed by one full worktree + install: 0.35 GB
```

The gap is APFS block sharing. `du` reports *apparent* size; the blocks are shared with the pnpm
store. At N=10 that is **3.5 GB of 2.3 TB free**.

**Consequence: disk is not the ceiling, and was wrongly predicted to be the primary binding
constraint as N grows.**

### Hardlink count is the wrong signal on APFS

`nlink > 1` sampling returns **0/400** even for a worktree on the *same* volume as the pnpm store.
That is not evidence of duplication: pnpm on macOS uses `clonefile()` copy-on-write, which shares
blocks **without** raising the link count.

A theory that the 0-hardlink result was caused by worktrees sitting on a different APFS volume
(`/System/Volumes/Data`) from the store (`/Volumes/files`) was tested and **disproven** — a
same-volume worktree installed in 8s vs 10s (marginal) and still sampled 0/400 hardlinks.

### Setup is cheap

| Step | Cost |
|---|---|
| `git worktree add` | ~2 s |
| `pnpm install --prefer-offline` | 8–10 s |
| Real disk | 0.35 GB |

---

## Verification actually holds in worktrees

A fresh worktree has **no `node_modules`**, so `pnpm test` fails there with
`Local package.json exists, but node_modules missing`. That raised a real doubt about whether
delegated workers were verifying before committing or silently skipping.

Resolved by probe rather than assumption: the pre-commit hook **is** reachable from a linked
worktree and **blocks** the commit when `node_modules` is absent. Since every delegated worker's
commit succeeded, each must have installed and passed the gate.

**The pre-commit hook is therefore the thing that makes delegated verification trustworthy.** It is
not merely a convenience — it is the guarantee. Weakening it (or bypassing with `--no-verify`)
would silently remove the only enforcement that delegated work was verified at all.

---

## Concurrency results

| Wave | Work | Result |
|---|---|---|
| 1 | backlog #24, #30, #31 | 3 concurrent, 0 conflicts, gate green |
| 2 | shared turbo cache, multi-slot lease, path-scoped hook | 3 concurrent, 0 conflicts, gate green |
| ceiling probe | 6 concurrent workers, each install + test | **6/6 succeeded, 121 s wall-clock** |

Main stayed at **0 dirty lines** across all of it. `N ≥ 6` is demonstrated; the true ceiling is
still unmeasured, and the likely binding constraint is CPU (10 cores) rather than disk or install.

## Supporting unlocks shipped alongside

| Change | Proof |
|---|---|
| Shared turbo cache via `TURBO_CACHE_DIR` (absolute `cacheDir` in `turbo.json` is rejected by turbo 2.9.14) | a DIFFERENT worktree got **4/4 cache hits** off main's builds; 2 simultaneous builds against one cache dir produced no corruption |
| Multi-slot lease by slice | same-slice acquire **blocks** (`held`); disjoint slice **acquires** |
| Path-scoped pre-commit | **17 s → 3 s**, and a planted 700-line file-size violation **still blocked** the commit |

---

## Housekeeping finding

`~/.grok/worktrees/src-openclinxr` had grown to **84 GB across 62 directories, of which only 3 were
registered worktrees** — abandoned `subagent-*` trees from earlier sessions. Removed; 84 GB
reclaimed.

Worth automating: a worktree that is unregistered (`git worktree list` does not contain it) and
older than a threshold is garbage. Nothing currently prunes these, and at 1–2 GB apparent each they
accumulate quickly under heavy delegation.

---

## Open

- **Ceiling unmeasured.** N=6 works. The experiment to find the real limit is a fixed synthetic
  work unit swept over N ∈ {1,2,3,4,6,8}, measuring `speedup(N) = T_wall(1)/T_wall(N)` and stopping
  when efficiency drops below 0.5.
- **No serial control**, so no defensible speedup multiple — only that 6 items landed where policy
  previously allowed 1.
- **Integration is now the pin.** Merging each branch and running the full gate is serial and
  orchestrator-owned. Amdahl: if integration is 40% of wall-clock, even perfect parallelism caps at
  2.5×.
