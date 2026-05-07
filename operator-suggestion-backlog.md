# Operator Suggestion Backlog

Date: 2026-05-06
Status: nonblocking idea ledger

This file captures useful operator suggestions that should not interrupt the current implementation flow. Items here are not approvals, blockers, or active scope by themselves. Promote an item through an approved proposal, a verified implementation slice, or an explicit operator request before treating it as committed work.

## How To Use This File

- Keep suggestions short, dated, and tied to evidence when possible.
- Record confidence as `low`, `medium`, or `high` based on current repo evidence.
- Move items to the worker backlog, an approved proposal, or evidence docs when they become actionable.
- Do not use this file to authorize cloud, paid API, production runtime, security/trust changes, or destructive operations.

## Active Suggestions

### PNPM Audit Cadence

- Date added: 2026-05-05
- Suggestion: Leverage `pnpm audit` to keep abreast of package security issues.
- Current status: promoted to recurring security evidence cadence docs; executable now via `pnpm security:audit:snapshot`.
- Confidence: high.
- Notes: The repo already has `pnpm security:audit`, `pnpm security:audit-policy`, committed audit evidence, and high-severity audit gating. Useful next step is a periodic point-in-time audit evidence cadence or GitHub issue/project checklist, not a new runtime dependency.
- Promote status: implemented via `docs/openclinxr/security-audit-cadence.md` and `docs/openclinxr/worker-backlog-and-validation-matrix.md`.

### Local Node Runtime Repair

- Date added: 2026-05-07
- Suggestion: Repair the local Node executable dependency chain so repository verification commands can run consistently.
- Current status: resolved in repo guidance by enforcing `nvm` + repo-local runtime pin (`.nvmrc` set to `22.19.0`).
- Confidence: medium.
- Notes: `node` is resolving to `/opt/homebrew/bin/node`, but this build expects `/opt/homebrew/Cellar/node/21.7.1/bin/node` linked against `/opt/homebrew/opt/icu4c/lib/libicui18n.74.dylib`, which is missing on this environment. Until this is fixed, `pnpm` and targeted Vitest checks cannot complete locally.
- Local evidence check (2026-05-07): `node` failed at startup with `Library not loaded: /opt/homebrew/opt/icu4c/lib/libicui18n.74.dylib` when resolving `/opt/homebrew/bin/node`. `node` and `pnpm` now validate correctly when launched through `nvm`/`v22.19.0`.
- Current operator guidance: use `nvm use` in shells before `pnpm` work (README updated). The repo now includes `.nvmrc` (`22.19.0`) to keep local sessions consistent.
- Alternative if you do want Homebrew cleanup later: either reinstall `icu4c` to a 74-compatible artifact compatible with Node 21.7.1, or switch this workstation to a single consistent Node runtime with matching ICU.

### UIKitML For Spatial Text

- Date added: 2026-05-05
- Suggestion: Prefer UIKitML for text content exploration over the earlier HTML-in-canvas idea.
- Current status: sidecar spike implemented.
- Confidence: high for sidecar readability comparison; low for production adoption.
- Notes: `apps/ui-xr-iwsdk-spike` now has UIKitML sidecar evidence, Vite 8 peer mismatch documentation, reviewed license posture, and desktop/IWER screenshot evidence. This does not authorize production `apps/ui-xr` adoption or Quest text-readiness claims.
- Promote when: a later proposal has physical Quest readability/frame-pacing evidence and a production spatial UI migration plan.

### VibeVoice As A Grok Voice Proof-Of-Concept Substitute

- Date added: 2026-05-05
- Suggestion: Track whether VibeVoice is usable as a free local proof-of-concept alternative to burning Grok Voice API credits.
- Current status: evidence says useful for offline file-generation POC, not live low-latency dialog.
- Confidence: medium-high.
- Notes: Latest local VibeVoice evidence records successful local file generation, no cloud/paid calls, and no committed audio, but real-time factor remains above 1x on the M1 Max evidence run. Live dialog remains blocked on streaming runtime evidence, Quest/WebXR playback, safety/disclosure/retention controls, and latency.
- Promote when: a real streaming local voice runtime benchmark shows first-audio and transcript round-trip evidence, or when Grok Voice comparison criteria are explicitly approved.

### Moshi MLX / Qwen3-TTS Local Realtime Voice

- Date added: 2026-05-05
- Suggestion: Try a minimal local low-latency realtime voice AI spike with Moshi MLX primary and Qwen3-TTS fallback.
- Current status: approved; model caches present, runtime inference still blocked.
- Confidence: medium.
- Notes: `docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json` records both approved model caches after Patrick allowed Hugging Face downloads when licensing posture works. Qwen3-TTS has file-generation smoke evidence only. Moshi q4 is cached but not executed; `moshi_mlx==0.3.0` dry-run metadata wants `mlx==0.26.5`, which conflicts with the existing Qwen support venv's newer `mlx==0.31.2`.
- Promote when: a separate Moshi runtime venv and minimal local file or loopback audio smoke can run without mutating the Qwen evidence venv, and without claiming Quest or production readiness.

### Blender MCP

- Date added: 2026-05-05
- Suggestion: Blender MCP may assist solution design, asset inspection, screenshots/videos, and scene QA.
- Current status: proposed future tool, not installed.
- Confidence: medium.
- Notes: Blender CLI placeholder bake evidence is passing. Blender MCP could help agents inspect Blender scenes and capture visual QA, but it gives an AI-controlled path into Blender/Python/desktop automation and should require a separate security/install proposal before use.
- Promote when: a separate security/install proposal is approved and the production asset evidence ladder needs agent-readable Blender scene inspection beyond CLI smoke exports.

### SkinTokens / TokenRig

- Date added: 2026-05-04
- Suggestion: Consider SkinTokens for avatar skinning or rigging.
- Current status: research candidate only.
- Confidence: medium.
- Notes: Current docs treat SkinTokens/TokenRig as an offline rigging research candidate, not an Apple Silicon, Quest, or production runtime dependency. It likely needs a GPU-backed research environment, checkpoint provenance review, and clear generated-asset validation gates.
- Promote when: production avatar/rigging evidence work is approved and a local/GPU worker environment is available.

### IWER Adversarial Visual QA

- Date added: 2026-05-04
- Suggestion: Use browser screenshots/videos and multimodal adversarial review to judge whether XR scenes accurately depict actors, equipment, readability, occlusion, and clinical intent.
- Current status: implemented as a standing evidence posture for IWER/managed-browser artifacts.
- Confidence: high for emulated visual iteration; low for physical Quest readiness.
- Notes: IWER screenshots and visual QA reports are already labeled as emulation evidence. They help iterate scene fidelity but do not replace worn-headset frame pacing, comfort, latency, or hand/controller evidence.
- Promote when: a new visual slice changes actors, equipment, spatial text, hand models, or scenario layout.

### Parallel Agents, Worktrees, And Portless

- Date added: 2026-05-04
- Suggestion: Use background agents, git worktrees, and Portless when slices can run independently without stepping on each other.
- Current status: active workflow guidance.
- Confidence: high.
- Notes: Use subagents for independent research/review/implementation slices with disjoint ownership. Portless is optional local developer routing; do not use it as Quest evidence until a headset path is validated.
- Promote when: a large feature can split into independent write scopes or parallel evidence collection.

### Web3 / QUIC / HTTP3 Quick Protocol Support

- Date added: 2026-05-04
- Suggestion: Explore quick protocol support, including HTTP/3 where Bun/Hono support is emerging.
- Current status: WebSocket primary is implemented; HTTP/3 Quest compatibility is future approved; QUIC/Web3 remain gated.
- Confidence: high for WebSocket-first posture; low until Quest HTTP/3 evidence exists.
- Notes: Do not add WebTransport, direct QUIC, Web3, wallet, DID, blockchain, cloud relay, or paid transport dependencies without explicit follow-up approval. Future HTTP/3 work must use real Quest Browser evidence and separate protocol reachability from clinical media readiness.
- Promote when: a local no-cloud Quest Browser HTTP/3 compatibility run is ready.

### Godot Quest Voice Client

- Date added: 2026-05-05
- Suggestion: Clarify whether Godot is long-term or single-purpose.
- Current status: documented as temporary, deletable sidecar.
- Confidence: high.
- Notes: Godot is not the primary long-term OpenClinXR client. It exists to test a Quest-native voice transport hypothesis while WebXR/IWSDK remains the main scenario UI path.
- Promote when: a physical Quest Godot voice run becomes valuable for binary WebSocket, microphone, Opus, playback, or latency evidence.

### MongoDB Agent Skills

- Date added: 2026-05-05
- Suggestion: Use MongoDB agent skills for MongoDB work.
- Current status: standing rule.
- Confidence: high.
- Notes: MongoDB schema, repository, query, index, and search/AI slices should consult the installed MongoDB skills before implementation. This does not authorize Atlas/cloud usage by itself.
- Promote when: a MongoDB schema, repository, indexing, or query optimization slice starts.
