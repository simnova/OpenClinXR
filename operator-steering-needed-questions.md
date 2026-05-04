# Operator Steering Needed Questions

This file is for true operator blockers only: decisions, confirmations, credentials, hardware actions, paid/cloud/API usage, destructive actions, or local trust/security changes that Codex should not perform unattended.

## Open Blockers

- Local model benchmark approval: `llama.cpp` 9010 is installed and visible as `llama-cli` / `llama-server`, but no model weights have been downloaded or executed. To resolve the local-model evidence debt, Patrick needs to approve one explicit first model ID, its license/model-card posture, and the download size/source before Codex runs a real local model benchmark.
- Local voice runtime approval: VibeVoice remains uninstalled and disabled. The intake note exists at `docs/openclinxr/spikes/vibevoice-local-voice-spike.md`; to resolve the local-voice evidence debt, Patrick needs to approve the safety/license posture, install path, voice/model ID, and first-audio benchmark scope before Codex installs or runs a real voice runtime.

## Recently Resolved

- Blender local asset bake: Blender 5.1.1 was installed through Homebrew cask and `pnpm asset:blender:bake` produced `docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json`, so the placeholder asset-bake blocker is resolved.
- Portless local trust: Patrick ran `portless trust`, so Codex can use Portless for local developer/browser routing experiments when useful. Codex verified an unprivileged local proxy on port `1355`; do not add Portless to mandatory repo scripts, start privileged/default-port proxy setup, or start LAN/Tailscale/public sharing without explicit steering.

## Standing Rules

- Ask before destructive git/file operations, paid/cloud/API usage, production credentials, or changes that alter machine-level trust/security state.
- Prefer local deterministic spikes, repo-managed dependencies, and verified commits before requesting steering.
