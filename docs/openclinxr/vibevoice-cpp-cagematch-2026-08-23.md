# Cagematch — vibevoice.cpp as the local voice engine behind `@openclinxr/voice-gateway`

Date: 2026-08-23
Question: can `https://github.com/mudler/vibevoice.cpp` (published also as `localai-org/vibevoice.cpp`)
serve as the local TTS/ASR engine behind the existing `local-vibevoice` provider adapter, replacing the
Python VibeVoice path that MADR 0023 approved for spike use?

Scope: Capability Arena + gateway adapter only. This document proposes **no production integration**
and clears no runtime, learner, Quest, clinical, or scoring gate.

---

## VERDICT — gate by gate, because they did not all resolve

| gate | verdict | basis |
|---|---|---|
| **Licence — engine** | **PASS** | measured: `LICENSE` read, MIT, plus dependency audit |
| **Licence — weights** | **PASS** | measured: HF API, `license: mit` / `apache-2.0`, ungated |
| **Builds on this machine** | **PASS** | measured: configure exit 0, build exit 0, binaries run |
| **Real-time factor < 1.0** | **NOT MEASURED** | no weights downloaded (see §5) — this is the whole product question |
| **Streaming to the gateway contract** | **PARTIAL** | streaming C API exists; codec/rate mismatch is real (§3b) |

**One sentence:** vibevoice.cpp is licence-clean end to end, and unlike the sibling `kimodo.cpp`
cagematch it **configures, builds and runs on this Apple Silicon machine with Metal enabled** — so it
is a legitimate candidate to advance, but the single measurement that would justify adopting it
(real-time factor against the recorded Python baseline of **5.24**) has not been taken, because taking
it requires a ~1.7 GB weight download that was outside my instruction.

This is **not** `adopt` — there is no latency evidence. It is **not** `reject_measured` — nothing
failed. The honest label is **`advance_pending_benchmark`**: two hard gates that usually kill
candidates have been cleared by measurement, and the decisive one is one download away.

---

## 1. Why this is worth the cycle: the adapter slot already exists and is blocked on exactly this

The repo is further along than a fresh candidate assessment would assume. All of the following are
already in the tree:

- `packages/openclinxr/voice-gateway/src/adapters.ts:171` — `createVibeVoiceProviderAdapter()`,
  provider id **`local-vibevoice`**, returning a `LocalVoiceProviderAdapter` whose `transcribe()` and
  `synthesize()` **throw** and whose `health()` reports `status: "blocked"`.
- The blocker list that adapter computes (`adapters.ts:204-224`) names, verbatim:
  - **`real_time_factor_above_1`** — emitted when `realTimeFactor === null || > 1`
  - **`runtime_file_generation_only`** — emitted when a caveat mentions "file-based" / "file generation"
  - `real_local_voice_stream_benchmark_missing`, `webxr_playback_not_observed`

Those first two blockers are **precisely** what a C++/ggml port addresses. The Python path generates a
file and is 5× slower than realtime; the C++ port exposes a per-window PCM streaming callback. The slot
is not merely available — it is stubbed with a blocker list that reads like this candidate's
specification.

### The recorded Python baseline, recovered from git history

`docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json` is **absent from the working tree
today** — deleted in `fe58d657` ("new-owner efficiency overhaul"). `local-voice-runtime-benchmark.ts:207`
still globs for `docs/openclinxr/local-voice-runtime-benchmark-*.json`, so
`pnpm local:voice:runtime:validate` has no artifact to validate against in the current tree. Recovered
from `fe58d657^`:

| metric | Python `microsoft/VibeVoice-Realtime-0.5B` on `mps` |
|---|---|
| **realTimeFactor** | **5.24** |
| approx first-speech latency | **9,000 ms** |
| wall clock | 118,920 ms for **3,467 ms** of audio |
| peak memory footprint | 9,178,091,624 B (~9.18 GB) |
| status | `passed_with_caveats` |

Against the cagematch spec's own UX target — *"partials < ~500 ms ideal; final after end-of-utterance
< ~1.0–1.5 s"* (`cagematch-spec-local-stt-and-quest-transport-2026-08-05.md`) — a 9 s first-speech
latency is not a usable conversational path. **That is the gap a native port has to close, and it is
the number the next slice must produce.**

**Recording the artifact absence as its own finding:** the baseline above is real and was measured, but
an agent reading only the working tree would find no voice runtime evidence at all and could reasonably
conclude none exists. Not yet evidenced *in tree*; present in history.

---

## 2. Licence — clean, and measured file by file

Per the standing rule in this repo, licences were read from the files themselves, never from a badge,
a filename, or a pack page.

### 2a. Engine

Clone of `000e37282bc5bb09edc20f7047a47924122ba3a0` (`git clone --depth 1`, 2026-08-23, 1.5 MB):

```
$ find . -iname 'LICENS*' -o -iname 'COPYING*' -o -iname 'NOTICE*'
./LICENSE
```

`LICENSE` is a 21-line MIT text: *"MIT License / Copyright (c) 2026 Ettore Di Giacinto"*. GitHub's API
independently reports `license: MIT` for both `mudler/vibevoice.cpp` and `localai-org/vibevoice.cpp` —
same 121 stars, same `pushed_at`, neither flagged a fork, so these are one repository under two org
paths, not a fork whose licence could have diverged.

**This is worth stating explicitly because the same organisation shipped `kimodo.cpp` with no licence
file at all**, assessed and refused earlier today
(`docs/openclinxr/kimodo-cpp-cagematch-2026-08-23.md`). The org's licence hygiene is **not** uniform,
and the per-repo check is what separates these two outcomes. Do not generalise from either.

### 2b. Dependencies

| dependency | licence | basis |
|---|---|---|
| `third_party/ggml` (submodule, `8be60f83`) | **MIT** — *"Copyright (c) 2023-2026 The ggml authors"* | read `third_party/ggml/LICENSE` |
| `third_party/dr_wav.h` | **public domain or MIT-0** (dual, author's choice) | read header line 2 |

No Vulkan, no CUDA-only path, no GPL anywhere in the tree.

### 2c. Weights — checked separately from the engine, as required

| artifact | licence | gated | size |
|---|---|---|---|
| `mudler/vibevoice.cpp-models` (the quantized GGUFs) | **MIT** | no | 26.04 GB total, 8 files |
| `microsoft/VibeVoice-Realtime-0.5B` (upstream TTS) | **MIT** | no | ~1.9 GB |
| `Qwen/Qwen2.5-0.5B` (tokenizer source) | **Apache-2.0** | no | tokenizer only |

Queried via the HuggingFace API `cardData.license`, not scraped from a model page.

**MIT engine + MIT weights holds here** — this is the case MADR 0023 anticipated when it wrote
"license and model-card review" as gate one, and it passes. Note this is a materially better position
than the generative-3D tools in the README licence table: no revenue tripwire, no territory clause, no
copyleft, no gate to accept.

### 2d. Where the misuse surface actually sits — smaller than MADR 0023 assumed, on the approved model

MADR 0023 requires a "misuse and impersonation review" and the spike doc bans real-patient voice
cloning. Measured against the code:

- `include/vibevoice_capi.h:120` marks `vv_capi_voice_clone` **deprecated**, with the reason:
  *"voice-cloning via the realtime-0.5B + ASR-7B path is not supported; the public realtime weights
  ship without encoders."*
- The CLI confirms the split: `--voice <path>` takes a **pre-baked** voice gguf and is documented
  "use with realtime-0.5B models"; `--ref-audio <path>` performs *"runtime voice cloning"* and is
  documented "Use with VibeVoice-1.5B models". The two flags are mutually exclusive.

**So on `VibeVoice-Realtime-0.5B` — the exact model MADR 0023's install record approved — arbitrary
runtime cloning from a reference WAV is not available.** Cloning requires deliberately loading a
different (1.5B) model. That is a meaningful safety property and it is enforced by which weights are
present, which is an easy thing to gate on.

It is **not** zero surface. `scripts/convert_voice_to_gguf.py` bakes a voice gguf from a VibeVoice
voice cache, and the published presets (`voice-en-Carter_man.gguf`, `voice-en-Emma.gguf`) have
**provenance I did not establish** — I did not determine who those speakers are or under what consent
their voices were captured. The MIT tag covers the file's distribution terms; it does not tell you
whether the speaker consented. **Not yet evidenced.** Disclosure UX and the identity policy from
MADR 0023 remain required regardless, and synthetic-speech disclosure is unaffected by any of this.

---

## 3. Structural fit

### 3a. Does a native C++/ggml sidecar fit the existing Arena pattern? — Yes, with direct precedent

`apps/arena/README.md` defines the pattern: a runnable proving-ground app that is not a production
runtime root, linking back to the MADRs it informs, with promotion requiring an explicit adapter
contract. Two existing arena apps are already voice-shaped:

- `apps/arena/mock-realtime-voice-server` — Node + Hono + `ws`, owns the transport harness
- `apps/arena/api-python-backend` — FastAPI, `WS /voice/realtime/ws`, currently reports
  `transport-echo` as the only ready mode

And the STT cagematch spec already reasoned to exactly this shape for a C++ engine, in its whisper.cpp
entry: *"C API + CLI server + stream example → **sidecar process** (HTTP/WS)... production path is
usually **separate binary + WS**."* A vibevoice.cpp sidecar is the same shape as the candidate that
spec ranked top for host-side STT.

**Build reality on this machine — measured, not assumed:**

```
cmake -B build -DCMAKE_BUILD_TYPE=Release -DVIBEVOICE_BUILD_TESTS=OFF   # exit 0
cmake --build build -j8                                                 # exit 0
```

Configure enabled `Accelerate`, `BLAS` and — importantly — **`Including METAL backend`**. Zero
`error:` or `ld:` lines in the build log. Both binaries exist and execute:

```
build/bin/vibevoice-cli       427,136 B   ./vibevoice-cli --help → exit 0
build/bin/vibevoice-quantize  130,544 B
```

This is the sharpest contrast with `kimodo.cpp`, which failed to link because it called Vulkan entry
points unconditionally. vibevoice.cpp has a first-class Metal path via ggml and needed no patching, no
Nix, and no flags beyond the two above.

### 3b. Is there already a voice-engine slot behind the gateway? — Yes, and here is the exact seam

`VoiceProviderAdapter` (`packages/openclinxr/voice-gateway/src/types.ts:164`) requires:

- `transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent>`
- `synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent>`

vibevoice.cpp can supply both, and the streaming half is real rather than simulated:

| gateway need | vibevoice.cpp offering | fit |
|---|---|---|
| `synthesize` → `AsyncIterable<AudioEvent>` | `vv_capi_tts_stream` (`include/vibevoice_capi.h:89`) — per-window PCM callback `vv_pcm_cb` | **good** — genuine incremental output, not file-then-chunk |
| `transcribe` → `AsyncIterable<TranscriptEvent>` | `vv_capi_asr` (`:109`) — **whole-WAV → JSON**, returns `[{"Start","End","Speaker","Content"}]` | **poor for realtime** — batch, file-in, no partials |

The ASR side deserves a plain warning: it is a **file-in / JSON-out batch call with no streaming
counterpart**, and its weights are the 26 GB repo's bulk (`vibevoice-asr-q8_0.gguf` **13.9 GB**,
`q4_k` **10.4 GB**). Against whisper.cpp — MIT code, MIT weights, models three orders of magnitude
smaller, and already ranked *"top-tier cagematch contender for host-side STT on Apple Silicon"* by the
existing spec — **vibevoice.cpp should not be pitched as the STT candidate.** Its diarization output
(`Speaker` field) is genuinely interesting for multi-actor stations later, but that is a separate
question from realtime learner transcription.

**The concrete transport gap, and it is arithmetic rather than opinion.** `realtimeVoiceProtocol`
(`types.ts:30-53`) declares:

```
codec:        "opus"
sampleRateHz: 48_000
```

`vv_capi_tts_stream` emits **24 kHz mono signed-16-bit PCM** (documented at `vibevoice_capi.h:74`,
confirmed at `src/vibevoice_capi.cpp:185` and `src/vibevoice_tts.cpp:90`). So a sidecar must
**resample 24 kHz → 48 kHz and Opus-encode** before frames satisfy the declared contract. That is
ordinary work, but it is unbuilt, it costs latency inside a budget measured in hundreds of
milliseconds, and it must be counted in any RTF claim rather than measured around.

One more seam detail: `RealtimeVoiceGatewayPosture.backends.inferenceCandidates`
(`types.ts:97-101`) is a **closed union of `"moshi-mlx" | "qwen3-tts"`**. Registering a third engine
means widening that type — a small, deliberate, reviewable change, and worth naming so it is not
discovered mid-slice.

### 3c. Correct directory for the spike

**`apps/arena/vibevoice-cpp-sidecar/`** — a runnable sidecar wrapping the built binary or the shared
library behind the existing `/voice/realtime/ws` path.

Reasoning from the tree, not preference: `apps/arena/*` holds *runnable* proving grounds
(`mock-realtime-voice-server`, `api-python-backend`), while `packages/openclinxr/arena/*` holds
*libraries* (`iwsdk-spike`, `physics-touch-contract`, `multi-actor-state-spike`). A process that owns a
socket and a native binary is an app. If a typed contract emerges worth sharing with the gateway, that
part belongs in `packages/openclinxr/arena/`.

**The engine itself must stay out of the repo** — no vendored source, no committed binaries, no
committed GGUFs. That follows the established local-install pattern in the MADR 0023 spike record
(`~/.cache/openclinxr/vibevoice`, private env file, uninstall command recorded) and the repo's standing
posture that generated audio and model weights are never committed.

### 3d. Which existing validation should be reused or extended

Reuse rather than invent — all of these exist and are wired into `pnpm agent:verify`:

| script | role for this candidate |
|---|---|
| `pnpm local:voice:runtime` / `:validate` | the RTF/first-audio benchmark. **Needs extension, see the trap below** |
| `pnpm local:voice:live-dialog` / `:validate` | the live-dialog gate that `real_local_voice_stream_benchmark_missing` refers to |
| `pnpm local:runtime:probe` | MADR 0023 gate 1: runtime visible to the probe |
| `pnpm local:provider:benchmark` | records provider readiness with no cloud calls |
| `pnpm local:voice:realtime-spike` / `:validate` | transport spike over `realtimeVoiceProtocol` |
| `pnpm local:voice:model-source-currentness` | upstream currency tracking, already voice-aware |

**Trap worth naming before anyone dispatches this slice:** `local-voice-runtime-benchmark.ts` is
**hard-pinned to the Python path**. It calls `requireLiteral` on
`"/Users/patrick/.local/bin/vibevoice realtime-file"` (`:387`) and on the venv path (`:395`), and
parses its metrics out of that wrapper's stdout format (`RTF (Real Time Factor): N.NNx`, line 246).
A C++ candidate cannot be measured by this script as written — it will fail literal validation, not
produce a wrong number. Either the validator gains a runtime-kind discriminator, or the candidate gets
a sibling script. **Deciding which is a real design choice and belongs in the brief, not in the slice.**

### 3e. What must remain behind promotion gates

Unchanged by anything measured here. MADR 0023's gates stand, and the following stay `false`:

- **Latency** — no RTF, no first-audio, no p50/p95 for this engine. The Python baseline (5.24) is *not*
  evidence about the C++ port in either direction.
- **Streaming through the real transport** — `vv_capi_tts_stream` proven to exist by reading the
  header, never executed; no audio has traversed `/voice/realtime/ws` from this engine.
- **Quest / WebXR** — untouched. The cagematch spec's BOTTOM LINE stands: whether Quest 3 Browser can
  capture usable mic audio inside an active immersive session is the dominant risk, and **a TTS engine
  does not address it at all.**
- **Clinical quality** — no medical-phrase pronunciation review, which is an explicit MADR 0023 gate.
- **Disclosure, consent, retention** — synthetic-voice disclosure UX required regardless of licence;
  voice-preset speaker provenance unestablished (§2d).
- **Production / learner assessment** — `productionUseAllowed: false` stays false.

---

## 4. Recommendation

**Advance to a bounded Arena benchmark; do not integrate.** Concretely, and in this order:

1. **Download the TTS-only weight set — 1.71 GB, not 26 GB.** The ASR models are 24 GB of the total and
   are not needed to answer the product question:
   `vibevoice-realtime-0.5B-q8_0.gguf` (1,699.8 MB) + `tokenizer.gguf` (5.9 MB) +
   `voice-en-Carter_man.gguf` (8.5 MB). All MIT, all ungated. **This is the one gate I could not clear
   and it is the one that decides the candidate.**
2. **Measure RTF and first-audio latency** against the recorded Python baseline of **5.24 / 9,000 ms**,
   on the same machine class, with the same prompt text if it can be recovered from `fe58d657^`.
   An RTF below 1.0 clears `real_time_factor_above_1`; a streaming callback observed clears
   `runtime_file_generation_only`. Below ~1.0 this is a real candidate; above it, it is not, and that
   is a clean `reject_measured`.
3. **Count the resample + Opus encode in that number**, since the declared contract is 48 kHz Opus and
   the engine emits 24 kHz PCM (§3b).
4. Only then decide the sidecar, and only then consider a MADR 0023 successor.

**Do not open a new MADR yet.** MADR 0023 already governs VibeVoice and its gates are the right ones;
this document is the cagematch stage feeding them, per the pipeline the STT spec states explicitly
(*concept → cagematch → MADR → configurable package → test in app*). A successor MADR is warranted only
if step 2 produces a passing number.

**FLAGGED FOR THE LEAD — licence-ledger rows I did not write** (another lane owns
`docs/openclinxr/third-party-asset-licence-ledger.md`; stating them here rather than editing it):

| candidate | finding | bar |
|---|---|---|
| `mudler/vibevoice.cpp` (= `localai-org/vibevoice.cpp`) — engine | **MIT**, `LICENSE` read at `000e3728`; ggml MIT; dr_wav PD/MIT-0 | **ACCEPT** |
| `mudler/vibevoice.cpp-models` — GGUF weights | **MIT**, ungated, HF API `cardData.license` | **ACCEPT** |
| `microsoft/VibeVoice-Realtime-0.5B` — upstream TTS | **MIT**, ungated | **ACCEPT** |
| `Qwen/Qwen2.5-0.5B` — tokenizer source | **Apache-2.0**, ungated | **ACCEPT** |
| voice presets `voice-en-Carter_man` / `voice-en-Emma` | file licence MIT; **speaker consent/provenance unestablished** | **ACCEPT file, FLAG provenance** |

---

## 5. What I did NOT test — stated explicitly

- **No inference. No audio was generated or transcribed.** **No weights were downloaded** — the full
  model repo is 26.04 GB and the TTS-only subset 1.71 GB; downloading was outside my instruction. Every
  latency, quality and streaming-behaviour statement here is read from headers, the CLI's own help
  output, and the CMake graph — **not** from a running model.
- **No real-time factor for vibevoice.cpp.** The 5.24 figure is the **Python** implementation, recovered
  from git history. It is context, not a measurement of this port, and must not be quoted as one.
- **No audio was pixel- or ear-graded.** No opinion is offered on whether this engine sounds like a
  plausible standardized patient, or how it pronounces clinical terminology.
- **No sidecar was written, and no frame crossed `/voice/realtime/ws`.** The transport fit in §3b is
  reasoned from the declared protocol constant and the C API header, not exercised.
- **`VIBEVOICE_BUILD_TESTS=OFF`.** The repo's own test suite was not run; the tests appear to need
  weights. Build success means it compiles and links and the CLI starts — not that inference is correct.
- **No ASR evaluation.** `vv_capi_asr` was read, never called. The 13.9 GB weight figure is from the HF
  API, and no accuracy or M-WER claim is made.
- **Voice-preset speaker provenance was not established** (§2d), and no consent or retention review was
  performed.
- **Quest, WebXR, and microphone capture were not touched.**
- **`microsoft/VibeVoice` upstream currency was not re-checked** beyond confirming the repo is live
  (53,139 stars, not archived). Note the port's last push is `2026-07-09` — roughly six weeks stale as
  of today; whether it tracks upstream changes since is **not yet evidenced**.

## 6. Reproduction

```sh
git clone --depth 1 https://github.com/localai-org/vibevoice.cpp   # 1.5 MB, HEAD 000e3728
cd vibevoice.cpp && git submodule update --init --recursive --depth 1   # ggml, 22 MB
cmake -B build -DCMAKE_BUILD_TYPE=Release -DVIBEVOICE_BUILD_TESTS=OFF   # exit 0, METAL backend
cmake --build build -j8                                                 # exit 0
./build/bin/vibevoice-cli --help                                        # exit 0
```

Working tree was `/tmp/vibevoice-cage` (outside the repo). Nothing was installed on this machine, no
weights were downloaded, and no repo file outside this document was modified.

---

`claimScope`: the licence status of `mudler/vibevoice.cpp` and its three weight sources as published on
2026-08-23; the CMake configure and build outcome for commit `000e3728` on one macOS arm64 (M1 Max)
machine; the existence and documented signatures of `vv_capi_tts_stream` and `vv_capi_asr`; the
declared codec and sample rate in `realtimeVoiceProtocol`; the presence of a stubbed `local-vibevoice`
adapter and its blocker list; and the Python VibeVoice benchmark figures recorded in
`local-voice-runtime-benchmark-2026-05-04.json` as of commit `fe58d657^`.

`notEvidenceFor`: the real-time factor, first-audio latency, memory footprint, audio quality, clinical
pronunciation accuracy, or ASR accuracy of vibevoice.cpp (never executed against weights); its
behaviour over the realtime WebSocket transport (never wired); Quest, WebXR, or microphone-capture
readiness (untouched); the consent or provenance of the published voice presets; production, learner,
scoring, or clinical fitness of any kind; and any claim that this candidate should be adopted.
