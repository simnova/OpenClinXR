# Proposal: Local Voice Runtime

Status: Proposed; awaiting operator approval.

## Decision Needed

Approve a safe first local voice runtime spike using VibeVoice, including install path, model ID, safety/license posture, uninstall plan, and first-audio benchmark scope.

## Recommendation

Defer installation until the operator explicitly approves this proposal, then evaluate `microsoft/VibeVoice-Realtime-0.5B` only as a disabled developer-only spike.

This keeps voice synthesis out of learner assessment and production paths while still allowing a measured local alternative to hosted speech once safety and license gates are acknowledged.

## Proposed Scope

| Item | Proposed value | Posture |
| --- | --- | --- |
| Runtime family | VibeVoice | Developer-only research spike |
| First model | `microsoft/VibeVoice-Realtime-0.5B` | Proposed first candidate |
| Install path | Operator-approved local path outside committed source or in an ignored local cache | Must be recorded before install |
| Runtime env | `OPENCLINXR_LOCAL_VOICE_RUNTIME`, `OPENCLINXR_LOCAL_VOICE_ID` | Private env only |
| Approval flags | `OPENCLINXR_LOCAL_VOICE_INSTALL_APPROVED=true`, `OPENCLINXR_LOCAL_VOICE_SAFETY_REVIEW_APPROVED=true` | Private env only after approval |
| Cloud calls | None | Disallowed |
| Production use | None | Disallowed |

## Pros

- Gives OpenClinXR a local speech-synthesis path to evaluate without Grok or other paid APIs.
- Lets the team measure first-audio latency, stability, memory, and turn-taking feasibility on Apple Silicon.
- Keeps generated voice behind explicit disclosure, misuse, and safety gates.
- Fits the existing `VoiceProviderAdapter` direction without forcing it into default startup.

## Cons

- Voice generation has elevated misuse and identity-safety risk compared with text-only model benchmarking.
- Install may require Python/runtime setup outside the TypeScript-first comfort zone.
- Model weights, demo assets, speaker presets, and downstream generated audio still require license and provenance review.
- Local results may not match production deployment constraints or Quest headset latency once integrated.

## Approval Wording

Approve this proposal if Codex may install a local VibeVoice spike for `microsoft/VibeVoice-Realtime-0.5B`, record install and uninstall commands, set the local voice approval flags only in a private env context, run a first-audio benchmark, and commit evidence reports without committing model weights or generated voice assets.

## Acceptance Criteria

- Safety/license checklist is recorded before install.
- Install path, expected disk footprint, source URL/model ID, and uninstall command are recorded.
- `vibevoice` or an approved wrapper is visible to the local runtime probe.
- `pnpm local:provider:benchmark -- --env-file .env.openclinxr.local --output docs/openclinxr/local-provider-benchmark-YYYY-MM-DD.json` records local voice readiness without cloud calls.
- First-audio benchmark records text prompt, generated duration, first audible latency, total synthesis time, memory/thermal notes, transcript/evidence sample, and explicit `dev_only` status.
- Default `pnpm verify` does not require VibeVoice.

## Sources

- `docs/openclinxr/spikes/vibevoice-local-voice-spike.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- `.env.openclinxr.local.example`
- `tools/openclinxr/local-provider-benchmark.ts`
