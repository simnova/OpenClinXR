# Operator Steering Needed Questions

This file is for true operator blockers only: decisions, confirmations, credentials, hardware actions, paid/cloud/API usage, destructive actions, or local trust/security changes that Codex should not perform unattended.

## Open Blockers

- Local model benchmark approval: `llama.cpp` 9010 is installed and visible as `llama-cli` / `llama-server`, but no model weights have been downloaded or executed. To resolve the local-model evidence debt, Patrick needs to approve one source-backed first model ID such as `Qwen/Qwen3-4B-GGUF` or `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B`, its license/model-card posture, and the download size/source before setting `OPENCLINXR_LOCAL_MODEL_DOWNLOAD_APPROVED=true` and running a real local model benchmark.
- Local voice runtime approval: VibeVoice remains uninstalled and disabled. The intake note exists at `docs/openclinxr/spikes/vibevoice-local-voice-spike.md`; to resolve the local-voice evidence debt, Patrick needs to approve the safety/license posture, install path, `microsoft/VibeVoice-Realtime-0.5B`, and first-audio benchmark scope before setting `OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED=true` and allowing Codex to install or run a real voice runtime.
- Quest foreground performance capture: USB and ADB authorization are working, but `docs/openclinxr/local-runtime-probe-2026-05-04.json` records `mWakefulness=Asleep`, so the benchmark gate now reports `quest_foreground_preflight:quest_3_asleep_or_not_foreground_ready`. Patrick needs to wake/wear the headset and keep the Quest Browser station page foregrounded before Codex can capture or validate a real foreground performance report.
- IWSDK install-backed sidecar approval: `packages/openclinxr/iwsdk-spike` now has a pre-install package policy, but Codex should not create or install a runnable `apps/ui-xr-iwsdk-spike` sidecar until Patrick approves the exact package list/versions, Three.js override posture, license posture for review-only and blocked transitive packages, and whether review-required IWSDK packages may be included.

## Recently Resolved

- Blender local asset bake: Blender 5.1.1 was installed through Homebrew cask and `pnpm asset:blender:bake` produced `docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json`, so the placeholder asset-bake blocker is resolved.
- Portless local trust: Patrick ran `portless trust`, so Codex can use Portless for local developer/browser routing experiments when useful. Codex verified an unprivileged local proxy on port `1355`; do not add Portless to mandatory repo scripts, start privileged/default-port proxy setup, or start LAN/Tailscale/public sharing without explicit steering.

## Standing Rules

- Ask before destructive git/file operations, paid/cloud/API usage, production credentials, or changes that alter machine-level trust/security state.
- Prefer local deterministic spikes, repo-managed dependencies, and verified commits before requesting steering.
