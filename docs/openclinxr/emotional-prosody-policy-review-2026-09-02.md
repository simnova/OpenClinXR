# Emotional Prosody Policy Review (draft)

Date: 2026-09-02
Status: draft review artifact — **not** a signed promotion. Voice-gateway `emotional_prosody` stays fail-closed until a later slice binds this document (hash, expiry, voice ids) into the gate.
Parent direction: `docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md` (sequence owner after 2026-09-02 merge)
Rationale: `docs/openclinxr/runtime-dialogue-voice-direction-response-2026-09-02.md`
Claim boundary: synthetic-actor training behavior. Not clinical affect recognition, scoring, licensure, Quest readiness, or empathy measurement.

This is the document the `emotional_prosody` gate has been naming (`emotional_prosody_policy_review_missing`). Writing it does not flip the gate.

## Scope

- Simulated standardized patients, parents, and staff in OpenClinXR stations.
- Audible delivery of already-accepted actor text.
- Face, pose, and gesture must share the same `ActorTurnPlan` (`dialogueEmotion` + `somaticEmotion` composed by the mapper). This review does not authorize independent voice affect. Barge-in is recorded on `ActorTurnExecution`, not by mutating the plan.

Out of scope: real-patient voice cloning; learner scoring from tone; diagnosis-signaling affect; Grok speech-to-speech as the actor brain.

## Authority

| Surface | Authority |
|---|---|
| Dialogue affect | `DialogueEmotion` + `EmotionEngine` (`pain` unrepresentable) |
| Somatic affect | `SomaticEmotion` (`pain`) from touch runtime, or null |
| Spoken words | DeepSeek (or mock) after hidden-fact guardrail, tag-free |
| Tags / speed / presets | Deterministic `EmotionPerformanceMapper` |
| TTS | Grok `POST /v1/tts` or `wss://api.x.ai/v1/tts` |
| TTS must not | Change actor state, invent facts, or speak stripped tags |

Conflict rule: **state wins**. Unsupported or contradictory tags are removed and recorded on the turn envelope. Language and trace continue with **neutral** prosody if this review is absent or expired.

## Allowed controls

Enumerated presets and provider tags only. v1 allowlist:

| Emotion | Wrap | Inline (≤1) | `speed` |
|---|---|---|---|
| `neutral` | none | `[pause]` at a clause break | 1.0 |
| `reassured` | `<soft>` on calming clause | `[exhale]` or `[sigh]` | 1.0 |
| `concerned` | `<soft>` | `[pause]` or `[sigh]` | 1.0 |
| `anxious` | `<higher-pitch>` ≤6 words, else `<soft>` | `[breath]` or `[inhale]` | 0.95 |
| `pain` (somatic / touch line) | `<soft>` on symptom clause | `[breath]` / `[exhale]` / `[pause]` | 0.85–0.90 |

At most one wrap family + one inline per turn. Do not emit `<slow><soft>` or a second `<slow>` wrap.

Age-band forbids (additive): `child` / `adolescent` forbid `[cry]`, `[giggle]`, `[laugh]`, `[chuckle]`, `<loud>`, `<build-intensity>`, `<sing-song>`, `<singing>`, `[hum-tune]`, `[lip-smack]`, `[tongue-click]`, `[tsk]`, `<whisper>`. Adult: no live `[cry]`. `adult-parent`: `[chuckle]` only on `reassured`.

xAI tag inventory (reference, not an allowlist): inline `[pause] [long-pause] [hum-tune] [laugh] [chuckle] [giggle] [cry] [tsk] [tongue-click] [lip-smack] [breath] [inhale] [exhale] [sigh]`; wrap `<soft> <whisper> <loud> <build-intensity> <decrease-intensity> <higher-pitch> <lower-pitch> <slow> <fast> <sing-song> <singing> <emphasis>`.

## Prohibitions

- `[cry]`, `<loud>`, `<build-intensity>` (distress / scream register).
- `[hum-tune]`, `<sing-song>`, `<singing>` (not an exam register).
- `[lip-smack]`, `[tongue-click]`, `[tsk]`.
- `[laugh]` on `pain`; `[giggle]` on `pain` or `anxious`.
- `[chuckle]` on a child role.
- `<whisper>` on `pain` (inaudible required facts in XR).
- LLM-authored executable tags. Strip provider-grammar markup only (do not eat every `[…]` / `<…>`).
- Screaming, uncontrolled crying, seductive delivery.
- Stereotype / accent inference from phenotype or name.
- Diagnosis-signaling affect (“this voice means cardiac”).
- Custom voice clone of a real patient or learner.

A sob, if ever required, is a reviewed **scenario audio asset**, not a live tag.

## Accessibility

- Minimum intelligibility: no whole-turn whisper; `speed` ≥ 0.85.
- Captions are tag-free `spokenText`.
- Dropped tags are logged, not spoken, not captioned.

## Barge-in

Stop audio and synchronized motion atomically on the same `turnId` in `ActorTurnExecution`. Do not mutate `ActorTurnPlan`. Record partial delivery. Do not commit unspoken words as heard.

## Safety / claims

Prosody is training color. It is **not evidence for** learner empathy, patient psychology, clinical validity, or exam scoring.

Telemetry: no prompt text, no hidden facts, no raw learner audio in span attributes (`docs/openclinxr/model-provider-and-voice-routing.md`).

Provider: synthetic data. Built-in Grok `voice_id` roster only for SP identity. Record provider, model, voice id, mapper version on the plan.

## Review evidence required before promotion

1. Fixed utterance matrix: same line under each dialogue emotion, plus one somatic-`pain` touch line.
2. Neutral-versus-emotion A/B clips (harness wav/mp3, not a schematic).
3. Orchestrator (not producer) grades exaggeration, stereotype, and intelligibility.
4. Peds patient lines: confirm `[cry]` / `<loud>` never reach the wire.
5. Latency and cost recorded (target: split stack, not S2S).
6. Artifact: version, hash, supported `voice_id`s, mapper version, expiry, named reviewers, rollback = neutral preset.

## Promotion (later slice)

Named reviewers sign the evidence pack. Gate reads that artifact. Absent/expired → neutral prosody, language continues. Do not delete the historical “always blocked” tests; replace them with the artifact contract.

Unify blocker strings to `emotional_prosody_policy_review_missing` + `affect_safety_review_missing`. Alias or delete `emotional_prosody_clinical_review_missing` and `prosody_safety_evidence_missing`.

## HIPAA note

“HIPAA eligible” on xAI Voice is a BAA sales label. It does not make this simulation a covered encounter and does not authorize PHI or real-voice cloning. Simulation-only local/dev does not need a BAA to use this policy.
