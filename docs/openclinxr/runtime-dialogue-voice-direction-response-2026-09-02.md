# Response to direction — Runtime Dialogue, Affect, Lip-Sync, and Voice

Date: 2026-09-02
Status: accepted-amendment rationale. **Sequence owner is** `docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md` (merged 2026-09-02). This file does not win on lifecycle, type, default, payload, clock, or `done_when`.
Responds to: `runtime-dialogue-voice-affect-direction-2026-09-02.md`
Supersedes as rationale: the earlier split memos (`runtime-dialogue-voice-review-response-2026-09-02.md` and the architecture follow-up of the same date).
Authority: subordinate to AGENTS.md, D9/D14, the merged direction, `docs/openclinxr/communication-style-and-emotion-qa.md`, `docs/openclinxr/model-provider-and-voice-routing.md`, `docs/openclinxr/local-ai-voice-model-strategy.md`
Claim boundary: simulated-actor training behavior only. Not clinical validity, scoring, licensure, Quest readiness, or HIPAA product certification.
Sibling: `docs/openclinxr/emotional-prosody-policy-review-2026-09-02.md` remains the signed-artifact candidate. This file is not that artifact.

## How to use this file

Implementers read the **merged direction**. This file records why the amendments were accepted and the three operator-review corrections applied on merge. Do not stack a fourth parallel source of truth.

## Operator-review corrections (applied on merge)

1. DeepSeek peak hours stay Monday–Friday UTC 01:00–04:00 and 06:00–10:00 ([official pricing](https://api-docs.deepseek.com/quick_start/pricing), fetched 2026-09-02). UTC+8 09–12 / 14–18 is the conversion. Not every day.
2. `$4.20/1M` TTS and “five named voices as the whole roster” were not claims in the landed direction. That file already pinned `$15/1M` and `eve`/`ara`/`leo`/`rex`/`sal` plus named voices. Keep `$15`. Voice identity is still a reviewed allowlist over the built-in roster.
3. Slice 1 `done_when` freezes types and the plan/execution split only. Classifier default, DeepSeek-cannot-choose-event/gesture/prosody, provider-grammar strip, and barge-in render live in slices 2–6.

## Bottom line (accepted, now in the direction)

- one committed turn identity after mapping
- DeepSeek for `{spokenText}` only (`thinking: { type: "disabled" }` in the payload)
- Grok streaming TTS + streaming STT as voice I/O, not as the SP brain
- Grok S2S / `grok-voice-think-fast-2.0` forbidden as actor identity
- tags are a render of policy, never LLM-emitted executable markup
- fail-closed `emotional_prosody` until a signed review artifact exists
- Rhubarb is a factory / replay baker, not a live Quest subprocess
- `EmotionEventClassifier` owns learner events; unknown is `learner_unclassified`, not `learner_clinical_question`
- mapper key includes style, intensity bucket, role, and age-band
- dual affect: `DialogueEmotion` vs `SomaticEmotion`; `pain` cannot be a dialogue value
- mapper owns face, pose, gesture, and prosody
- `ActorTurnPlan` is the output of turn composition; `ActorTurnExecution` is append-only
- live lip-sync does not call Rhubarb and does not wait on `with_timestamps`
- authored fallback lines before mock; latency budgets are contract targets

## Disposition of the original (pre-merge) direction

| Direction claim | Disposition |
| --- | --- |
| `ActorTurnPlan` as affect/clock SSOT | **Accept, tighten** — plan is committed intent after mapping; execution is a second record |
| S2S is not the SP brain | **Accept, freeze** |
| Tags are render, not LLM output | **Accept** — sanitize provider grammar specifically |
| Closed emotion set + pain-is-touch | **Accept, tighten** — split the types |
| Event kind implied, not owned | **Change** — classifier owns it; default is unclassified / no-op |
| Mapper keyed on emotion only | **Change** — full key |
| Model may emit `gesture_cues` (communication QA) | **Change** — mapper owns clips at runtime; authoring docs stay palette authority |
| Live path uses timestamps / Rhubarb-adjacent timing | **Change** — live interpolator / amplitude; Rhubarb offline only |
| DeepSeek → mock fallback | **Change** — authored scenario line before mock |
| “Thinking off” as prose | **Change** — explicit payload field |
| No latency envelope | **Change** — budgets in the merged direction (targets until slice 6 measures) |
| Peak hours “weekdays” | **Keep** — official DeepSeek is Mon–Fri; do not expand to every day |
| TTS $15/1M | **Keep** — `$4.20/1M` was not in the landed direction |
| Built-in roster + named voices | **Tighten** — reviewed allowlist file; not a five-voice ceiling |
| Blocker-id drift across gateways | **Change** — unify strings in slice 5 |
| Quest immersive mic assumed closable by cloud STT | **Reject as evidence** — G0 stays open |

## Architecture (canonical text lives in the direction)

See the merged direction for: sequence with barge-in back-edge, `ActorTurnPlan` / `ActorTurnExecution` types, dual affect, classifier rules, mapper key, tag allowlist (one wrap; no nested `<slow><soft>`), sanitation, DeepSeek payload, voice I/O table, lip-sync clocks, latency budgets, cloud vs local-first, HIPAA, cost sketch, and the 1→7 slice `done_when` split.

## What we are still most likely to get wrong

Wiring five integrations that still choose affect independently — or shipping a beautiful immutable `ActorTurnPlan` that later mutates when the learner barges in, whose dialogue field can legally be `pain`, and whose event kind defaults to a clinical question the learner did not ask.

## Sources

- Direction under review (2026-09-02), now merged
- Operator amendment memo and architecture follow-up of the same date
- Operator review of this file (2026-09-02): peak hours, disposition-table hygiene, slice-1 `done_when` split
- Repo at checkout (`emotion-engine.ts`, `voice-gateway/src/types.ts`, `model-gateway/src/index.ts`, `capability-gateway/src/internal.ts`, `dialogue_runtime/run.ts`, communication QA, voice routing, local voice strategy, 2026-08-05 local-STT cagematch spec, D9/D14)
- xAI TTS / STT / Voice overview (fetched 2026-09-02)
- DeepSeek V4 thinking-mode guide and pricing (fetched 2026-09-02)
