# OpenClinXR

OpenClinXR is an evidence-gated XR clinical simulation workspace for virtual-patient encounters, Quest/WebXR runtime evidence, local-first voice, and production asset readiness.

Project page: <https://developers.simnova.com/OpenClinXR/>

## Current Posture

This repository is early-stage infrastructure, not a clinical product. Runtime, voice, XR, and asset-generation claims are deliberately scoped by committed evidence artifacts and validator scripts.

Useful entry points:

- [OpenClinXR docs](docs/openclinxr/)
- [Agent operating contract](AGENTS.md)
- [Project coordination index](PROJECT_COORDINATION_INDEX.md)
- [Autonomous work plan](AUTONOMOUS_WORK_PLAN.md)
- [OpenClaw runbook](docs/openclinxr/openclaw-runbook-2026-05-27.md)
- [OpenClaw tool adapters](docs/openclinxr/openclaw-tool-adapters-2026-05-27.md)
- [Blueprint-factory drift guardrails](docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md)
- [Implementation plan](docs/openclinxr/code-implementation-plan.md)
- [PNPM audit cadence runbook](docs/openclinxr/security-audit-cadence.md)
- [Quest 3 USB WebXR smoke checklist](docs/openclinxr/quest3-usb-webxr-smoke-checklist.md)
- [Local AI voice model strategy](docs/openclinxr/local-ai-voice-model-strategy.md)
- [Automated asset generation pipeline](docs/openclinxr/asset-generation-pipeline.md)

## OpenClaw Agent Kickoff

OpenClaw mode is repo-native, not tied to one agent host. Codex, Claude, Grok Code, Cursor, or another tool can participate if it follows the same canonical files and keeps work blueprint/factory-driven.

Naming clarification: this repo is not running an external OpenClaw runtime, daemon, SaaS product, or privileged orchestration service. It uses an OpenClaw-style execution pattern made of repo-native guardrails, role charters, deterministic checks, host adapter prompts, and drift-police enforcement.

Before a long run:

```bash
pnpm openclaw:preflight
```

After a slice, before queue transition or completion claims:

```bash
pnpm openclaw:post-slice
```

To print the canonical automation prompt from the protected runbook:

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

The `pre-commit` hook runs fast OpenClaw hygiene: `docs:drift-check`, `agent:alignment`, and `openclaw:post-slice`.

The `pre-push` hook repeats the fast OpenClaw hygiene so pushes do not publish drift.

Run the strict local gate before release branches or broad merges:

```bash
pnpm hooks:strict
```

The strict gate runs TypeScript checks, `pnpm audit`, security policy/license checks, `knip`, and `e18e`. It is not installed as a blocking Git hook until the existing TypeScript baseline is repaired.

Use `OPENCLAW_SKIP_HOOKS=1` only for intentional emergency bypasses.

If the readiness gate is unavailable, or when debugging suspected drift, run the component checks:

```bash
pnpm docs:authority
pnpm docs:artifacts
pnpm docs:drift-check
pnpm agent:alignment
```

Use this universal kickoff prompt when switching tools:

```text
Continue in repo-native OpenClaw mode in /Volumes/files/src/openclinxr.

Use AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, and docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md as the source of truth.

Do not use generic chat autonomy. Do not hand-design individual encounters. All scene, humanoid, clothing, animation, conversation, emotion, locomotion, gaze/lip-sync, equipment, trace, persistence, provider, and review work must flow from encounter specifications/blueprints through reusable factory/provider/cache pipelines.

Before selecting work, apply the OpenClaw drift guard: no scattered markdown, no one-off status/checkpoint/prompt artifacts, no unregistered generated artifacts, no evidence refresh unless it unlocks a concrete implementation decision. If drift is suspected, consult agents/adversarial/openclaw-drift-police/ and run or request pnpm docs:drift-check.

Use live subagents only if this host supports them and they materially reduce drift/risk/review cost. Otherwise use local role consultation from agents/** charters/memory. Record only canonical outcomes.

After each slice, run focused verification when available, update canonical state with product path advanced, blueprint/factory tie, touched files, evidence, and next queued slice, then continue. Stop only if explicitly told to pause/stop or all approved lanes are truly blocked and recorded.
```

Host-specific shortcuts:

- `Codex`: use for local implementation, terminal verification, Browser screenshots, and optional live-subagent orchestration.
- `Claude`: use for high-level reasoning, adversarial review, specs, or implementation when shell/files are available; do not claim verification without evidence.
- `Grok Code`: use as a bounded specialist for critique, external tooling/options, and adversarial review; keep provider/license gates explicit.
- `Cursor`: use for focused local code edits with visible diffs; avoid broad refactors unless a canonical cleanup plan requires them.

If any host creates clutter, one-off encounter work, or unregistered artifacts, invoke the Drift Police role in [agents/adversarial/openclaw-drift-police](agents/adversarial/openclaw-drift-police/) and correct back to the active product queue.

Copy-paste kickoff prompts:

`Codex`

```text
Continue in repo-native OpenClaw mode in /Volumes/files/src/openclinxr using Codex local tools.

Read AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, and docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md as needed.

Use terminal, file edits, focused verification, and Browser screenshots when they directly advance or prove the case-definition-driven WebXR encounter factory. Run pnpm docs:drift-check and pnpm agent:alignment before long unattended work or after suspected drift. Select the next approved product slice from AUTONOMOUS_WORK_PLAN.md and continue without treating slice completion as a stop condition.
```

`Claude`

```text
Operate as a repo-native OpenClaw agent for /Volumes/files/src/openclinxr, not as generic Claude chat.

Use AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, and docs/openclinxr/openclaw-tool-adapters-2026-05-27.md as the source of truth. Keep work blueprint/factory-driven and avoid hand-designing individual encounters.

If you have shell and file access, implement the next smallest approved product slice and run focused verification. If you do not have execution access, act as a bounded planner/reviewer: identify the exact slice, risks, files, verification commands, and Drift Police concerns without creating new status artifacts.
```

`Grok Code`

```text
Act as a bounded OpenClaw specialist for /Volumes/files/src/openclinxr.

Use the repository guardrails in AGENTS.md, PROJECT_COORDINATION_INDEX.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, and docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md.

Focus on adversarial critique, external tooling/options, provider/license constraints, realism scoring, and narrowly scoped implementation only when it advances the encounter-factory pipeline. Do not use paid/cloud providers, claim readiness, or introduce one-off encounter assets unless explicitly approved and routed through provider/cache/provenance gates.
```

`Cursor`

```text
Run Cursor in repo-native OpenClaw mode for /Volumes/files/src/openclinxr.

Use AGENTS.md, PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, and docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md before editing.

Make focused diffs against the next approved product slice, preserve the case-definition-driven factory architecture, avoid broad cleanup unless backed by a canonical plan, and run the smallest relevant verification command before claiming completion. If drift appears, invoke the OpenClaw Drift Police role and correct back to the canonical queue.
```

## Verification

Use Node `22.19.0` and pnpm `10.33.0`.

If your terminal still points to an old/global Node binary, use `nvm` before running `pnpm`:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use
```

With `.nvmrc` in this repo, `nvm use` will pick `22.19.0`.

```bash
pnpm agent:verify
pnpm typecheck
pnpm test
pnpm security:audit-policy
pnpm security:licenses
```

To reproduce the ICU mismatch error before you switch Node runtimes:

```bash
/opt/homebrew/bin/node -v
```

On this machine this fails with:

`dyld[xxxx]: Library not loaded: /opt/homebrew/opt/icu4c/lib/libicui18n.74.dylib`

If you still see that error, run:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use
```

For GitHub Pages maintenance:

```bash
pnpm pages:sync-evidence-links
pnpm pages:sync-validate
pnpm pages:validate
```

`pages:sync-evidence-links` updates the four snapshot links under `docs/index.html`
to the latest matching files in `docs/openclinxr` using the `data-pages-snapshot` keys.

`pages:sync-validate` checks whether `docs/index.html` is already up to date and then
runs `pages:validate`.

The public GitHub Pages site is static content in [docs](docs/) and is configured to publish from `main` with `/docs` as the Pages source.
