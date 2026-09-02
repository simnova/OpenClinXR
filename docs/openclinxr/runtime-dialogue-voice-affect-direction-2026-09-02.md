# Runtime Dialogue, Affect, Lip-Sync, and Voice — Direction

Date: 2026-09-02
Status: current-reference (sequence owner)
Authority: subordinate to AGENTS.md, D9/D14, protected blueprint-factory guardrails, `docs/openclinxr/communication-style-and-emotion-qa.md`, `docs/openclinxr/model-provider-and-voice-routing.md`, `docs/openclinxr/local-ai-voice-model-strategy.md`
Claim boundary: simulated-actor training behavior only. Not clinical validity, scoring, licensure, Quest readiness, or HIPAA product certification.

## 2026-09-02 accepted amendments

This file is the sequence owner. Accepted architecture from `docs/openclinxr/runtime-dialogue-voice-direction-response-2026-09-02.md` is merged here. That file is rationale only.

Operator review corrections applied on merge:

- DeepSeek peak hours stay **Monday–Friday** UTC 01:00–04:00 and 06:00–10:00 (official pricing). UTC+8 09–12 / 14–18 is the conversion, not “every day.”
- TTS pin remains **$15 / 1M characters**. S2S starting **$0.05 / min** for `grok-voice-latest`; do not call `grok-voice-think-fast-2.0` as the SP brain. `$4.20/1M` was never a pin in this file.
- Voice identity is a **reviewed allowlist** over the built-in roster (`eve` / `ara` / `leo` / `rex` / `sal` plus later named voices that pass the signed review). Not a five-voice ceiling.
- Slice 1 `done_when` freezes types and the plan/execution split. Classifier behavior, mapper strip tests, and barge-in render live in slices 2–6.

Sibling: `docs/openclinxr/emotional-prosody-policy-review-2026-09-02.md` remains the signed-artifact candidate. Neither file enables live Grok TTS by itself.

## Decision

Advance language, emotion state, face/pose, lip-sync, and voice prosody as one program.

```text
learner audio
  → Grok STT (or fixture)
  → EmotionEventClassifier
  → EmotionEngine (dialogue) + touch/somatic state
  → hidden-fact guardrail
  → DeepSeek { spokenText }          // thinking disabled in payload
  → tag sanitation (provider grammar)
  → EmotionPerformanceMapper
  → validate + freeze immutable ActorTurnPlan
       ├── FACE
       ├── pose
       ├── gesture
       └── Grok TTS
  → synchronized render
  → append ActorTurnExecution
  → Q4 / replay = plan + execution + authored provenance

  ↺ barge-in: text.clear → audio.clear
       → ActorTurnExecution.truncated  (does not mutate the plan)
       → optional new plan for the replacement turn
```

Invariant: no render modality receives a live actor turn until the final immutable `ActorTurnPlan` has been composed and validated. Do not persist an `ActorTurnDraft`. An internal builder is enough:

```ts
buildActorTurnPlan({
  event,
  emotionTransition,
  spokenText,
  actorPolicy,
  somaticState,
  providerProvenance,
})
```

The builder invokes the mapper and emits one validated plan.

Do not use Grok speech-to-speech (`wss://api.x.ai/v1/realtime`, `grok-voice-think-fast-2.0`) as the standardized-patient brain.

Do not let the language model emit executable speech tags. Tags are a render of policy, same as FACE. DeepSeek does not emit `gesture_cues`.

## Why this, now

Operator direction 2026-09-02: runtime LLM for language is in scope (DeepSeek for cost); Grok voice APIs are in scope if they fit.

D9: the factory stays deterministic (`bakePathLlm: false` on `dialogue_runtime`). LLM belongs only in runtime dynamic dialogue. D14: generative motion and lip-sync are unlocked as factory/cagematch stations, not as a second ungoverned runtime brain.

The current defect is five independent affect choosers that can contradict one another. FACE already moves.

## Control plane

| Layer | Owner | Job | Must not do |
|---|---|---|---|
| Case policy | `CaseEmotionPolicy` + `communicationProfile` | Baseline, bounds, transition rules, style | Invent new emotions per turn |
| Learner event | deterministic `EmotionEventClassifier` | Map STT / timeout / barge-in / touch to `EmotionEventKind` | Score the learner; default unknown to `learner_clinical_question` |
| Dialogue state | `EmotionEngine.resolveEmotionTransition` | Pure `from × event → to`, clamped; dialogue ranks only | Call a model; accept `pain` as a dialogue value |
| Somatic state | touch / scenario runtime | Last touch-response emotion, or null | Smuggle new dialogue ranks |
| Language | DeepSeek via `OpenAiCompatibleModelProviderAdapter` | `{ spokenText }` from visible facts + current dialogue emotion | Reveal hidden facts; emit TTS tags; choose eventKind / FACE / gesture |
| Performance | `EmotionPerformanceMapper` | Full key → face, pose, gesture, allowlisted tags, speed | Free-form nonverbal |
| Committed intent | immutable `ActorTurnPlan` | One planId consumed by every modality | Mutate on barge-in |
| Rendered outcome | append-only `ActorTurnExecution` | Audio URIs, interruption, visemes, fallbacks | Choose affect |
| Actor voice | Grok `wss://api.x.ai/v1/tts` (unary `POST /v1/tts` for cache/replay) | Audio | Change actor state |
| Learner hearing | Grok `wss://api.x.ai/v1/stt` (REST `POST /v1/stt` for review dumps) | Transcript + turn-taking | Answer as Grok |
| Factory visemes | Rhubarb station | Offline bake from **Grok unary bytes** | Live Quest subprocess; macOS `say` as production audio |
| Review | Q4 packet | Authored state vs generated language vs mapped performance vs rendered execution | Infer clinical affect |

## What is already wired vs decorative

Consulted 2026-09-02: Codex CLI `gpt-5.6-sol` session `01a0630b-7275-7582-86fd-a37417ed837b` plus Grok 4.6 web research session `01a0630b-7128-7200-a636-e44c55c3939e`, checked against the tree.

### Wired

- Closed set `pain | anxious | concerned | reassured | neutral` — `packages/openclinxr/shared-schemas/src/schemas.ts` (`InteractionEmotionSchema`). `pain` is still representable as a dialogue `to` in that union.
- Case emotion policy (baseline, bounds, ordered transitions) — `CaseEmotionPolicySchema`.
- Touch responses carry `emotion` + `dialogueLine` + `responseClip` — `TouchResponseSchema`.
- `EmotionEngine` is pure; `pain` is already out of `DIALOGUE_EMOTION_ORDER` and clamps as neutral-rank — `packages/openclinxr/conversation-policy/src/emotion-engine.ts`.
- OpenAI-protocol adapter; DeepSeek sits on that seam by `baseUrl` — `packages/openclinxr/model-gateway/src/openai-compatible-adapter.ts`.
- Hidden-fact guardrail runs before the network call; `hiddenFacts` never leave the host.
- Persona prompt injects communication style — `buildActorPersonaSystemPrompt`.
- UI-XR expression weights and playback — `apps/ui-xr/src/main.ts` `expressionWeightsForEmotion`.
- Factory `dialogue_runtime` refuses a bake-time LLM (`bakePathLlm: false`).
- Factory `lip_sync` invokes Rhubarb as a real subprocess.
- Communication QA specifies hidden actor state + bounded `gesture_cues` for **authoring**. Runtime emission of those cues moves to the mapper (this amendment).

### Decorative or disconnected

- UI-XR live path infers emotion from dialogue keywords (`emotionForDialogueText`) or static profile text instead of `EmotionEngine` — `apps/ui-xr/src/main.ts`.
- Expression weights are a local lookup; they do not share a versioned performance plan with voice or gesture.
- `SpeechSynthesisRequest` has no emotion, tags, or performance-plan id — `packages/openclinxr/voice-gateway/src/types.ts`.
- Mock TTS `visemeCue` is hardcoded `"neutral-pain"` — `packages/openclinxr/voice-gateway/src/adapters.ts`.
- `emotional_prosody` is always `providerPath: "blocked"` with `emotional_prosody_policy_review_missing` — `voice-gateway/src/gateway.ts`. Capability-gateway uses different strings: `emotional_prosody_clinical_review_missing`, `prosody_safety_evidence_missing` — `capability-gateway/src/internal.ts`. Unify before slice 5 rewrites tests.
- Factory lip-sync uses macOS `say` then Rhubarb; that cannot align a Grok TTS waveform.
- `createActorDialogueModelGateway` composition as wired 2026-09-02: Muse Spark contributor first when an OpenRouter key is present, then DeepSeek Flash direct, then ox (retired fallback), local llama, mock — `model-gateway/src/index.ts`.

## Two records, two jobs

| Record | Job | Mutability |
|---|---|---|
| `ActorTurnPlan` | committed turn **intent** after mapping | immutable after validate |
| `ActorTurnExecution` | what **actually rendered** | append-only |

Interruption, actual TTS after fallback, audio URIs, viseme timelines, dropped chunks, and render failures are execution facts. A learner barges in only after playback begins. Barge-in never mutates the plan; it appends execution and may start a new plan for the replacement turn.

Replay evaluates `ActorTurnPlan + ActorTurnExecution`. Faculty sees four layers plus dropped-tag log plus a “prosody neutralized” flag when the signed artifact is missing or expired.

### `ActorTurnPlan` (illustrative, post-mapper)

```ts
type DialogueEmotion = "anxious" | "concerned" | "reassured" | "neutral";
type SomaticEmotion = "pain";

type ActorTurnPlan = {
  planId: string;
  planVersion: number;
  turnId: string;
  stationRunId: string;
  actorId: string;
  respondingActorId: string;
  turnIndex: number;

  spokenText: string;            // provider-markup-free; captions use this
  spokenTextForTts: string;      // mapper-approved tags only

  dialogueEmotionFrom: DialogueEmotion;
  dialogueEmotionTo: DialogueEmotion;
  somaticEmotion: SomaticEmotion | null;

  eventKind: EmotionEventKind; // includes planned learner_unclassified
  eventKindSource: "classifier" | "touch" | "timeout" | "barge_in";
  suggestedEventKind?: EmotionEventKind; // QA echo only; never consumed

  styleFamily?: string;
  style?: string;
  intensityBucket: "low" | "mid" | "high";
  ageBand: "child" | "adolescent" | "adult" | "adult-parent";

  performancePlanId: string;
  facePresetId: string;
  posePresetId: string;
  gestureClipIds: readonly string[];

  prosody: {
    wrapTags: readonly string[];   // ≤1 family; do not nest <slow><soft>
    inlineTags: readonly string[]; // ≤1
    speed: number;                 // 0.7–1.5
    droppedTags: readonly string[];
  };

  voiceId: string;
  pronunciationReplace?: Record<string, string>;

  languageProvenance: {
    providerId?: string;
    fallbackUsed: boolean;
  };

  claimScope: "simulated_actor_behavior";
  notEvidenceFor: readonly string[];
};
```

Absent from the plan on purpose: interruption result, playback timestamps, audio URI, actual TTS provider after fallback, viseme timeline, render failure.

`notEvidenceFor` includes at least `clinical_affect_inference`, `empathy_score`, `licensure`.

Do not reuse `InteractionEmotion` for both dialogue fields. `dialogueEmotionTo === "pain"` must be unrepresentable.

### `ActorTurnExecution` (illustrative)

```ts
type ActorTurnExecution = {
  planId: string;
  turnId: string;
  ttsProviderId?: string;
  audioStartedAtMs?: number;
  audioEndedAtMs?: number;
  interruption:
    | { kind: "none" }
    | { kind: "truncated"; atMs: number; reason: "learner_barge_in" | "system_cancel" }
    | { kind: "replaced"; atMs: number; replacementPlanId: string };
  renderedProsodyTags: readonly string[];
  droppedProsodyTags: readonly string[];
  actualAudioUri?: string;
  visemeTimelineId?: string;
  fallback: { language: boolean; tts: boolean };
};
```

## Dual affect

```text
dialogueEmotion   ← EmotionEngine (dialogue ranks only)
somaticEmotion    ← last touch-response emotion, or null
composed          ← mapper(dialogue, somatic, style, …)
```

Composition v1:

- If `somaticEmotion === "pain"` and a touch clip is still playing, FACE/pose prefer somatic; TTS wrap prefers dialogue unless the spoken line is the touch `dialogueLine`.
- If no somatic, mapper uses dialogue only.
- `pain` never enters `EmotionEngine` dialogue rank (already true in `emotion-engine.ts`).
- Grow `SomaticEmotion` only when a new touch/somatic state is authored.

## Event classification

Owner: deterministic `EmotionEventClassifier`. Not DeepSeek. Not a local classifier model. Not embedding nearest-neighbor. Not keyword matches in the **actor** line.

v1 is allowlisted tokens / trace tags on **learner** STT (D9-legal). It must not become an empathy score.

```ts
type EmotionEventRule = {
  id: string;
  kind: EmotionEventKind;
  anyToken?: readonly string[];
  anyTraceTag?: readonly string[];
  notToken?: readonly string[];
  actorRole?: readonly string[];
};
```

| Kind | v1 signal | Must not do |
|---|---|---|
| `learner_empathetic` | allowlisted validation phrases + optional `emotion_acknowledged` tag | Score empathy |
| `learner_dismissive` | allowlisted dismissal / premature-reassurance / blame phrases | Infer intent from silence |
| `learner_acknowledgement` | short backchannel list | Treat as clinical progress |
| `learner_clinical_question` | authored rule match only | Use as the unknown default |
| `learner_personal_question` | allowlisted social / identity probes | Open a hidden-fact path |
| `learner_interruption` | barge-in flag from the voice clock | Classify from partial STT |
| `actor_silence_timeout` | station timer | |
| `learner_unclassified` | **default** | Mutate dialogue state |

Fail-closed: known event → authored EmotionEngine transition; unknown → `learner_unclassified` → hold current dialogue state. The engine already holds when no rule matches; the new kind makes that hold visible in traces.

The model may echo `suggestedEventKind` in a QA-only field. The engine consumes only the classifier. A disagreement is logged as `eventKindEchoMismatch` and never changes state.

## Performance mapper

```text
(
  dialogueEmotion,
  somaticEmotion,
  styleFamily,
  style,
  intensityBucket,
  actorRole,
  ageBand
) → performancePlanId
```

Intensity buckets: `low` (<0.34), `mid` (0.34–0.66), `high` (>0.66). Do not feed raw floats into TTS tags.

If a cell is missing, **state wins** and the cell falls back to the emotion-only row. Unsupported tags are stripped and recorded.

DeepSeek does not emit `gesture_cues`. Authored communication/style docs define the palette. Runtime selection belongs to the mapper. This tightens `communication-style-and-emotion-qa.md` and `virtual-patient-agent-model.md` for **runtime emission**; they remain authority for **authoring**.

`ActorTurnPlan` may wrap today’s `ActorResponseResult` (`text`, `responseKind`, `traceTags`, `provenance`). Trace tags stay as scoring-adjacent station events, not nonverbal invention.

## Speech tags

xAI does not ship an `emotion=` field on TTS. Affect is tags inside `text`, plus `speed`.

Verified inventory on `POST /v1/tts`:

- Inline: `[pause]` `[long-pause]` `[hum-tune]` `[laugh]` `[chuckle]` `[giggle]` `[cry]` `[tsk]` `[tongue-click]` `[lip-smack]` `[breath]` `[inhale]` `[exhale]` `[sigh]`
- Wrap: `<soft>` `<whisper>` `<loud>` `<build-intensity>` `<decrease-intensity>` `<higher-pitch>` `<lower-pitch>` `<slow>` `<fast>` `<sing-song>` `<singing>` `<emphasis>`

### Allowlist (v1)

At most **one wrap family + one inline** per turn. Do not emit `<slow><soft>`. Do not also emit `<slow>` when wrap is `<soft>`. Pain uses `<soft>` on the symptom clause plus `speed` 0.85–0.90.

| Dialogue / somatic | Wrap | Inline (≤1) | `speed` |
|---|---|---|---|
| `neutral` | none | `[pause]` at a clause break | 1.0 |
| `reassured` | `<soft>` on the calming clause | `[exhale]` or `[sigh]` | 1.0 |
| `concerned` | `<soft>` | `[pause]` or `[sigh]` | 1.0 |
| `anxious` | `<higher-pitch>` on ≤6 words, else `<soft>` | `[breath]` or `[inhale]` | 0.95 |
| `pain` (somatic / touch line) | `<soft>` on the symptom clause | `[breath]` or `[exhale]` or `[pause]` | 0.85–0.90 |

### Age-band forbids (additive)

| Age-band | Extra forbids |
|---|---|
| `child` | `[cry]`, `[giggle]`, `[laugh]`, `[chuckle]`, `<loud>`, `<build-intensity>`, `<sing-song>`, `<singing>`, `[hum-tune]`, `[lip-smack]`, `[tongue-click]`, `[tsk]`, `<whisper>` |
| `adolescent` | same as child (`[chuckle]` still forbidden) |
| `adult` | no live `[cry]`; sobs are reviewed assets |
| `adult-parent` | `[chuckle]` allowed only on `reassured` |

Global forbid: `[cry]`, `<loud>`, `<build-intensity>`, `[hum-tune]`, `<sing-song>`, `<singing>`, `[lip-smack]`, `[tongue-click]`, `[tsk]`, `[giggle]` on `pain`/`anxious`, `[laugh]` on `pain`.

A sob, if a case ever needs one, is a reviewed scenario audio asset, not a live tag.

### Tag sanitation

Do not blindly strip every `[…]` or `<…>` from actor language. That can eat legitimate future dialogue.

```text
generated spoken text
  → detect provider markup / forbidden tag syntax
  → strip or reject those tags
  → preserve ordinary punctuation and content
  → mapper adds approved rendering tags
```

- `spokenText` is provider-markup-free (captions, replay transcript, traces).
- `spokenTextForTts` may contain only mapper-approved provider markup.
- DeepSeek output cannot determine eventKind, face, pose, gesture, or prosody.

## DeepSeek language route

Use the existing `OpenAiCompatibleModelProviderAdapter`. Thinking is **on by default**. “Thinking off” is not the absence of a flag.

```json
{
  "model": "deepseek-v4-flash",
  "max_tokens": 256,
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" }
}
```

On the OpenAI SDK path: `extra_body: { thinking: { type: "disabled" } }`. Do not also send `reasoning_effort` when thinking is disabled.

JSON mode on Flash is prompt-cooperative, not constrained decoding. The prompt must contain the word `json` and the exact `{ "spokenText": string }` example.

Fallback ladder (gateway already walks ready adapters; typed refusals must not failover — `#631`):

1. DeepSeek Flash, thinking off
2. Local OpenAI-compatible llama **only if** `OPENCLINXR_LOCAL_LLAMA_BASE_URL` is set
3. Authored fallback line for `(scenarioId, actorId, phase, dialogueEmotion)` — not the mock joke path in exam/demo
4. Mock last, and only in CI / explicit offline

`createActorDialogueModelGateway` should prefer `DEEPSEEK_API_KEY` → local llama → authored fallback → mock. Retire `OPENROUTER_API_KEY` / `stealth/ox-alpha` from the default actor-dialogue composition. Leave the OpenAI-compatible adapter itself generic.

Peak hours (official DeepSeek pricing, 2026-09-02): UTC 01:00–04:00 and 06:00–10:00 **Monday through Friday**. Equivalent local clock: UTC+8 09:00–12:00 and 14:00–18:00 on those weekdays. Weekends are off-peak.

Hidden-fact protection stays on the local model gateway. The language model remains a renderer, not a policy engine.

## Voice I/O

Pinned from xAI docs, 2026-09-02:

| Knob | Live station | Unary / Q4 |
|---|---|---|
| TTS endpoint | `wss://api.x.ai/v1/tts` | `POST /v1/tts` |
| `optimize_streaming_latency` | `1` default, `2` if TTFB misses | `0` (quality) |
| `with_timestamps` | `false` | `true` (captions / bake aid) |
| `speed` | mapper output, 0.7–1.5 | same, cached with the plan |
| `output_format` | pcm 24 kHz or opus per transport | wav/pcm for Rhubarb |
| `replace` | case lexicon, ≤200 entries | same |
| TTS session | multi-utterance, reuse socket | one-shot |
| STT endpoint | `wss://api.x.ai/v1/stt` | `POST /v1/stt` |
| `smart_turn` | `0.7` + `smart_turn_timeout=3000` (starting pin; remeasure) | n/a |
| `endpointing` | 400 ms default | n/a |
| `keyterm` | case vocabulary | n/a |
| `filler_words` | `true` only if traces keep “um” | `false` unless authored |
| `interim_results` | `true` — FACE/turn-taking may use partials; EmotionEngine waits for final or smart_turn commit | n/a |

Barge-in: client sends `text.clear`; server replies `audio.clear`; UI-XR drops unread audio and truncates face/viseme/pose for that `turnId` **in `ActorTurnExecution`** before the next plan is committed. Unspoken words are not “heard.”

Pricing pin (docs, not a marketing page): TTS **$15 / 1M characters**; STT batch **$0.10 / hour**, streaming **$0.20 / hour**; S2S starting **$0.05 / min** for `grok-voice-latest`. Re-fetch pricing the day a cost claim is published.

Voice identity: built-in roster only. Do not clone learners or real patients. Actor→voice is an allowlist file. Child actors do not share a parent voice id.

## Lip-sync clocks

xAI docs (fetched 2026-09-02): `with_timestamps=true` runs a post-synthesis alignment pass and is not recommended for live low-latency use. Live timestamps-as-visemes are out.

Rhubarb remains the factory / replay baker. Community cost class is ~5 s CPU per 30 s of audio — fine offline, fatal on a Quest frame. WASM Rhubarb is a cagematch candidate for **unary cache warm**, not the live render loop. Preston Blair 9-shape output still has to map onto the current FACE channels (`mouthOpen`, `browConcern`, `cheekTension`) plus whatever viseme morphs the humanoid actually exposes. Three channels cannot separate anxious from fearful; goldens must use the real channel set.

| Path | Audio | Mouth | Timestamps | `say` |
|---|---|---|---|---|
| Live Grok TTS | streaming WS, `optimize_streaming_latency: 1` | amplitude / lightweight viseme interpolator from PCM + plan weights; start on first `audio.delta` | **off** | no |
| Unary cache / Q4 replay | `POST /v1/tts`, PCM or WAV | Rhubarb on **those bytes** | on, for captions | no |
| No-network fixture | recorded wav or `say` | Rhubarb on fixture wav | n/a | fixture only |

Platform playback delay (often 30–60 ms) is a known drift source. Slice 6 may apply a one-frame audio hold or a pre-shift on the cue timeline. That is a measured constant, not a second brain.

Deferred, not production runtime: Grok `graph_times` as live visemes; Audio2Face / Speech2Motion (D14 cagematch only); WASM Rhubarb in-browser on Quest; MetaHuman-class 81-control runtime. Amplitude-only mouth is an acceptable live fallback when the interpolator is not ready.

## Latency budgets (contract now, measure in slice 6/7)

Inherited: `max_first_audio_ms: 2500` from `model-provider-and-voice-routing.md`. These numbers are targets until slice 6 measures them.

| Segment | Budget |
|---|---|
| STT smart_turn commit | p95 ≤ 1500 ms after silence (do not block FACE on this) |
| Event classify + EmotionEngine | ≤ 5 ms |
| DeepSeek Flash, thinking off, 256 cap | p95 ≤ 1200 ms; timeout → authored fallback |
| Mapper | ≤ 5 ms |
| TTS time-to-first-`audio.delta` | p95 ≤ 400 ms after `text.done` |
| Learner-stop → first audible actor phoneme | p95 ≤ 2500 ms |
| Barge-in truncate (audio+face+viseme+pose) | within 2 rendered frames of `audio.clear` |

Prefetch: unary TTS of the authored fallback **while** DeepSeek runs. Cache key = plan identity minus generated text. `with_timestamps` stays outside the live budget.

Spans already specified: `openclinxr.model.generate_actor_response`, `openclinxr.voice.synthesize`. No prompt text, hidden facts, transcript text, or raw audio as attributes. Correlate via `stationRunId` + `turnId`.

## Cloud vs local-first

Authorizing cloud voice I/O for simulated actors and learners (once credentials + evidence exist) does not repeal MADR 0021 for development, CI, or any run that cannot accept learner audio leaving the machine.

| Profile | Learner STT | Actor TTS | Actor language |
|---|---|---|---|
| CI | fixture text | mock / prerecorded | mock |
| Local dev, no keys | fixture or local sidecar | mock / `say` fixture | mock or local llama |
| Local spike | whisper.cpp / Moonshine cagematch | VibeVoice disabled for learners | local llama |
| Cloud-approved simulation | Grok streaming STT | Grok streaming TTS | DeepSeek Flash |
| Institutional pilot | blocked until ZDR/BAA schedule names TTS **and** STT, plus retention policy | same | DeepSeek or approved equivalent |

Do not retarget the Python FastAPI `/voice/realtime/ws` spike as “Grok-shaped.” Different adapter, same `VoiceProviderAdapter` seam.

Quest immersive-mic capture remains an **open measurement** from the 2026-08-05 local-STT cagematch spec. Cloud Grok STT does not close G0. Desktop Chrome is not headset evidence.

VibeVoice remains disabled for learners. Moshi / Qwen3-TTS remain spikes.

## HIPAA / retention

No learner streaming STT in any shared, class, or institutional run until (a) ZDR or an equivalent no-retention schedule **names TTS and STT**, (b) a retention policy for faculty replay is written, and (c) the Q4 packet can exist without raw learner audio when the customer forbids it.

Simulated SP lines and fake MRNs are typically not PHI. Learner mic can still be PII / FERPA. Custom voice clone stays forbidden regardless of BAA.

xAI Voice pages say HIPAA Eligible and point at a [BAA questionnaire](https://x.ai/legal/baa). Security FAQ: default API I/O stored 30 days; ZDR available. Voice overview also says audio is processed in real time and never stored — that conflicts with the 30-day audit log; treat as unresolved. Do not advertise HIPAA-compliant product status.

Sources: [Security FAQ](https://docs.x.ai/developers/faq/security), [Voice overview](https://docs.x.ai/developers/model-capabilities/audio/voice), [Enterprise FAQ](https://x.ai/legal/faq-enterprise/).

## Cost sketch (estimate only)

Assumptions: 15-minute station, 25 SP turns, ~40 words, learner mic open the whole time.

Rates verified 2026-09-02: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing), [xAI pricing](https://docs.x.ai/developers/pricing).

| Meter | 15-min station |
|---|---|
| DeepSeek Flash off-peak | ~$0.012 |
| DeepSeek Flash peak (UTC 01–04 and 06–10, Mon–Fri) | ~$0.025 |
| Grok TTS @ $15/1M chars, tags +10–20% | ~$0.08–$0.10 |
| Grok STT stream 0.25 h @ $0.20/h | ~$0.05 |
| Split stack | ~$0.14–$0.18 |
| S2S wall-clock (do not use) | $0.75–$1.20 at $0.05–$0.08/min |

Unary cache only hits when `spokenTextForTts` is identical. Generative lines mostly miss. Cache the authored fallback and repeated opening/closing lines. Cost is not the binding constraint. Latency and contradiction across modalities are.

## Why S2S is not the actor brain

1. Hidden facts are refused locally before any chat completion.
2. `EmotionEngine` is the affect SSOT. S2S owns wording, interruptions, and delivery inside one vendor session.
3. Barge-in must truncate audio + face + visemes on `ActorTurnExecution` without mutating the plan. S2S `response.cancel` mutates a private conversation.
4. Split stack is ~$0.14–$0.18 vs ~$0.75–$2.40 for S2S on a 15-minute station.
5. D9: LLM only for dynamic dialogue. S2S is a second LLM that also speaks.

Grok realtime may later be a transport experiment (STT/TTS sockets). It must not own truth, policy, or memory.

## Driving slice sequence

Keep 1→7. Do not enable `emotional_prosody` until slice 5 has a **registry-backed** signed artifact. Do not call Grok S2S in any of them. Slices 1–5 land on desktop UI-XR + harness wavs. Slice 6 `done_when` already says `NOT TESTED: worn Quest`.

### 1. Atomic actor-turn contract — Q1/Q4

Write roots: `packages/openclinxr/shared-schemas/`, `packages/openclinxr/conversation-policy/`, `packages/openclinxr/model-gateway/`

Post-mapper immutable `ActorTurnPlan`; `ActorTurnExecution` type; `DialogueEmotion` / `SomaticEmotion`; classifier type including `learner_unclassified`; style/intensity/ageBand; `respondingActorId`; `claimScope` / `notEvidenceFor`.

`done_when`:

- `changed: packages/openclinxr/shared-schemas/src/**` includes `ActorTurnPlan` and `ActorTurnExecution`
- no live modality accepts a pre-mapper / partial plan
- plan is immutable after validation (tests refuse mutation helpers)
- a plan cannot have `dialogueEmotion == pain` (type-level)
- schema rejects a turn with no `planId`
- every rendered modality type traces to the same `planId`
- `notEvidenceFor` includes `clinical_affect_inference`, `empathy_score`, `licensure`
- NOT TESTED: live DeepSeek, live Grok, headset; classifier behavior; barge-in render

### 2. EmotionEngine-first runtime orchestrator — Q1

Write roots: `packages/openclinxr/conversation-policy/`, `packages/openclinxr/scenario-runtime/`, `apps/ui-xr/`

Classifier is the event owner. Unknown input → `learner_unclassified` / hold. `emotionForDialogueText` fixture-only.

`done_when`:

- live UI-XR path consumes `plan.dialogueEmotionTo`; keyword heuristic is fixture fallback only
- `run:` dismissive vs empathetic events change FACE weights without keyword matches in the **actor** line
- DeepSeek output cannot determine `eventKind`
- NOT TESTED: headset capture

### 3. DeepSeek runtime route — Q1/Q4

Write roots: `packages/openclinxr/model-gateway/`, env/docs for `DEEPSEEK_API_KEY`

Thinking disabled in the payload. Authored fallback before mock. Retire ox-alpha from default composition.

`done_when`:

- `changed: packages/openclinxr/model-gateway/src/index.ts` registers `deepseek-actor-dialogue` when the key is present
- request body includes `thinking: { type: "disabled" }`
- hidden-fact canary still refuses before fetch; typed refusals do not failover
- timeout → authored fallback for `(scenarioId, actorId, phase, dialogueEmotion)`
- `run:` adapter tests with a fake `fetch`
- NOT TESTED: paid live DeepSeek (attach as evidence, not as the land proof)
- Do not update `model-provider-and-voice-routing.md` until this slice actually retires ox-alpha

### 4. Deterministic performance mapper — Q1/Q5

Write roots: `packages/openclinxr/conversation-policy/` (or `actor-performance-policy/`), `shared-schemas/`

Full key; one wrap; no `[cry]`; goldens include style × age-band; provider-grammar sanitation.

`done_when`:

- mapper never emits `[cry]` / `<loud>` / `<build-intensity>` / nested `<slow><soft>`
- DeepSeek output cannot determine gesture, face, pose, or prosody
- `spokenText` is provider-markup-free
- `spokenTextForTts` contains only mapper-approved provider markup
- spokenText matching provider tag grammar fails the strip test
- FACE weights and TTS tags come from the same `planId`
- NOT TESTED: audible Grok render (slice 5)

### 5. Prosody-aware voice contract + signed review — Q1/Q4

Write roots: `packages/openclinxr/voice-gateway/`, `packages/openclinxr/capability-gateway/`, `docs/openclinxr/emotional-prosody-policy-review-2026-09-02.md`

Unify blocker ids to `emotional_prosody_policy_review_missing` + `affect_safety_review_missing`. Delete or alias `emotional_prosody_clinical_review_missing` and `prosody_safety_evidence_missing`. Gate consumes a registry-backed signed artifact (hash + expiry + voice ids). Absent/expired → **neutral prosody**, language and trace still continue.

`done_when`:

- `emotional_prosody` is blocked only when the review artifact is missing/expired
- unknown tags fail closed; provenance records rendered vs dropped tags
- tests that previously froze “always blocked” are updated to the artifact contract, not deleted
- NOT TESTED: Quest playback

### 6. Actual-audio timing and lip-sync — Q1/Q5

Write roots: `packages/openclinxr/voice-gateway/`, `packages/openclinxr/factory-stations/src/lip_sync/`, `apps/ui-xr/`

Live: no Rhubarb, timestamps off, `optimize_streaming_latency: 1`. Factory/unary: Rhubarb on Grok bytes. `say` fixture-only.

`done_when`:

- live path does not call Rhubarb and does not set `with_timestamps`
- `lip_sync/run.ts` no longer depends on `say` for unary/Q4 (keep `say` as a no-network fixture)
- barge-in never mutates `ActorTurnPlan`; it creates/updates `ActorTurnExecution` for the same `turnId`
- barge-in truncates audio+face+viseme+pose within 2 frames of `audio.clear`
- `min-bytes:` on a recorded wav/mp3 from unary TTS in a harness (not a schematic)
- orchestrator grades the pixels/audio, not `min-bytes` alone
- NOT TESTED: worn Quest

### 7. Replay / reviewer surface — Q4/Q5

Write roots: review/trace packages, `apps/ui-admin/`, `apps/ui-xr/`

`done_when`:

- faculty sees plan + execution + dropped-tag log + “prosody neutralized” flag
- captions from tag-free `spokenText`
- replay can reconstruct authored state + generated language + mapped performance + rendered execution
- `claimScope` / `notEvidenceFor` forbid scoring/empathy inference from prosody
- NOT TESTED: institutional privacy review of learner audio retention

## BothyBoard hybrid + parallel waves

Markdown remains the architecture SSOT. Bothy cards carry **one TREE each**. Workers read this file; they do not copy the type tables into `done_when`.

Shape (copy of `docs/openclinxr/hybrid-board-and-unlock-plan-notes-2026-08-31.md`):

| Layer | Job |
|---|---|
| This file + emotional-prosody sibling + amendment rationale | Architecture, allowlists, latency targets, HIPAA |
| Idle parent `kind=parent` | `tsk_97c2be2ae2b473b9`. Pointer. Do not plant. Do not dequeue. |
| Children | One write-root closure + TREE. Plant only after the named RED is on **main**. |

`tasks.next` skips overlapping `writeRoots` (prefix match) and unfinished `depIds`. Parallelism is therefore a **package-boundary** fact, not a wish.

### Code-execution parallel DAG

Four packages do not import each other for the first land. They can run as four workers on four worktrees after (or with) the type card:

```text
Wave 1 — disjoint write roots, no depIds (plant after each RED is on main)
  tsk_680905aad2650f26  DVA-1  shared-schemas                      lane B   types
  tsk_c9ea045ef5887d06  DVA-2  model-gateway                       lane B   DeepSeek thinking-off
  tsk_0bc6a60304a99349  DVA-3  voice-gateway + capability-gateway  lane A   request fields + blocker ids
  tsk_233dce8c01df15c5  DVA-4  factory-stations/src/lip_sync       lane A   Rhubarb on wav bytes, say=fixture

Wave 2 — needs DVA-1 types in the consumed package
  tsk_41e1ed13f0e69405  DVA-5  conversation-policy                 lane A   classifier + mapper
         (one card: two files in one package; do not split or they contend)

Wave 3 — needs DVA-1 + DVA-5; DVA-6 ∥ DVA-7 ∥ DVA-9
  tsk_8db173ffa5986989  DVA-6  scenario-runtime                    lane A   engine-first consume
  tsk_d6b49fadd6b361e6  DVA-7  apps/ui-xr                          lane A   FACE from plan, heuristic=fixture
  tsk_45e81365c1ee3081  DVA-9  review-workflow                     lane B   plan + execution replay

Wave 4 — after DVA-3 and DVA-7 (same packages, so not earlier)
  tsk_fa5f40a1c2805d63  DVA-8  voice-gateway + ui-xr               live TTS/STT + barge-in execution
```

Do **not** put classifier and mapper on two cards. Both write `packages/openclinxr/conversation-policy/`. Integrate is serial; overlapping roots will not dequeue together, and two worktrees on one package is merge pain.

Do **not** start DVA-8 until DVA-3 has landed. Both write `packages/openclinxr/voice-gateway/`.

`apps/ui-xr` vs `packages/openclinxr/scenario-runtime` **are** disjoint. Wave 3 is the real N=2/3 win (A+A+B) once DVA-5 is Landed.

Lane A/B is a concurrency label, not a substitute for write-root disjointness. Two lane-A cards with different packages may run together; two lane-A cards on `voice-gateway` may not.

### Plant rule

Idle children may exist with TREE in the body. `tasks.plant` only after:

1. The `live:` test file is committed on main (`it.fails` today).
2. A destructive probe showed the RED fails on a clean checkout.
3. `changed:` names the fix-bearing file, not a directory.

Until then the parent comment is the index. `tasks.next` will not return Idle cards.

## Visibility

A slice in this program is done only when a skeptic can hear and see the same `ActorTurnPlan`: FACE weights change with EmotionEngine (not keywords), and TTS (or a recorded harness wav) carries the mapped tags. Schema-only landings are not the product.

Harness: isolated Model Vetting / dialogue cagematch first (D3), then UI-XR sample scene. Full-room capture is assembly proof, not diagnosis.

## The one thing we are most likely to get wrong

Wiring five integrations that still choose affect independently — or shipping an immutable `ActorTurnPlan` that later mutates when the learner barges in, whose dialogue field can legally be `pain`, and whose event kind defaults to a clinical question the learner did not ask.

The non-negotiable fix remains one versioned plan, consumed by every modality, with the classifier and the mapper inside the same fail-closed policy package as `EmotionEngine`, and a second record for what actually rendered.

## Research basis

- Repo: `emotion-engine.ts`, `schemas.ts`, `openai-compatible-adapter.ts`, `model-gateway/src/index.ts`, `voice-gateway` `gateway.ts` / `types.ts` / `adapters.ts`, `capability-gateway/src/internal.ts`, `dialogue_runtime/run.ts`, `lip_sync/run.ts`, `apps/ui-xr/src/main.ts`, `communication-style-and-emotion-qa.md`, `model-provider-and-voice-routing.md`, `local-ai-voice-model-strategy.md`.
- Codex CLI: `codex exec` gpt-5.6-sol, session `01a0630b-7275-7582-86fd-a37417ed837b`, 2026-09-02.
- Grok 4.6: session `01a0630b-7128-7200-a636-e44c55c3939e`, 2026-09-02.
- Accepted amendment rationale: `docs/openclinxr/runtime-dialogue-voice-direction-response-2026-09-02.md` (operator review 2026-09-02).
- Web (fetched): xAI TTS, Voice overview, S2S, STT, REST voice, custom voices, pricing, security FAQ, DeepSeek pricing and thinking-mode guide, BAA questionnaire.

## Related

- Rationale: `docs/openclinxr/runtime-dialogue-voice-direction-response-2026-09-02.md`
- Sibling policy: `docs/openclinxr/emotional-prosody-policy-review-2026-09-02.md`
- `docs/openclinxr/communication-style-and-emotion-qa.md`
- `docs/openclinxr/model-provider-and-voice-routing.md`
- `docs/openclinxr/local-ai-voice-model-strategy.md`
- D9 / D14 in `agents/rules/PROTO_VERIFY_DELEGATION.md` operator table
