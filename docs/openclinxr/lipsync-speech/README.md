# lip_sync build-time speech (lipsync-speech slice, 2026-10-04)

The dark-factory lip_sync station baked visemes from a WAV nobody produced:
all 15 cases failed with "lip_sync needs wavPath". This directory holds the
fix's evidence. Production path needs no LLM and no cloud voice at exam time.

## Speech source

Kokoro-82M (hexgrad), offline at build time. Code and weights Apache-2.0
(licence evidence in `../third-party-asset-licence-ledger.md`, 2026-10-04
section). Tooling lives under `~/.openclinxr-tools/kokoro/` (venv + HF weight
cache); no weights are committed. Piper (GPL-3.0 engine) and Coqui XTTS (CPML
non-commercial) were checked and refused.

## Voice mapping rule (from case data)

`voiceIdForActor` in
`packages/openclinxr/factory-stations/src/lip_sync/speech-synth.ts`:

1. child indicators (phenotype `gender_presentation` "child", or tokens
   maya/noah/kid/child/peds) -> `af_heart` (Kokoro ships no child voice; the
   female voice sits closer to a child's range than the male voice);
2. female indicators (phenotype "female", or name tokens) -> `af_heart`;
3. male indicators (phenotype "male", or name tokens) -> `am_adam`;
4. ambiguous/unknown (e.g. `patient_jordan_reed_v1`) -> `af_heart` (default).

Matching is on whole words, so "female" never misfires on "male".

## Cache and determinism

`speechCacheKey` = sha256(model revision | voice | text). First write wins;
`<key>.wav` + `<key>.provenance.json` (tool, version, voice, licence, model
revision, text, wav sha256) live in the shared cache, never in the repo.

Measured 2026-10-04: unseeded Kokoro sampling is NOT byte-identical across
runs (two runs of the peds-asthma line differed), but the rhubarb viseme JSON
was identical (17 cues, same shapes and times). The factory seeds
(torch + numpy + random = 0), and seeded runs ARE byte-identical, so the cache
key makes the factory reproducible either way.

## Files

- `per-case.json`: all 15 cases — line text, voice, wav sha, viseme cue count,
  classification. Regenerate without the full --all chain:
  `pnpm exec tsx tools/openclinxr/dark-factory/run-lipsync-speech-cases.ts`.
- `samples/`: three short (<200 KB) WAVs with their viseme JSON for listening.

## Not tested

Whether Kokoro prosody fits anxious/painful affect (e.g. sepsis shivering,
stroke dysarthria). The bake needs intelligible phoneme timing, not acting;
affect is out of scope for this slice.
