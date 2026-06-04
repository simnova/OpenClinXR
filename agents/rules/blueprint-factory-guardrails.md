---
title: Protected Blueprint-Factory Guardrails and Slice Gate
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-04
relates-to: AGENTS.md, docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md, docs/openclinxr/doc-authority-registry-2026-05-27.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md
---

# Protected Blueprint-Factory Guardrails and Slice Gate (Q1-Q5)

`docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` is protected coordination policy. Autonomous agents, live subagents, repo-defined agents, and routine implementation workers must not delete, weaken, bypass, rename, or reinterpret it.

`docs/openclinxr/doc-authority-registry-2026-05-27.md` and `docs/openclinxr/doc-authority-registry-2026-05-27.json` classify Markdown files by authority. Agents must consult the registry before treating Markdown outside the canonical control surfaces as active instructions.

`docs/openclinxr/generated-artifact-registry-2026-05-27.md` and `docs/openclinxr/generated-artifact-registry-2026-05-27.json` classify generated non-Markdown artifacts. Agents must consult the registry before deleting, ignoring, or committing generated JSON, screenshots, local cache outputs, or runtime asset artifacts.

`docs/openclinxr/openclaw-runbook-2026-05-27.md` is the protected OpenClaw runbook for unattended repo-native execution.

`docs/openclinxr/openclaw-tool-adapters-2026-05-27.md` is the protected host-adapter guide for running OpenClaw across Codex, Claude, Grok, Cursor, and other agent tools. It defines host prompts, capability fallbacks, and Drift Police rules for tool-agnostic execution. It defines the Required Per-Slice Record, canonical automation prompt, and `pnpm docs:drift-check` guard. Agents must not delete, weaken, bypass, rename, or reinterpret it.

OpenClinXR is not a collection of handcrafted XR scenes. OpenClinXR is a blueprint-driven encounter factory. The encounter specification/blueprint must drive environment, actors, conversation tooling, emotion state, locomotion, gaze/lip-sync, clothing, equipment, interactions, traces, persistence, review packets, provider gates, shared asset reuse, and runtime/screenshot evidence.

Conversation tooling is first-class. Actor dialogue policies, learner utterance/action intake, turn-taking, interruptions, emotion transitions, trace tags, replayable actor turns, and review-safe conversation evidence must not be displaced by one-off asset or screenshot work.

Before starting a slice, apply the guardrail slice gate in `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md`. If a slice does not advance blueprint-to-runtime generation (Q1), conversation/runtime tooling, reusable generated assets, review/persistence/replay (Q4), or verification of touched factory behavior (Q5), do not do it.

The design should stay grounded in the original research and technology direction captured in repo docs and proposals, including virtual patient/standardized-patient literature, former Step 2 CS-style workflow knowledge, TypeScript/React/Hono/Bun/MongoDB/WebXR stack preferences, open-source-first tooling, and avoidance of AGPL/copyleft or cloud/paid dependencies unless explicitly approved.

See the full protected `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` before any product or harness slice. Consult doc-authority-registry before elevating other MDs.

Extracted/summarized from AGENTS.md for modularity. This + the 6 protected docs are non-negotiable.
