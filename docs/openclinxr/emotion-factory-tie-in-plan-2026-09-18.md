# Emotion factory tie-in plan — 2026-09-18

Date: 2026-09-18
Status: draft vertical (R2′ then R1′, serial)
Authority: current-reference, subordinate to AGENTS.md, GUARD_BLUEPRINT, MADR 0052, `docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md`
claimScope: simulated actor behavior
notEvidenceFor: clinical affect, scoring, Quest readiness, exam equivalence

Adversarial review: implementation-plan-gap-attacker, four turns (attack → replacement → draft → polish). Parent verified cites against the tree before authoring.

## Claim

Station-plan affect reaches the learner face through lids + nose + mouth-corner. Anxious and concerned read on brows, lids, and nose. Reassured adds mouth-corner pull. No cheek-named morph ships on this path.

R2′ visible delta is the first station reply: dropped-plan (undefined face) → engine baseline anxious (brow 0.62). Later anxious-holds are not new pixels. Empathetic → reassured has no smile until R1′. R2′ is the parse landing, not the full product path.

## Measured current state (VERIFIED)

| fact | cite |
|---|---|
| Cheek canonical resolves null on FACS bodies by design | `packages/openclinxr/asset-registry/src/morph-target-resolver.ts:41-43` |
| Runtime group drives lids×0.85 + nose×0.4; no AU12 row | `packages/openclinxr/xr-humanoid-animation/src/face-rig.ts:339-349` |
| Weight tables: anxious cheekTension 0.48 / reassured 0.18 / pain 0.72 | `packages/openclinxr/arena/model-vetting/src/emotion-transition.ts:22-26` |
| Drive law `cheekTension + openness×0.22` → reassured≈0.18, delta vs neutral ≈0.10 | `packages/openclinxr/xr-humanoid-animation/src/face-rig.ts:412` |
| Loader caps 32, walks `expression` first | `packages/openclinxr/factory-stations/src/body_param/mpfb_body.py:91-107` |
| API returns plan; route serializes result | `packages/openclinxr/scenario-runtime/src/runtime-types.ts:161-170`, `packages/openclinxr/rest/src/routes/encounter-session-routes.ts:140` |
| UI-XR reads only `result.response.text`; station block never parses plan | `packages/openclinxr/xr-runtime-state/src/runtime-state.ts:1822-1828`, `apps/ui-xr/src/main.ts:2388-2406` |
| Plan clamp: pain/unrepresentable → neutral | `packages/openclinxr/xr-dialogue/src/actor-turn-plan-consumption.ts:122,152-154`, `packages/openclinxr/scenario-runtime/src/actor-turn-plan.ts:41-46` |
| API path `somaticEmotion: null` | `packages/openclinxr/scenario-runtime/src/actor-turn-generation.ts:231` |
| Engines live server-side, baseline anxious | `packages/openclinxr/scenario-runtime/src/scenario-runtime.ts:116-118`, `packages/openclinxr/scenario-runtime/src/emotion-policy.ts:18-21` |
| Parser tolerates plan-only (`execution ?? null`) | `packages/openclinxr/xr-dialogue/src/actor-turn-plan-consumption.ts:174-188` |

Installed MPFB `data/targets/cheek/` holds 16 phenotype files (volume, bones, inner, trans). `data/targets/expression/units/` holds 34 unique FACS names (102 files, three ethnic copies). AU6 cheek-raiser is absent from that tree. `mouth-corner-puller` (AU12) and `eye-*-slit` (AU7) are present.

## What is already integrated

- Touch pain: `handleClinicalTouch` → `startHumanoidEmotionTransition(slot, cfg.emotion, now)` (`apps/ui-xr/src/main.ts:4218`). Smoke fixtures use `emotion: "pain"` (`tools/openclinxr/evidence/clinical-touch-smoke.ts:53`).
- API `POST .../actor-response` returns `actorTurnPlan` on `GenerateActorResponseResult`.
- Catalog ships 32 FACS including `mouth-corner-puller` and `eye-*-slit` (`apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-catalog.json:61`, `body-param-adult_lean_female-library.provenance.json:47`).
- Silence-pain hold FIXED (`packages/openclinxr/xr-humanoid-animation/src/natural-blink-and-emotion.test.ts`: authored pain survives silence).
- Frozen-turn face callback exists (`apps/ui-xr/src/main.ts:1348-1350`); that is not the station `requestActorResponse` path.

## What is not integrated

- Parse miss: station block uses `actorResponseTextFromApiResult` only (`main.ts:2394`).
- AU12 undriven (`face-rig.ts:339-349`).
- No cheek-named factory key on the load path (`mpfb_body.py:91-107`).
- `EmotionEngine` has zero `apps/ui-xr` callers; engines live in scenario-runtime.
- `facePresetId` decorative: `live_weights_follow_dialogueEmotionTo_not_facePresetId` (`actor-turn-plan-consumption.ts:140-148`).
- `somaticEmotion` is null on the API generate path.

## R2′ — station plan parse (FIRST)

Owner: xr-runtime-state + apps/ui-xr.

Write roots:

- `packages/openclinxr/xr-runtime-state/src/runtime-state.ts`
- `apps/ui-xr/src/main.ts` (station block `:2388-2412`)
- `packages/openclinxr/xr-dialogue/src/actor-turn-plan-consumption.ts` (parse-only if needed)

Shape: plan-only, execution null. No typed API change. After `requestActorResponse`, parse `result.actorTurnPlan`, `registerLiveActorTurn` under `tag`, drive caption + face from `consumeLiveActorTurn`.

| proof | rule |
|---|---|
| `run:` extend `apps/ui-xr/src/expression-weights-follow-actor-turn-plan.test.ts` with (11a) source: station block calls plan parse/register on the `requestActorResponse` result (fails today: only `actorResponseTextFromApiResult` at `main.ts:2394`); (11b) behavior: recorded `GenerateActorResponseResult` JSON (`dialogueEmotionTo: anxious`, no execution) → `faceEmotion=anxious`, caption=`plan.spokenText` | fails pre-fix on both |
| `changed:` `apps/ui-xr/src/main.ts` station block | must touch the live call site |
| `live:` R2b clause — recorded anxious plan through the call site yields brow-0.62 path vs today's `liveTurn?.faceEmotion` undefined (`main.ts:2403`) | no fixture-only green |

Diagnosis header IMMUTABLE: keep the drop math; flip the assertion; append `## FIXED`. Do not rewrite the original paths or numbers.

NOT TESTED: voice/synthesis timing, barge-in, pain-on-plan, execution join.

## R1′ — reassured AU12 row (SECOND)

Owner: xr-humanoid-animation.

Write roots: `packages/openclinxr/xr-humanoid-animation/src/face-rig.ts` + new test only.

Per-emotion AU12 row in face-rig: `reassured → mouth-corner-puller ≥ 0.5`. Pain, anxious, and neutral AU12 = 0. Do not hang AU12 on `cheekTension` (pain 0.72 would smile hardest). Do not add a 4th `HumanoidExpressionWeights` channel. Do not edit `packages/openclinxr/arena/model-vetting/src/emotion-transition.ts` this vertical.

| proof | rule |
|---|---|
| `run:` NEW `packages/openclinxr/xr-humanoid-animation/src/reassured-drives-mouth-corner-puller.test.ts` — header records the 0.10-delta math; RED asserts `drivenTargetNames` contains `mouth-corner-puller` AND influence ≥ 0.4 on the promoted-lib dictionary | fails pre-fix (absent + 0.18) |
| `live:` orchestrator native pixel grade at learner distance | grade decides; byte floors prove nothing |

Diagnosis header IMMUTABLE as above.

NOT TESTED: AU12 anatomical correctness; ethnic-copy parity.

## Parked residuals

| item | why parked |
|---|---|
| Q4 execution append | `main.ts:2407-2412` ignores `synthesizeActorSpeech` return; `SynthesizeActorSpeechResult.actorTurnExecution?` exists (`runtime-types.ts:122-126`) |
| Two missing nose units (`nose-right-dilatation`, `nose-right-elevation`) | loader cap 32; not cheeks |
| Pain-on-plan | `asDialogueEmotion` + `somaticEmotion: null`; touch already drives pain locally |
| Factory `targets/cheek/` load | phenotype volume/bones, wrong job for affect |
| Cheek 01 community pack | CC0 identity (chipmunk/jowls), same wrong job |
| Duplicate weight table | Model Vetting `emotion-transition.ts` 3-channel table can drift from the face-rig AU12 row; later slice must import the row or delete the duplicate |

## Kill list

- Slice A census / pin-34 (would go green on a directory listing; `mouth-corner-puller` already ships)
- Both-brows re-proposal (already ships at `face-rig.ts:339-349`)
- Cheek-volume as affect
- 4th weight channel
- Reopen silence-neutral RED (FIXED)
- Typed API change for this vertical
- Rebake before a native grade of R1′
- Hand-authored Anny-style `openclinxr_cheek_tension` on MPFB

## Grade protocol

Native resolution. Learner distance. Subject: `apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb` (`body-param-catalog.json:18`). Not the unpromoted scratch adult-nurse GLB under `/tmp`.

Grade R2′ brow/lid delta (anxious vs dropped-plan) first. Grade R1′ mouth-corner second. Record what was seen.

## Collision / bake slot

R1′ write root `face-rig.ts` vs R2′ write roots `main.ts` / `runtime-state.ts`: disjoint. Shared tests (`expression-weights-follow-actor-turn-plan.test.ts`, `natural-blink-and-emotion.test.ts`) assert preserved behavior. Neither slice bakes. Rebake authorized only if the R1′ grade shows invisibility on the promoted GLB.
