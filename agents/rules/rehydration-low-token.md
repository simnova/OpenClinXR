---
authority: agent-methodology
---

# Rehydration, Low-Token Autonomy, and Efficient Practices

## Required Resume Sequence (at start of any session, after compaction, before deciding to stop)
1. Re-read this `AGENTS.md`.
2. Read `PROJECT_COORDINATION_INDEX.md`.
3. Read `AUTONOMOUS_WORK_PLAN.md`.
4. Read `docs/openclinxr/worker-backlog-and-validation-matrix.md`.
5. Select the next approved local deterministic product-advancement slice from those docs.
6. Continue implementation unless a stop condition is reached.

If context feels incomplete, re-read these files and continue from the documented next slice.

## Efficient Rehydration + Working Model
- The snapshots at the top of the three state files (first 20-80 lines) + AGENTS.md top are the fast-path context.
- For history/audit only: use `tail -50 FILE | grep -E '(Next queued|Product path|Blueprint/factory)'` or `tail -100 FILE` – never full read unless synthesizing iteration.
- Use `read_file` with `offset` + `limit` (e.g. limit=30) on any file >100 lines.
- Always prefer the `grep` tool (with path, glob, head_limit, -B/-A) over `read_file` or `cat` for exploration.
- For generated artifacts: use `grep` or terminal `ls docs/openclinxr/ | grep peds` + read specific registered JSONs only.
- For tests/verif: `pnpm --filter ... test -- -t "exact test name substring"` (focused).
- `pnpm exec biome check specific/file.ts` not whole.

## Commands for Speed/Longevity
- Cheap guards first: `pnpm agent:alignment` (0.5s) before any `agent:verify` or full hygiene.
- Long run: `pnpm openclaw:lease -- acquire --owner <you> --slice <current> --ttl-minutes 60` before edits; release after state update. Use `pnpm openclaw:lease -- status`.
- Preflight for days-long: `pnpm openclaw:preflight && pnpm docs:drift-check && pnpm openclaw:lease -- status`.
- Post every slice: `pnpm openclaw:post-slice`.
- Use AI `scheduler_create` + `monitor` tools for persistent background heartbeat/lease watch.
- `pnpm docs:artifacts` only after coherent batch that produces new registered outputs.

## State & No-Interruption
- All durable state ONLY in the 3 canonical md (snapshots + per-slice records) + registered artifacts + agents/** memory + .agent-factory reports. Never chat-only or temp md.
- On heartbeat/force-response/compaction/recovery: re-read snapshots (4 files), `git status --short`, `pnpm openclaw:lease -- status`, repair current if lease allows, else pivot to next from queue. Record recovery in next slice record.
- Lease prevents overlapping edits across heartbeats/agents.
- For subagents: always one coordinator first (read-only), narrow non-overlap, map to repo roles, close threads promptly, integrate to state files.
- Anti-interruption: small slices only (<1h ideal), immediate next after record+verify. Use focused verif only on touched.

## Token Saving (Grok specifics)
- Parallel tool calls for independent reads/greps.
- `run_terminal_command` with `timeout` short, `description` concise.
- Never output full long command results unless delta; use `| tail -N` or `| head`.
- For image/screenshot review: use when verifies touched behavior only.
- If context feels full: stop, re-read only snapshots, continue product without summary chat.
- Prefer edit with `search_replace` (exact old->new, unique) over write new.

## Drift/Toil Prevention (hyper guard)
- Never 2+ evidence-only without drift review + coordinator consult + product pivot.
- `pnpm agent:alignment` catches stale breadcrumbs in docs.
- Use `agents/adversarial/openclaw-drift-police/` (read charter+memory) on any suspicion of sprawl or one-off.

Violating these increases token use, risk of drift, and interruption. These practices make multi-day unattended completion feasible with minimal context.
