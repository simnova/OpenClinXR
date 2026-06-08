---
authority: agent-methodology
---

# Rehydration, Low-Token Autonomy, and Efficient Practices

See `agents/rules/agentic-lexicon.md` for authoritative LOW_TOKEN targeted rehydration definition (60-80 line snapshots of the 3 state MDs + AGENTS top only; targeted grep/read_file(limit); state exclusively in 3 MDs).

## Compaction / summary handoff
`KV_eviction|summary_handoff` → cold-start rehydrate only (`platform-autonomy-override.md`).

## Required Resume Sequence (session|compaction|conversation-summary handoff; pre-halt)
(Identical to AGENTS.md Required Resume Sequence and agentic-lexicon.md. Re-read AGENTS.md top + PROJECT_STATUS.md + worker-backlog snapshots first.)

## Efficient Rehydration + Working Model
(See agentic-lexicon.md + hyper-token-efficient-long-run-practices.md for full. Snapshots at top of PROJECT_STATUS.md + worker-backlog are fast-path. Targeted tools only. History via `tail | grep` or focused reads.)

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
