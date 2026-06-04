---
title: Hyper Token-Efficient & Long-Run Practices (for uninterrupted agentic completion)
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-04
relates-to: AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, agents/rules/long-running-autonomy.md, agents/rules/drift-toil-prevention.md
---

# Hyper Token-Efficient & Long-Run Practices (for uninterrupted agentic completion) [snapshots-first rehydrate; UI-XR runtime evidence consumer; Apple M1 Max 64 GB primary]

**New Owner Efficiency Overhaul (2026-06):** As owner, purged historical bloat for utmost productivity: iterations/0001-0008 + proposals/ + docs/superpowers/ + 80+ historical-synthesis md + 300+ old dated png/json artifacts from docs/openclinxr/ (screenshots/evidence/ full purge of pre-05-28 visuals; 39M->6M). agents/ slimmed from 70 roles/555 files to 9 core (chief-coordinator, openclaw-drift-police, implementation-plan-gap-attacker, implementation-planning-lead, asset-pipeline-lead, xr-systems-architect, vp-engineering-delivery, pediatrics-physician, clinical-safety-critic) + historical-roles/ archive (or purged). Registries auto-slimmed (historical-synthesis 84->10, generated 819->440, agent-memory 140->18). Ledgers use snapshots + tail|grep; no full reads. Full iteration loop deprecated for routine (synthesis only; 0009 kept as rare example). Core policy: if not advancing current product (UI-XR consumer + materialization) or enabling sustained OpenClaw autonomy on M1 Max, purge or consolidate. Always: targeted grep/read_file(limit), lease, focused -t, post-slice guards, per-slice records. Rehydrate now <5s effective. Update this section on future evolutions.

To achieve hyper-optimized state for long-running, low-interruption, token-efficient agent work (Grok/Codex/Claude/etc. over days):

**Rehydration (always first, low token):**
- Read *only* the "Current State Snapshot" blocks (first 20-80 lines) in PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, worker-backlog-and-validation-matrix.md + AGENTS top.
- For history/audit only: use terminal `tail -50 FILE | grep -E '(Next queued|Product path|Blueprint/factory)'` or `tail -100 FILE` – never full read unless synthesizing iteration.
- Use `read_file` with `offset` + `limit` (e.g. limit=30) on any file >100 lines.

**Searches & Evidence (avoid bloat):**
- Always prefer the `grep` tool (with `path`, `glob`, `head_limit`, `-B`/`-A`) over `read_file` or `cat` for code/docs exploration.
- For generated artifacts: use `grep` or terminal `ls docs/openclinxr/ | grep peds` + read specific registered JSONs only; do not walk 800+ files manually.
- For tests/verif: `pnpm --filter ... test -- -t "exact test name substring"` (focused, fast, low output).
- `pnpm exec biome check specific/file.ts` not whole.

**Commands for speed/longevity:**
- Cheap guards first: `pnpm agent:alignment` (0.5s) before any `agent:verify` or full hygiene.
- Long run: `pnpm openclaw:lease -- acquire --owner <you> --slice <current> --ttl-minutes 60` before edits; release after state update. Use `pnpm openclaw:lease -- status`.
- Preflight for days-long: `pnpm openclaw:preflight && pnpm docs:drift-check && pnpm openclaw:lease -- status`.
- Post every slice: `pnpm openclaw:post-slice`.
- Get external scheduler prompt: `pnpm openclaw:automation-prompt` (for Codex heartbeat, cron, or AI scheduler_create for recurring "rehydrate + one slice + record").
- Use AI `scheduler_create` + `monitor` tools (this env) for persistent background heartbeat/lease watch without chat blocks.
- `pnpm docs:artifacts` only after coherent batch that produces new registered outputs.

**State & No-Interruption:**
- All durable state ONLY in the 3 canonical md (snapshots + per-slice records) + registered artifacts + agents/** memory + .agent-factory reports. Never chat-only or temp md.
- On heartbeat/force-response/compaction/recovery: re-read snapshots (4 files), `git status --short`, `pnpm openclaw:lease -- status`, repair current if lease allows, else pivot to next from queue. Record recovery in next slice record.
- Lease prevents overlapping edits across heartbeats/agents.
- For subagents: always one coordinator first (read-only), narrow non-overlap, map to repo roles, close threads promptly, integrate to state files.
- Anti-interruption: small slices only (<1h ideal), immediate next after record+verify. Use focused verif only on touched.

**Token Saving in this session (Grok specifics):**
- Parallel tool calls for independent reads/greps.
- `run_terminal_command` with `timeout` short, `description` concise.
- Never output full long command results unless delta; use `| tail -N` or `| head`.
- For image/screenshot review: use when verifies touched behavior only.
- If context feels full: stop, re-read only snapshots, continue product without summary chat.
- Prefer edit with `search_replace` (exact old->new, unique) over write new.

**Drift/Toil Prevention (hyper guard):**
- Never 2+ evidence-only without drift review + coordinator consult + product pivot.
- `pnpm agent:alignment` catches stale breadcrumbs in docs.
- Use `agents/adversarial/openclaw-drift-police/` (read charter+memory) on any suspicion of sprawl or one-off.

Violating these increases token use, risk of drift, and interruption. These practices make multi-day unattended completion feasible with minimal context.

See also: agents/rules/long-running-autonomy.md (unattended contract, heartbeat), agents/rules/drift-toil-prevention.md (anti-toil gate details), AGENTS.md (high-level + resume).

Extracted from AGENTS.md for modularity (LOW_TOKEN targeted reads). This file takes precedence on details where loaded (per source-of-truth order).
