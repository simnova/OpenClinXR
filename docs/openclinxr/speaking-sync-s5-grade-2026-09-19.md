# S5 mock duration envelope mouth grade — 2026-09-19

EVIDENCE, not a verdict. Orchestrator grades.

## Renderer / subject / capture flags

- Renderer: three.js UI-XR isolated subject lab (`apps/ui-xr/isolated-subject.html` →
  `bootIsolatedSubjectLab`), NOT the scenario runtime, NOT a schematic.
- Subject: `parent_tara_johnson_v1`, GLB
  `mpfb-peds-parent-aisha.motion-bind.glb`
  (sha256 `b8801c637f5fd43bd3c51f140782b4c40da5d27e9eb93a56534cde9b9c7e2ec7`
  per `tools/openclinxr/evidence/speaking-parent-still-pair.json`),
  isolated, `focus: "head"`. Same GLB bytes both frames.
- Instrument: `tools/openclinxr/evidence/speaking-parent-still-pair-probe.ts`
  (`runSpeakingParentStillPairProbe`): lab-derived camera from the head-region AABB of the
  unmorphed bounds; framing records compared to 1 mm before write, so both frames share one
  derived camera by measurement.
- Frame size: 1280x960 native (headless chromium screenshot, `fullPage: false`).

## Control vs treatment

- Control (`docs/assets/speaking-sync-s5-control.png`, 277871 bytes,
  sha256 `ad16a46f…7926269`): lab renders the parent with all morph influences at 0 (rest).
  Stands in for the station reply with S1 off (text-dwell): mouth carries no mouth-open drive.
- Treatment (`docs/assets/speaking-sync-s5-treatment.png`, 278162 bytes,
  sha256 `91fc8fe2…73a9cf5b`): SAME actor, SAME GLB bytes, SAME derived camera, `mouth-open`
  morph (`viseme_AA` jaw-drop target per `morph-target-resolver.ts`) driven to weight 1.0.
  Stands in for the same reply with S5 mock audioEvents present:
  `[{ visemeCue: "neutral-pain", durationMs: 1100 }]` attaches one AA envelope
  `{ phoneme: "AA", atSecond: 0, durationSeconds: 1.1 }` (clause (15) of
  `apps/ui-xr/src/expression-weights-follow-actor-turn-plan.test.ts`, 16/16 green);
  "neutral-pain" never becomes a phoneme; execution gains no visemeTimeline/audioUri (DVA-6).
- Provenance: byte copies of the tracked still pair
  `tools/openclinxr/evidence/stills/speaking-parent-not-speaking.png` /
  `speaking-parent-speaking.png` (artifact `speaking-parent-still-pair.json`,
  schema `openclinxr.speaking-parent-still-pair.v2`).

## Measurement (numpy pixel diff, native resolution)

- Changed pixels (|Δ|>30 summed channels): 9226 of 1228800 (0.75%).
- Diff bbox: x 512–662, y 525–716 → 151 x 192 px, confined to the mouth region.
- Rows with >5 changed px: y 562–715 (154 native rows); mouth-band aperture span 154 px.
- Mouth region at native framing is well above the ≥40 px grade-protocol floor
  (diff bbox height 192 px, aperture span 154 px).
- Face crops (x 380–700, y 300–700, 320x400) inspected visually: control lips closed,
  treatment lips parted with teeth visible. No other region of either frame differs.

## Claim scope

- claimScope: mouth-motion-vs-control still-pair evidence for the S5 mock envelope.
- notEvidenceFor: clinician realism verdict, Quest headset, audible TTS, production learner
  runtime, scoring, clinical validity. Grade is mouth-motion-vs-control only.
- The `mouth-open` stand-in is the orchestrator-sanctioned proxy (isolated lab cannot drive
  runtime speaking state); the artifact says so. No Blender, no rebake, no GLB touched,
  no `apps/ui-xr` or `xr-dialogue` edit in this slice.

## Orchestrator MY GRADE 2026-09-19 16:48 UTC

Native 1280×960 three.js isolated-lab stills, same camera. Control lip bbox height 151 px (closed). Treatment lip bbox height 191 px (open, teeth visible). Mouth region well above the 40 px floor.

This pair is a rest-vs-`mouth-open` 1.0 PROXY, not a live station-reply capture of the S5 attach path. Clause (15) 16/16 covers attach. notEvidenceFor live UI-XR station-reply photography.

## Test gate

- `pnpm exec vitest run apps/ui-xr/src/expression-weights-follow-actor-turn-plan.test.ts`:
  16/16 green (includes clause (15) mock envelope attach).
