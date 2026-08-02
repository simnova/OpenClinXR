# Iteration 0009 Brief

Date: 2026-05-04
Loop focus: turn newly captured local model, local voice, asset-job, IWSDK, and Quest evidence into an amber implementation posture without overclaiming readiness

## Objective

Iteration 0009 absorbs the verified implementation slices and the May 4 evidence runs into the agent-factory operating loop. The goal is to move from broad feasibility planning into a sharper code implementation plan: deterministic local development remains the default, optional local AI and voice stay behind explicit facades, asset generation becomes an internal job lane, Quest/IWSDK readiness remains gated by headset evidence, and stale debt IDs are treated as a governance bug.

## Inputs

- `pnpm verify` passed after the asset-job and architecture-boundary commits.
- Internal asset-generation jobs now route through the API for `character-generation`, `medical-equipment-generation`, `voice-asset-generation`, `animation-generation`, and `asset-bake`.
- ArchUnitTS rules now keep internal capability endpoints and capability-gateway imports out of UI app source while allowing the API tunnel.
- Quest CDP smoke is foreground-visible and frame-sampling works, but immersive session entry and the manual worn-headset report remain blocked.
- Local Qwen/llama.cpp runtime smoke passed with structured-output caveats on the available Apple Silicon machine.
- Local VibeVoice file-generation smoke passed with latency, memory, and non-streaming caveats.
- GLB conversion and Blender placeholder bake passed, while production avatar, rigging, animation, LOD, texture, and headset-budget evidence remain unproven.
- IWSDK Phase 1 sidecar is installed and runnable, but production adoption, Phase 2 devtools, reference warmup, and Quest/MCP evidence remain blocked.

## Required Decisions

- Which prior evidence debt can be treated as resolved, and what replacement quality gates must remain open?
- How should the development team sequence live dialogue, voice, asset, and XR work without coupling optional local runtimes to production provider swaps?
- Which architecture decisions need continued enforcement through ArchUnitTS and package boundaries?
- How should the benchmark gate avoid reusing an evidence ID after the underlying debt changes meaning?
- Which claims remain prohibited in leadership, demo, or external materials?

## Output Standard

The output must be implementation-facing. Each recommendation should map to a package, app, endpoint, test, benchmark, or evidence file that the development team can act on next.
