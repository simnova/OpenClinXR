# Speaking-sync factory tie-in plan — 2026-09-18

Date: 2026-09-18
Status: draft vertical (S1 then S2 then S3, serial)
Authority: current-reference, subordinate to AGENTS.md, GUARD_BLUEPRINT, `docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md`, DVA-6 RED clause (7)
claimScope: simulated actor behavior
notEvidenceFor: clinical affect, scoring, Quest readiness, exam equivalence, phone-precision visemes

Audit: three muse-spark-1 explore scouts (factory baker, live UI-XR path, direction/DVA). Parent re-verified cites against the tree before authoring. No product code in this slice.

## Claim

Speaking-sync is two factory halves that do not meet on the live station reply.

Half A bakes Rhubarb mouth-cues JSON from a wav (today: macOS `say` fixture on the case's first authored line). Half B puts 15 `viseme_*` keys on the MPFB materialize mesh (visemes02 pack) or 32 FACS mouth units on library bodies.

The live station path speaks a caption, attaches a cue file only when the spoken text hashes to that first-line bake, and drops `synthesizeActorSpeech` `audioEvents`. DVA-6 `ActorTurnExecution` has no `audioUri` / `visemeTimeline`. Direction forbids live Quest Rhubarb and forbids inventing those fields to green a heuristic.

Visible delta for S1 is the first station reply: mouth follows PCM/amplitude (or a real `audioEvents[].visemeCue`) instead of `visemesForText` dwell. S2 replaces `say` with Grok unary bytes in the baker. S3 keys cues to that unary audio so replay matches the waveform.

## Measured current state (VERIFIED)

| fact | cite |
|---|---|
| Direction: factory visemes = Rhubarb on Grok unary bytes; live Quest subprocess and `say` as production audio are refused | `docs/openclinxr/runtime-dialogue-voice-affect-direction-2026-09-02.md:89,107,393,560,566` |
| Live clock: amplitude / lightweight interpolator from PCM; Rhubarb **off** | same file `:395-399` |
| `runLipSync` requires `wavPath`; unique rhubarb spawn; `lipSyncRunner.run` throws | `packages/openclinxr/factory-stations/src/lip_sync/run.ts:44-57,77-83` |
| Fixture TTS is `say` → `afconvert`; production `runLipSync` does not shell `say` | `packages/openclinxr/factory-stations/src/lip_sync/fixture-wav.ts:13-20`; `the-lip-sync-station-rhubarb-on-wav-not-say.test.ts:33-34` |
| Dark-factory station 9 always writes a `say` wav then Rhubarb, first authored utterance only | `tools/openclinxr/dark-factory/multi-case-runner.ts:1006-1039,1388` |
| 16 served cue JSON files under `apps/ui-xr/public/lip-sync-cues/<scenarioId>/`; 0 wavs under `public/` | tree listing 2026-09-18; `served-lip-sync-cues-have-no-gitignored-soundfile.test.ts` |
| Cue load is content-hash of spoken line; miss → text-derived timeline | `packages/openclinxr/xr-dialogue/src/viseme-baked-cues.ts:116-157,186-197` |
| Boot warms one initial line | `apps/ui-xr/src/main.ts:1693` |
| Station reply: caption + `triggerHumanoidDialogue`; `audioEvents` discarded after E5 join | `apps/ui-xr/src/main.ts:2407-2419`; `scenario-runtime.ts:476-525` |
| `triggerHumanoidDialogue` builds `phonemesForText` / `visemesForText` then `attachBakedCuesToSpeech` | `packages/openclinxr/xr-actor-dialogue/src/speech.ts:100-134` |
| `playIdentityBoundActorTurn` requires `artifacts.audio` + rhubarb viseme cues; zero `main.ts` callers | `packages/openclinxr/xr-dialogue/src/actor-turn-player.ts:152-168` |
| Audible TTS only `?openclinxrSpeakFixture=1` | `packages/openclinxr/xr-dialogue/src/speak-fixture-bridge.ts:76-83`; `actor-audio-runtime.ts:180` |
| DVA-6 execution: planId, turnId, interruption, prosody tags, fallback only | `packages/openclinxr/shared-schemas/src/schemas.ts:164-176` |
| Gaps reported, not invented; RED (7) locks it | `actor-turn-plan-consumption.ts:8-10,75-80,140-142`; `expression-weights-follow-actor-turn-plan.test.ts:173-189` |
| Mock TTS `visemeCue` is `"neutral-pain"` | `packages/openclinxr/voice-gateway/src/adapters.ts:66` |
| visemes02: 15 `viseme_*` on materialize, before helper strip; `configure_lip_sync` not called | `materialize_mpfb_humanoid_candidate.py:2100-2130,3642-3678` |
| Face-key loader cap 32; does not invent `viseme_*` | `packages/openclinxr/factory-stations/src/body_param/mpfb_body.py:65-107` |
| Resolver: identity, then case-variant (`viseme_AA`→`viseme_aa`), then visemes02 map, then FACS | `packages/openclinxr/asset-registry/src/morph-target-resolver.ts:15-28,94-105` |
| Anny `viseme_*` names are rigid-translation stubs | `docs/madr/0052-mpfb-graduation-plan.md:29` |

E5 (`e911fdde6`) joined `actorTurnExecution` for barge-in / dropped tags. It did not join `audioEvents`. The emotion-plan parked row "Q4 execution append" is closed for execution identity only.

## What is already integrated

- Rhubarb is a real factory subprocess with a required wav (`runLipSync`).
- Dark-factory `lip_sync` stage runs per case that authors a spoken line.
- Served cue JSON (Rhubarb A–H/X) exists for 15 scenario ids plus one root file.
- Runtime maps those shapes to tokens (A→PP … X→sil) and can attach them to `slot.activeSpeech.bakedCues`.
- Materialize loads visemes02 (15 keys) on the nurse inspect/bake path.
- Library FACS bodies still compose visemes from mouth units; `mouth-open` is capped.
- Station plan parse (R2) and AU12 reassured row (R1) are on origin. Face affect is a different vertical.

## What is not integrated

1. **Live reply text never matches the bake.** Factory hashes the first authored opening line. Generated `plan.spokenText` is a different string, so `loadBakedMouthCuesForUtterance` returns null and the mouth stays on `visemesForText` dwell (`speech.ts:100-101`).
2. **Baker audio is `say`, not Grok unary.** Direction: unary/Q4 = Rhubarb on Grok bytes. `runLipSyncStation` defaults `wavPath` to `writeLipSyncFixtureWav` (`multi-case-runner.ts:1008,1038`).
3. **No served wav.** Player that requires audio (`playIdentityBoundActorTurn`) cannot run on the live path. 0 wavs under `public/`.
4. **`audioEvents` die at the station call site.** `SynthesizeActorSpeechResult` returns `{ audioEvents, traceEvents, actorTurnExecution }` (`runtime-types.ts:122-126`, `scenario-runtime.ts:525`). `main.ts:2417-2419` keeps execution only. Chunk `visemeCue` never reaches a morph.
5. **Station does not take the frozen-turn audio player.** It calls `triggerHumanoidDialogue` (caption + text visemes). `playFrozenTurn` is the `speech.ts:81-83` ForTrace branch when `liveTurn` exists, not the station block at `:2407`.
6. **DVA-6 cannot carry viseme/audio.** Clause (7) fails if those keys appear on execution. Direction still wants them as execution facts (`:185-187,194-210`) on a later schema (DVA-8 `tsk_fa5f40a1c2805d63`), not smuggled onto DVA-6.
7. **`lipSyncRunner.run` is plan-only.** Baker runs only through dark-factory `runLipSyncStage`.
8. **Live Grok TTS / STT is not the learner default.** No-URL UI uses local fixtures; speak fixture is a query param.

## S1 — station mouth from synthesize `audioEvents` (FIRST)

Owner: apps/ui-xr + xr-dialogue. Q1 conversation tooling.

Write roots:

- `apps/ui-xr/src/main.ts` (station block after `:2415`)
- `packages/openclinxr/xr-dialogue/src` (amplitude or chunk-cue drive; no DVA-6 field)

Shape: keep DVA-6 execution untouched. After `registerLiveActorTurn` of the synthesize execution, read `audioEvents` from the same `voiceResult` object (parallel to how R2 read `actorTurnPlan`). Drive `slot.activeSpeech` mouth from:

- real PCM / duration when the gateway emits it, or
- per-chunk `audioEvent.visemeCue` only when it is not the mock constant `"neutral-pain"` (`adapters.ts:66`).

Do not write `visemeTimeline` onto `ActorTurnExecution`. Do not call live Rhubarb.

| proof | rule |
|---|---|
| `run:` extend `expression-weights-follow-actor-turn-plan.test.ts` with (13): station block after `synthesizeActorSpeech` reads `audioEvents` (fails today: only `actorTurnExecution` at `main.ts:2417-2419`) | source pin |
| `run:` recorded `{ audioEvents: [{ visemeCue: "AA", durationMs: 200 }] }` moves named viseme or mouth-open vs text-dwell control | behavior |
| `live:` clause (7) still green (`visemeTimeline` / `audioUri` absent on execution) | counterweight |
| `changed:` `apps/ui-xr/src/main.ts` station block | live call site |

Diagnosis header for (7) and (11)(12) IMMUTABLE.

NOT TESTED: Grok unary bytes; Quest; Rhubarb on live PCM.

## S2 — factory baker on Grok unary wav (SECOND)

Owner: factory-stations lip_sync + dark-factory runner.

Write roots:

- `tools/openclinxr/dark-factory/multi-case-runner.ts`
- `packages/openclinxr/factory-stations/src/lip_sync/` (fixture stays)

Shape: `runLipSyncStage` takes `wavPath` from a recorded unary TTS artifact when present; `writeLipSyncFixtureWav` only when `OPENCLINXR_LIP_SYNC_FIXTURE=1` or no unary bytes. Cue filename stays `utterance-${sha1(text).slice(0,10)}` plus a sidecar that records `wavSha256` so replay can prove waveform identity.

| proof | rule |
|---|---|
| `run:` `the-lip-sync-station-rhubarb-on-wav-not-say.test.ts` stays green | no `say` in `runLipSync` |
| `run:` new RED: `runLipSyncStation` with `{ wavPath }` does not call `writeLipSyncFixtureWav`; missing wavPath without fixture flag errors | unary required |
| `changed:` `multi-case-runner.ts` `runLipSyncStage` | production caller |

NOT TESTED: paid Grok TTS in CI; promoting cue JSON to `public/`.

## S3 — live reply hash + optional unary recache (THIRD)

Owner: xr-dialogue baked cues + station.

Write roots: `packages/openclinxr/xr-dialogue/src/viseme-baked-cues.ts`, station block.

Shape: generated replies will not hit the 16 opening-line files. After S1 has audible/amplitude mouth, S3 adds an **offline** recache: unary Grok wav for `plan.spokenTextForTts` → `runLipSync` → attach those cues for **replay / Q4**, not for the live first packet (direction: live Rhubarb off). Live first packet stays S1 amplitude.

| proof | rule |
|---|---|
| `run:` generated spokenText that does not match a served opening hash still moves mouth via S1 (amplitude), not via silent skip | live |
| `run:` unary recache artifact is keyed by wav hash; `attachBakedCuesToSpeech` uses it only when `mediaPositionSeconds` is present (replay) | Q4 |

NOT TESTED: baking every possible generated line at case compile time (refused; unbounded).

## Parked residuals

| item | why parked |
|---|---|
| DVA-8 schema `audioUri` / `visemeTimelineId` on execution | `tsk_fa5f40a1c2805d63`; clause (7) forbids inventing them now |
| `playIdentityBoundActorTurn` as live path | needs artifacts.audio + rhubarb cues; S1/S3 must exist first |
| visemes02 on every promoted library GLB | FACS composition already maps; rebake is a factory slot, not this vertical |
| `FaceService.configure_lip_sync` | needs uninstalled `iocgpoly_lip_sync` addon |
| WASM Rhubarb / Audio2Face / Grok `graph_times` | D14 cagematch only (`direction:401`) |
| Learner STT | DVA-8; zero `apps/ui-xr` STT callers today |

## Kill list

- Invent `audioUri` / `visemeTimeline` on DVA-6 execution to green a test (clause (7) is the counterweight)
- Live Rhubarb or WASM Rhubarb on Quest
- macOS `say` as unary/production audio
- NVIDIA Audio2Face / Speech2Motion as production
- Runtime LLM visemes or DeepSeek speech tags
- Anny `viseme_*` stubs as the learner rail (MADR 0052)
- Census of `public/lip-sync-cues` as proof of live sync (directory listing of opening-line JSON)
- Re-bake every humanoid before an S1 grade
- Hand-author viseme timelines in `main.ts`

## Grade protocol

Isolate the subject. Named renderer: three.js UI-XR or the isolated GLB harness. Native resolution. Head/mouth framing so the mouth occupies ≥40 px.

Control: station reply with S1 off (text-dwell). Treatment: same reply with `audioEvents` present. Grade mouth motion vs control, not vs a clinician.

Do not grade from `?openclinxrSpeakFixture=1` as if it were the learner default.

## Collision / bake slot

S1 write roots `apps/ui-xr/src` + `xr-dialogue` — disjoint from Blender. S2 is dark-factory + lip_sync station; one baker at a time. S3 after S1. Do not take the materialize bake slot for this vertical.

## Direction / prior art / size

- Direction: D9 dark factory; D14 lip-sync unlocked as factory station; `runtime-dialogue-voice-affect-direction-2026-09-02.md` live vs unary clocks.
- Prior art: `runLipSync`, visemes02 `#432`, `#722` baked-cue join, `#463` case-variant resolver, Rhubarb licence row-02.
- Collision: emotion R2/R1 landed; E5 execution join landed; do not reopen those headers.
- Size: three serial slices, one visible live mouth, then baker audio source, then replay recache. Not five micro-cards.
