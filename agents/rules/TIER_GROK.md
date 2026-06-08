---
title: Grok Tiered Model Routing and Delegation Safeguards
authority: agent-methodology
scope: grok-harness-only
last-updated: 2026-06-07
relates-to: .grok/config.toml, agents/rules/grok-harness-usage.md, agents/rules/agent-consult.md, packages/openclinxr/agent-loop/src/grok-tier-routing.ts
---

# Grok Tiered Model Routing (Harness-Only)

This policy applies **only to the Grok code harness**. Codex Desktop (`.codex/agents/*.toml`), Cursor Task defaults, and Moonbridge assist bridges are unchanged.

## Upgrade ladder

| Tier | Model | Surface | Role |
| --- | --- | --- | --- |
| 0 | none (local) | `local_repo_agent_consult` | Zero-cost charter/memory consult |
| 1 | `deepseek-v4-flash` | `spawn_subagent` **explore** (read-only) | Scout / coordinator consult |
| 2 | `deepseek-v4-pro` | `spawn_subagent` **plan** (read-only) | Bounded analysis / sequencing |
| 3 | `deepseek-v4-pro` | `spawn_subagent` **general-purpose** (read-write) | Disjoint bounded execution |
| 4 | `grok-composer-*` | Composer main thread | Integration, lease, state files |
| 5 | `grok-build` | Composer / frontier | Protected-claim or ambiguous synthesis |

## Critical surface rule

**Do not use Cursor `Task` for tier 0–2 read-only scouts.**

Cursor `Task` only exposes `composer-2.5-fast` subagents. For cheap DeepSeek scouts, use native Grok `spawn_subagent` with `subagent_type=explore` and `capability_mode=read-only`. That honors `.grok/config.toml` `[subagents.models]`.

**Orchestration coordinator rule (chief-coordinator role embodiment):** The orchestration coordinator (Composer main thread embodying chief-coordinator role) must itself be delegated via explore + deepseek-v4-flash when doing coordination/scout work. It must never directly spawn child agents as grok-build for routine slices. All spawns go through `pnpm grok:agent:spawn-spec --role <repo-role>` (enforces tier model per role-harness-policy + bakes Persona from charter + ESCALATION GUARD + visibility/noticeability mandate from agentic-lexicon.md + chunk-visibility-noticeability.md). Composer main thread only integrates + acquires/releases lease + updates PROJECT_STATUS.md.

**Self-escalation guard:** Every subagent prompt includes an ESCALATION GUARD (baked in grok-repo-agent-spawn.ts). If a subagent (at any tier) explicitly outputs a line beginning with "UNABLE:", the orchestration coordinator MUST treat it as a valid request and spawn a higher-tier helper for the sub-task via the correct `pnpm grok:agent:spawn-spec` (ladder: deepseek-v4-flash → deepseek-v4-pro → grok-build). Record the reason and escalation in PROJECT_STATUS.md. This is the supported mechanism for a low-tier agent to request a more capable helper when it hits its limit. See agentic-lexicon.md.

Composer owns orchestration: rehydrate snapshots, acquire lease, integrate subagent output, run post-slice guards, update canonical state files.

## Per-slice token introspection (ccusage + Grok sessions)

Every Grok slice should capture token posture at start and evaluate drift at end:

1. **Slice start:** `pnpm grok:tier:slice-start -- --slice-id <id> --current-tier tier1_deepseek_flash_scout`
   - Snapshots ccusage daily totals (cross-harness Codex cost) and Grok `~/.grok/sessions/.../updates.jsonl` peaks.
2. **Slice end:** `pnpm grok:tier:slice-introspect --from-baseline` (alias: `pnpm grok:tier:post-slice`)
   - Compares deltas, detects violations (scout-tier Composer spikes, missing DeepSeek sessions, ccusage spikes).
   - Writes `.openclinxr/openclaw/grok-tier-slice-token-latest.json` and appends history JSONL.
3. **Record in state files:** copy the `stateRecordLine` from the report into the per-slice ledger (`Token introspection: ...`).

Violation examples:

- `scout_tier_composer_spike` — scout-tier slice grew Composer peak >35k tokens
- `composer_scout_ratio_exceeded` — Composer peak ≥4× flash scout peak
- `scout_tier_no_deepseek_session` — scout work ran only on Composer
- `ccusage_daily_spike_*` — ccusage daily tokens jumped during slice (cross-harness drift signal)

Install ccusage once: `npm install -g ccusage` (CLI falls back to `pnpm dlx ccusage`).

## Repo-defined agent spawning (required)

Never spawn generic agents. Always map to a role in `agents/**` with charter + memory + `role-harness-policy` model tier.

```bash
pnpm grok:agent:list                              # all roles + model/subagent mapping
pnpm grok:agent:spawn-spec -- --role chief-coordinator --task "..."
pnpm grok:agent:consult -- --consult drift       # recommended roles for consult kind
pnpm grok:agent:validate                          # policy ↔ agents/** alignment
pnpm agent:harness:sync                           # regenerate .grok/agents pointers after policy edits
```

| Policy tier | Grok subagent | Model | Example roles |
| --- | --- | --- | --- |
| fast_bounded | explore (read-only) | deepseek-v4-flash | chief-coordinator, openclaw-drift-police |
| expert_review / read-only plan | plan (read-only) | deepseek-v4-pro | pediatrics-physician, clinical-safety-critic |
| standard_execution write | general-purpose | deepseek-v4-pro | asset-pipeline-lead, xr-systems-architect |
| frontier_thinking | Composer only | grok-build | vp-engineering-delivery |

Work orders from `pnpm grok:tier:work-order` embed `repoAgentSpawns` with full `spawn_subagent` payloads.

## Operating flow

1. **Before delegating:** run `pnpm grok:tier:introspect` (or `pnpm grok:tier:brief` for a one-liner).
2. **At slice start:** run `pnpm grok:tier:slice-start` with slice id + declared tier.
3. **Scout:** `pnpm grok:tier:work-order -- --slice-id <id> --slice-summary "<text>" --scout-question "<question>"` then spawn `explore` with the generated `scoutPrompt`.
3. **Evaluate upgrade:** if flash output lacks repo file paths or Q1/Q4/Q5 gate language, upgrade to tier 2 `plan` before any write scope.
4. **Execute:** only after bounded plan; use tier 3 `general-purpose` for disjoint implementation slices.
5. **Integrate:** Composer merges results, runs focused verify, records `tier: flash|pro|compose|frontier` in `PROJECT_STATUS.md`.
6. **At slice end:** run `pnpm grok:tier:post-slice` and paste `stateRecordLine` into the slice record.
7. **After compaction or multi-subagent waves:** re-run introspection and re-read snapshot blocks only.

## Upgrade triggers (automatic evaluation)

The module `packages/openclinxr/agent-loop/src/grok-tier-routing.ts` encodes triggers including:

- Flash scout returns generic advice without repo paths → tier 2 pro plan
- Scout omits blueprint-factory Q1/Q4/Q5 language → tier 2
- Pro plan cannot bound write scope → tier 4 Composer
- Bounded execution fails focused verification twice → tier 4
- Slice touches promotion/readiness/clinical/scoring claims → tier 5 frontier
- Two consecutive evidence-only slices → tier 4 coordinator consult + product pivot
- Composer would use Cursor Task for read-only work → downgrade to tier 1 explore

Evaluate with:

```bash
pnpm grok:tier:upgrade -- --current-tier tier1_deepseek_flash_scout --scout-output "<subagent text>"
```

Exit code `2` means upgrade recommended.

## Safeguards

- Grok harness only; Codex keeps `.codex/agents` tier models unchanged.
- Never set `[subagents] default_model` in `.grok/config.toml`.
- Do not skip to frontier for routine implementation.
- Protected promotion gates stay false unless Patrick explicitly approves scope expansion.
- Record tier per slice in state files for cost/introspection audit.
- Run `pnpm agent:harness:prove` after policy changes.

## CLI commands

```bash
pnpm grok:tier:introspect          # full posture report + JSON artifact
pnpm grok:tier:brief               # hook-friendly one-screen brief
pnpm grok:tier:check               # validate .grok/config.toml tier models
pnpm grok:tier:work-order -- ...   # generate scout/plan/execute prompts
pnpm grok:tier:advise -- --intent scout|plan|execute|integrate|frontier
pnpm grok:tier:upgrade -- ...      # evaluate upgrade triggers
pnpm grok:tier:slice-start -- --slice-id <id> --current-tier tier1_deepseek_flash_scout
pnpm grok:tier:slice-introspect --from-baseline
pnpm grok:tier:post-slice            # alias for slice-end token introspection
```

Artifacts: `.openclinxr/openclaw/grok-tier-introspection-latest.json`, `grok-tier-work-order-latest.json`, `grok-tier-slice-baseline-latest.json`, `grok-tier-slice-token-latest.json`, `grok-tier-slice-token-history.jsonl`.

## Introspection prompts (ask before delegating)

1. Is this read-only? If yes, use `spawn_subagent explore` (flash), not Cursor Task.
2. Did flash output cite repo file paths? If no, upgrade to tier 2 pro plan.
3. Does the slice touch promotion/readiness claims? If yes, Composer or grok-build only.
4. After two evidence-only slices, coordinator consult then force a product slice.
5. Run `pnpm grok:tier:introspect` after compaction or policy edits.

See also `agents/rules/grok-harness-usage.md` and `agents/rules/agent-consult.md`.