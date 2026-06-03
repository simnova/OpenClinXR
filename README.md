# OpenClinXR

OpenClinXR is a blueprint-driven, agent-optimized XR clinical skills exam platform (Step 2 CS-inspired) built as an evidence-gated encounter factory. It uses OpenClaw-style repo-native execution (adaptable across Codex/Claude/Grok/Cursor/etc.) for long-running, token-efficient, uninterrupted autonomous work. Current focus: deterministic UI-XR runtime evidence consumer pipeline + actor/equipment materialization for peds_asthma_parent_anxiety (and ED seed), with all provider/runtime/learner/Quest/production/clinical/scoring gates explicitly false. No production or clinical claims.

Project page: <https://developers.simnova.com/OpenClinXR/>

Target workstation: Apple M1 Max 64 GB (this machine); Quest 3 foreground evidence requires disconnected headset re-run when operator available.

## Current Posture

This repository is early-stage infrastructure and agent-driven factory tooling, not a clinical product. All claims (runtime, voice, XR, assets, model quality) are deliberately scoped by committed evidence artifacts, validators, and OpenClaw per-slice records. Hyper-optimized for agentic use: snapshots for low-token rehydration, Efficiency Quick Refs, lease for safe unattended, drift/alignment guards, focused verification only.

Useful entry points (rehydrate via snapshots first per AGENTS; prioritize current posture over historical plans):

- [Agent operating contract + hyper token-efficient/long-run practices](AGENTS.md)
- [Project coordination index + current snapshot + efficiency quick ref](PROJECT_COORDINATION_INDEX.md)
- [Autonomous work plan + current snapshot + efficiency quick ref](AUTONOMOUS_WORK_PLAN.md)
- [Worker backlog + validation matrix + current snapshot + efficiency quick ref](docs/openclinxr/worker-backlog-and-validation-matrix.md)
- [OpenClaw runbook + token/long-run hyper-opt rules](docs/openclinxr/openclaw-runbook-2026-05-27.md)
- [OpenClaw tool adapters](docs/openclinxr/openclaw-tool-adapters-2026-05-27.md)
- [Blueprint-factory drift guardrails](docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md)
- [OpenClinXR docs + evidence (current-ref only)](docs/openclinxr/)
- Factory generators: tools/openclinxr/factory/ (UI-XR consumer, materialization, publication, review packets)

## OpenClaw Agent Kickoff (Hyper-Optimized for Long-Running, Token-Efficient, Uninterrupted Work)

OpenClaw mode is repo-native (not tied to one host). Codex, Claude, Grok, Cursor, or others participate by anchoring to canonical files and keeping work strictly blueprint/factory-driven (encounter spec drives generated runtime, actors, conversation, assets, review, persistence).

The repo is now hyper-optimized for agentic completion: Current State Snapshots + Efficiency Quick Refs in the 3 state files + AGENTS for low-token rehydration; lease for safe unattended edits; focused verification only; anti-toil + drift guards; scheduler/monitor support for persistent heartbeats without interruption. M1 Max 64 GB is the primary target workstation (Quest requires separate operator re-run).

Naming clarification: this repo is not running an external OpenClaw runtime, daemon, SaaS product, or privileged orchestration service. It uses an OpenClaw-style execution pattern made of repo-native guardrails, role charters, deterministic checks, host adapter prompts, and drift-police enforcement. See AGENTS.md "Hyper Token-Efficient & Long-Run Practices" and the runbook for details.

Before a long run (or after compaction/heartbeat):

```bash
pnpm openclaw:preflight
pnpm docs:drift-check
pnpm openclaw:lease -- status
```

Re-read only the snapshots (first ~60-80 lines) of AGENTS, PROJECT_COORDINATION_INDEX, AUTONOMOUS_WORK_PLAN, and worker-backlog-and-validation-matrix.md. Use `tail | grep` or `grep` tool for history/next.

After a slice, before queue transition:

```bash
pnpm openclaw:post-slice
pnpm docs:drift-check
```

To print the canonical automation prompt (for external schedulers or AI scheduler_create):

```bash
pnpm openclaw:automation-prompt
```

For the full high-confidence readiness gate:

```bash
pnpm openclaw:ready
```

Install repo-local Git hooks:

```bash
pnpm hooks:install
```

The `pre-commit` / `pre-push` hooks run fast OpenClaw hygiene: `docs:drift-check`, `agent:alignment`, and `openclaw:post-slice`.

Run the strict local gate before release branches or broad merges:

```bash
pnpm hooks:strict
```

(Strict runs typecheck + audits + hygiene; not blocking until TS baseline repaired.)

Use `OPENCLAW_SKIP_HOOKS=1` only for intentional emergency bypasses.

If the readiness gate is unavailable, or when debugging suspected drift, run the component checks:

```bash
pnpm docs:authority
pnpm docs:artifacts
pnpm docs:drift-check
pnpm agent:alignment
```

Copy-paste kickoff prompts (condensed; full in AGENTS.md for hosts; see Quick Start above for current).

## OpenClaw Quick Start (Hyper-Optimized, Token-Efficient, Uninterrupted)

Repo-native (adaptable to Codex/Claude/Grok/Cursor/etc. via adapters + runbooks). Anchor to canonicals; work strictly blueprint/factory-driven (case-def drives generated runtime/actors/conversation/assets/review/persist). Current: UI-XR consumer + materialization for peds_asthma_parent_anxiety_v1 (gates false, raw hidden, M1 Max 64 GB primary).

Rehydrate first (always): read AGENTS.md + first ~60-80 lines (snapshots + Efficiency Quick Ref) of PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md. Use `grep` tool (path/glob) + `read_file` limits + `tail | grep` for history. Never broad scans.

Before long run / after compaction:
```bash
pnpm openclaw:preflight
pnpm docs:drift-check
pnpm openclaw:lease -- status
```

After slice (before next):
```bash
pnpm openclaw:post-slice
pnpm docs:drift-check
```

Print automation prompt (for schedulers):
```bash
pnpm openclaw:automation-prompt
```

Full readiness:
```bash
pnpm openclaw:ready
```

Install hooks (pre-commit/push run drift + alignment + post-slice):
```bash
pnpm hooks:install
pnpm hooks:strict   # for merges (includes typecheck/audits)
```

If drift suspected: consult agents/adversarial/openclaw-drift-police/, run pnpm docs:drift-check. Record blockers in operator-*.md with recommended defaults. Update only canonical state files with Per-Slice (product path, blueprint tie, touched, evidence, next).

Host notes (all use snapshots-first, focused `... -t "name"`, lease for edits, no one-off encounters):
- Codex/Grok Code/Cursor: local impl + focused verif + screenshots; diffs against next slice from snapshots.
- Claude: high-level/adversarial; execution hosts do the code+verify.
See full in AGENTS.md (Hyper practices) + protected runbooks/adapters/guardrails (do not weaken).

Do not hand-design scenes; all flows from blueprints through factory/ (tools/openclinxr/factory/). Consult 9 core agents/** only for drift/review cost reduction.

## Verification (Focused, per Anti-Toil)

Engines: Node `>=24.15.0` (.nvmrc), pnpm `>=11.4.0` (pinned). Use `nvm use` if needed.

```bash
pnpm agent:alignment   # cheap first (0.5s)
pnpm docs:drift-check
pnpm --filter @openclinxr/api test -- app.test.ts -t "name"   # example focused
pnpm exec vitest run tools/openclinxr/factory/ui-xr-runtime-evidence-consumer.test.ts -t "consumer"
pnpm security:audit-policy
pnpm security:licenses
```

(Use full `pnpm agent:verify` / typecheck only after coherent batches; see operator-open for known nonblocking strict TS.)

Pages (site in docs/):
```bash
pnpm pages:sync-evidence-links
pnpm pages:validate
```

Site publishes from `main` /docs. Always pair doc updates with product slice + guards.
