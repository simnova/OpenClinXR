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

---

## BENCHMARK RESULT (2026-08-23)

The gate §4 said would decide the candidate has now been run. Weights were downloaded (TTS-only
subset, 1.71 GB) and the engine was executed against a real authored line from the scenario bank.

### VERDICT — `reject_measured`

**vibevoice.cpp beats the recorded Python baseline on every axis measured — RTF 5.24 → 1.43,
first-audio 9,000 ms → 1,122 ms, peak RSS 9.18 GB → 3.55 GB — and still never reaches
real-time factor < 1.0 in any configuration tested, so the adapter's `real_time_factor_above_1`
blocker stands and `health()` must stay `blocked`.**

This is `reject_measured`, not `inconclusive_blocked`: the engine ran, produced intelligible-
amplitude 24 kHz speech audio, and lost on a named constraint. It is also not `adopt`: a 3.7×
improvement over a path that was 5× too slow is still too slow.

| gate | verdict | basis |
|---|---|---|
| **Real-time factor < 1.0** | **FAIL** | measured — best observed 1.071, at a 4× cut in diffusion steps |
| **Beats the 5.24 Python baseline** | **PASS** | measured — 1.43 at defaults, a 3.7× improvement |
| **First-audio latency** | **PASS** | measured — 1,122 ms vs 9,000 ms, an 8.0× improvement |
| **Peak RSS** | **PASS** | measured — 3.55 GB vs 9.18 GB, a 2.6× improvement |
| **Runs on the default (Metal) backend** | **FAIL** | measured — 3/3 runs killed by the macOS GPU watchdog, zero audio |
| **Streaming, not file-generation** | **PASS** | measured — 6 incremental PCM windows per utterance |

### What was measured

| | |
|---|---|
| Machine | Apple M1 Max, 64 GB, macOS 26.5.2 (25F84) |
| Engine | `localai-org/vibevoice.cpp` @ `000e37282bc5bb09edc20f7047a47924122ba3a0` |
| Weights | `vibevoice-realtime-0.5B-q8_0.gguf` (1,699,832,128 B) + `tokenizer.gguf` + `voice-en-Carter_man.gguf` |
| Text | `"It feels heavy, like someone is sitting on my chest."` |
| Text provenance | `packages/openclinxr/scenario-fixtures/src/ed-chest-pain.ts:37` — `ed_chest_pain_priority_v1` / `patient_robert_hayes_v1` / `openingUtterance` |
| Seed | `12345` fixed, so audio duration is identical across runs |
| RTF convention | **synthesis-only**, excluding model load — the same convention the 5.24 baseline used |

Model load is reported separately rather than folded into RTF, because a sidecar loads once and
synthesizes many times. At 0.45–0.50 s it is not the problem either way.

### Runs — Metal backend (the build default; GPU preferred over CPU)

All three fail. `vibevoice_tts_generate` returns `rc=-6`, the CLI exits 4, and **no WAV is written**.

| run | rc | wall | audio produced | RTF | peak RSS |
|---|---|---:|---|---|---:|
| 1 | 4 | 186.6 s | **none** | n/a | 2.195 GB |
| 2 | 4 | 319.9 s | **none** | n/a | 2.195 GB |
| 3 | 4 | 240.9 s | **none** | n/a | 2.193 GB |

The failure is the macOS GPU watchdog killing the acoustic decoder's command buffer:

```
ggml_metal_synchronize: error: command buffer 0 failed with status 5
error: Impacting Interactivity (0000000e:kIOGPUCommandBufferCallbackErrorImpactingInteractivity)
ggml_metal_graph_compute: backend is in error state from a previous command buffer failure
tts: generate failed (rc=-6)
```

The wall-clock spread (186–320 s) is watchdog stall, not compute — the process sits at 0% CPU
blocked on the GPU throughout. Frame generation itself reaches frame 4 in 0.28 s before the first
decoder dispatch hangs. A separate cold-start run also recorded a **10.09 s** one-time Metal shader
library compile; subsequent runs load in ~0.65 s from cache.

**This means the candidate does not work at all on its own default backend on this machine.** Every
number below required `VIBEVOICE_BACKEND=cpu`.

### Runs — CPU backend, default 20 diffusion steps

| run | RTF (synthesis) | first audio | peak RSS | audio | synthesis wall | model load |
|---|---:|---:|---:|---:|---:|---:|
| 1 | **1.432** | 1,122.0 ms | 3.547 GB | 4.133 s | 5.917 s | 0.453 s |
| 2 | **1.442** | 1,148.7 ms | 3.546 GB | 4.133 s | 5.962 s | 0.495 s |
| 3 | **1.425** | 1,104.6 ms | 3.546 GB | 4.133 s | 5.890 s | 0.460 s |
| median | **1.432** | **1,122.0 ms** | **3.546 GB** | | | |

Spread across runs is under 1.2% on RTF and under 4% on first-audio. This is not a one-sample result.

### Against the recorded Python baseline

| metric | Python `VibeVoice-Realtime-0.5B` on `mps` | vibevoice.cpp CPU | change | gate |
|---|---:|---:|---:|---|
| real-time factor | 5.24 | **1.432** | **3.7× faster** | still **> 1.0** — FAIL |
| first-speech latency | ~9,000 ms | **1,122 ms** | **8.0× faster** | PASS |
| peak memory | 9.18 GB | **3.546 GB** | **2.6× smaller** | PASS |
| output mode | file generation | **6 incremental PCM windows** | — | PASS |

Three of four blockers move the right way, decisively. The one that decides adoption does not.

### Why the remaining gap is structural, not a tuning problem

`--steps` (DPM-Solver diffusion steps) is the obvious knob. Swept on CPU, three runs each:

| steps | RTF run 1 | run 2 | run 3 | median | first audio (median) |
|---:|---:|---:|---:|---:|---:|
| 20 (default) | 1.432 | 1.442 | 1.425 | **1.432** | 1,122 ms |
| 10 | 1.222 | 1.229 | 1.198 | **1.222** | 956 ms |
| 5 | 1.076 | 1.071 | 1.097 | **1.076** | 897 ms |

A 4× cut in diffusion steps buys 25% and still lands above 1.0. The reason is visible in the
per-window breakdown: the pipeline emits one PCM window per 6 latent frames = 0.8 s of audio, and
**every steady-state window costs more wall-clock than the audio it contains**, at every setting.

| steps | window 1 | 2 | 3 | 4 | 5 | steady-state ratio |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | 1.122 s | 1.139 s | 1.095 s | 1.106 s | 1.071 s | **1.34 – 1.42** |
| 10 | 0.979 s | 0.943 s | 0.943 s | 0.914 s | 0.925 s | **1.14 – 1.22** |
| 5 | 0.897 s | 0.835 s | 0.864 s | 0.824 s | — | **1.03 – 1.12** |

Splitting a window into its two stages at default steps, the **acoustic decoder alone** accounts for
0.72–0.89 s of each ~1.10 s window:

```
window 1: decode >= 0.749s for 0.800s audio
window 2: decode >= 0.893s for 0.800s audio
window 3: decode >= 0.738s for 0.800s audio
window 4: decode >= 0.894s for 0.800s audio
window 5: decode >= 0.720s for 0.800s audio
```

So the decoder by itself consumes roughly **90–112% of the real-time budget**, and `--steps` does
not touch it — it only reduces the diffusion head layered on top. Even a free diffusion head leaves
this path at the real-time boundary rather than under it. A stream would starve continuously, not
merely at startup, so the good 1,122 ms first-audio number cannot be spent as buffer.

`mudler/vibevoice.cpp-models` publishes exactly one realtime TTS quant (`q8_0`), so there is no
smaller variant to fall back to.

### The audio is real

Checked rather than assumed — a written file is not proof of speech:

| artifact | duration | format | RMS | peak | non-silent 20 ms blocks |
|---|---:|---|---:|---:|---:|
| `steps=20` | 4.13 s | 24 kHz mono s16 | 1525.8 | 12191 | 133 / 206 |
| `steps=10` | 4.13 s | 24 kHz mono s16 | 1467.8 | 11651 | 132 / 206 |
| `steps=5` | 3.87 s | 24 kHz mono s16 | 1288.8 | 14099 | 142 / 193 |

Amplitude and the ~65% voiced fraction are consistent with speech containing pauses. Format matches
the 24 kHz mono s16 documented at `vibevoice_capi.h:74`, confirming §3b's resample-and-Opus-encode
gap is real and would add to every number above.

### What this changes for the adapter — nothing yet, and deliberately so

`packages/openclinxr/voice-gateway/src/adapters.ts` was **not modified**. On this evidence it must
not be:

- **`real_time_factor_above_1`** — emitted when `realTimeFactor === null || > 1`. Measured 1.432.
  The blocker is correct and stays.
- **`runtime_file_generation_only`** — this one *would* clear. Six incremental PCM windows per
  utterance is genuine streaming, not file-then-chunk. But clearing it alone changes nothing while
  the RTF blocker holds.
- Everything in §3e stays `false`. `productionUseAllowed: false` stays false.

### Recommendation

**Do not open the sidecar slice, and do not write a MADR 0023 successor.** §4 made adoption
conditional on RTF < 1.0 and called anything above it "a clean `reject_measured`". That is the
outcome.

Two things are worth keeping rather than discarding, because they are cheap and already paid for:

1. **The measurement itself is the useful artifact.** A candidate that is 3.7× faster, 8× lower
   latency and 2.6× lighter than the approved path, and *still* fails, calibrates how far off the
   whole VibeVoice family is. The gap to close is not 5.24 → 1.0; it is 1.43 → 1.0 against a
   decoder floor of ~0.9–1.1 on its own. That is a different and much better-posed question.
2. **The bottleneck is now named and localised** — `run_decoder_chunk_streaming`
   (`src/vibevoice_tts.cpp:642`), the acoustic VAE decoder, on CPU. Any future re-test should
   measure that function first and stop early if it has not moved.

Re-test triggers, in priority order:

- The Metal decoder path is fixed upstream and completes without tripping the watchdog. GPU
  execution is the only untested lever with plausible order-of-magnitude headroom, and it is
  currently broken rather than slow — those are different failures and this one is not ours to fix.
- A smaller or differently-quantized realtime TTS decoder is published.
- The port's last push (`2026-07-09`) advances materially.

### What I did NOT test — stated explicitly

- **No Metal RTF, because Metal produced no audio.** The 186–320 s figures are watchdog stalls and
  must not be quoted as a real-time factor. Whether GPU execution would be faster than CPU if the
  watchdog issue were fixed is **not yet evidenced** in either direction.
- **No workaround for the Metal watchdog was attempted** — not graph splitting, not
  `GGML_METAL_GRAPH_OPTIMIZE_DISABLE`, not `GGML_METAL_CONCURRENCY_DISABLE`, not a headless session,
  not a smaller window size. Whether any of these recovers the GPU path is unknown.
- **No audio was ear-graded.** RMS, peak and voiced-fraction are amplitude statistics, not quality.
  No opinion is offered on whether this sounds like a plausible standardized patient, and no
  clinical-terminology pronunciation review was performed — an explicit MADR 0023 gate that remains
  open.
- **One utterance, one voice, one speaker.** `voice-en-Carter_man.gguf` only; `voice-en-Emma.gguf`
  untested. No multi-speaker dialog, no `Speaker N:` tagging, no longer or shorter text, no other
  station's lines. RTF may vary with utterance length; this was not characterised.
- **The resample to 48 kHz and the Opus encode required by `realtimeVoiceProtocol` were not built
  or measured.** Every number above therefore *understates* the true cost of satisfying the declared
  gateway contract.
- **No sidecar, no WebSocket.** Nothing crossed `/voice/realtime/ws`. `vv_capi_tts_stream` was read
  and its window behaviour observed through the CLI's batch path, which uses the same
  `run_decoder_chunk_streaming` internals; the C API entry point itself was never called.
- **No ASR.** Unchanged from §5 — the 7B ASR weights (10.4–13.9 GB) were not downloaded.
- **No thread-count sweep.** CPU ran at ggml's auto-detected default on a 10-core M1 Max;
  `n_threads` was not tuned.
- **`local-voice-runtime-benchmark.ts` was not extended.** The §3d trap stands — that script is
  still hard-pinned to the Python path and cannot measure this engine. These numbers come from a
  throwaway harness in `/tmp`, not from a repo validator, so they are **not yet evidenced in tree**
  by `pnpm local:voice:runtime:validate`.
- **Quest, WebXR and microphone capture untouched**, as in §5.

### Reproduction

```sh
# weights — TTS-only subset, 1.71 GB, outside the repo
mkdir -p /tmp/vibevoice-cage/models && cd /tmp/vibevoice-cage/models
for f in tokenizer.gguf voice-en-Carter_man.gguf vibevoice-realtime-0.5B-q8_0.gguf; do
  curl -sSL -o "$f" "https://huggingface.co/mudler/vibevoice.cpp-models/resolve/main/$f"
done

# Metal (default backend) — fails, writes no WAV
./build/bin/vibevoice-cli tts --model models/vibevoice-realtime-0.5B-q8_0.gguf \
  --tokenizer models/tokenizer.gguf --voice models/voice-en-Carter_man.gguf \
  --text "It feels heavy, like someone is sitting on my chest." \
  --out out.wav --seed 12345 --verbose

# CPU — succeeds, RTF 1.43
VIBEVOICE_BACKEND=cpu ./build/bin/vibevoice-cli tts ...same args...
```

RTF is `(timestamp of "tts: generated N samples") - (timestamp of "[tts] N input text tokens")`
divided by the WAV duration. First-audio is the offset of the first `[tts] window 1:` line from the
same synthesis start. Peak RSS is `maximum resident set size` from `/usr/bin/time -l` (bytes on
macOS). Weights stayed in `/tmp`; no repo file outside this document was modified.

---

`claimScope` (this section): the synthesis-only real-time factor, first-audio latency, peak resident
set size, emitted PCM window count and output audio amplitude statistics of
`localai-org/vibevoice.cpp` @ `000e3728` with `vibevoice-realtime-0.5B-q8_0.gguf` and
`voice-en-Carter_man.gguf`, synthesizing one authored patient utterance from
`ed_chest_pain_priority_v1` at seed 12345, on one macOS 26.5.2 Apple M1 Max 64 GB machine, across
three runs at each of 20, 10 and 5 diffusion steps on the CPU backend; and the reproducible failure
of that same configuration on the Metal backend.

`notEvidenceFor` (this section): the audio quality, intelligibility, clinical-terminology
pronunciation, or standardized-patient plausibility of this engine (never listened to); its
performance on the Metal or any GPU backend (never completed a synthesis); its performance on other
voices, other utterances, other utterance lengths, multi-speaker dialog, or other hardware; the cost
of the 24 kHz → 48 kHz resample and Opus encode the gateway contract requires (never built); its
behaviour over `/voice/realtime/ws` (never wired); ASR accuracy (never run); and any claim that this
candidate should be adopted, or that `local-vibevoice`'s `health()` should move off `blocked`.
