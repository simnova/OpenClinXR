<!--
CAGEMATCH SPEC — pipeline stage 2 of: concept -> cagematch -> MADR -> configurable package -> test in app.

This is the PROTOCOL to run, not a decision. It deliberately contains no Decision: the draft MADR at
the end is framing only, with Decision left TBD until the bake-off produces measurements. Do not cite
this document as a decision record.

Produced by delegated deep research (grok-4.5, internet access) 2026-08-05, reviewed by the
orchestrator. Claims are sourced; where evidence was thin the report says so, and the Quest
microphone-in-immersive-WebXR question is carried as an explicit OPEN QUESTION rather than guessed.

notEvidenceFor: no capability here is proven. Nothing in this document clears a runtime, learner,
Quest, production, clinical, or scoring gate.
-->

# OpenClinXR Cagematch Spec: Local STT + Quest Realtime Transport

**Date:** 2026-08-05  
**Scope:** READ-ONLY research for Decision A (local STT) and Decision B (Quest ↔ local runtime transport)  
**In-repo seams (given, not re-derived):** `@openclinxr/voice-gateway` (`VoiceProviderAdapter` + mock/local stubs); `session-state` `transportPosture: "websocket_design_contract_only"` / `runtimeImplemented: false`; arena harness `apps/arena/mock-realtime-voice-server` (Node + Hono + `ws`, Opus-labeled binary frames, protocol in `realtimeVoiceProtocol`).  
**Governing prior MADRs:** 0017 (WebSocket-first), 0019 (provider adapters), 0021 (local-first), 0023 (VibeVoice candidate), 0027 (Quest USB smoke), 0029 (cagematch pattern).

---

## BOTTOM LINE

**Biggest risk:** Whether the **Quest 3 Browser can capture usable learner audio inside an active immersive WebXR session** and deliver it to a local host with acceptable latency and quality. STT model choice is secondary until that path is proven; a perfect M1 Max Whisper pipeline is worthless if the mic is denied, silent, or gated only outside immersion.

**One measurement that most reduces uncertainty:** On a **physical Quest 3**, enter `immersive-vr`, request microphone access **while the XR session is live**, stream audio over the existing `mock-realtime-voice-server` WebSocket path to an **M1 Max** STT sidecar, and record: (1) permission outcome, (2) non-zero PCM energy, (3) end-to-end **utterance-end → `transcript.final`** p50/p95, (4) medical-term correctness on a fixed 20-utterance clinical set. That single experiment falsifies or validates the whole capability in one afternoon.

---

## Product constraints (hard gates for the bake-off)

| Constraint | Implication |
|---|---|
| Local-first; no paid cloud; no PHI off-machine | All STT/TTS inference on the Mac (or optionally on-headset if proven). Model downloads only as explicit pre-bake setup, not in CI. |
| Avoid AGPL / copyleft | Prefer MIT / Apache-2.0 / CC-BY for code **and** weights. Flag dual-license / revenue-capped / NC licenses. |
| Timed station, conversational turns | Target interactive latency (partials < ~500 ms ideal; final after end-of-utterance < ~1.0–1.5 s for UX). Not batch podcast transcription. |
| Clinical terminology | Drug names, anatomy, vitals matter more than “yeah/um.” Prefer **Medical WER (M-WER)** over raw WER when scoring. |
| Existing seams | New STT must implement `VoiceProviderAdapter.transcribe()` → `AsyncIterable<TranscriptEvent>`; transport should preserve `realtimeVoiceProtocol` frames if possible. |

---

# DECISION A — Local speech-to-text

## A1. whisper.cpp (ggml-org)

### 1. License
- **Code:** MIT.
- **Weights:** OpenAI Whisper weights also MIT (code + model weights).
- **AGPL/copyleft:** No.

### 2. Latency
- **M1 Max class:** Strong fit. Metal + Core ML encoder path is first-class; community reports often **several× real-time** for base/small and competitive large-v3-turbo with Metal/CoreML. Official README documents stream example with ~500 ms steps.
- **Caveat:** Many “10× RT on M5 / large-v3” blog numbers are **vendor-adjacent marketing or newer chips** — treat as directional, re-measure on M1 Max 64 GB.
- **Quest 3 on-device:** WASM port exists (`whisper.wasm`) but Quest XR + large models is **not production-proven** for medical conversational STT; expect thermal/latency pain. Prefer host-side inference.

### 3. Accuracy
- Same family as Whisper: LibriSpeech-class WER is strong for general English; **large-v3 ~2.7% on clean LibriSpeech** (backend-independent).
- **Medical:** On PriMock57-style medical dialogue, Whisper-family open runtimes land roughly **~6% M-WER** for Large v3 Turbo on Apple Silicon (MLX Whisper ~6.16%, WhisperKit ~6.35% in Omi’s frozen v4 table) — usable but not cloud-leader.
- **Hallucinations** under silence/noise remain a known Whisper failure mode — bake-off must include silence and partial-utterance cases.

### 4. Integration shape
- C API + CLI server + stream example → **sidecar process** (HTTP/WS) or native add-on.
- Fits `VoiceProviderAdapter` as: Node adapter spawns/connects to whisper-server or pipes PCM; yields `partial_transcript` / `final_transcript`.
- Streaming is **chunked re-decode**, not true incremental encoder state like Moonshine’s streaming models.
- **Node bindings** exist (community); production path is usually **separate binary + WS**.

### 5. Quest / WebXR
- Does not solve mic capture. Inference should stay on Mac unless WASM path is deliberately tested.

### 6. Maturity
- **Production-grade, very active** (ggml-org; stable releases e.g. v1.9.x cited in README). Industry default for local Whisper.

**Verdict for OpenClinXR:** Top-tier cagematch contender for **host-side** STT on Apple Silicon. Best default integration: **sidecar**, not in-browser.

---

## A2. faster-whisper (CTranslate2)

### 1. License
- **Code:** MIT (SYSTRAN).
- **Weights:** Converted Whisper / Distil-Whisper (MIT lineage for OpenAI Whisper; check per HF card for fine-tunes).
- **AGPL:** No.

### 2. Latency
- **GPU (NVIDIA):** Often **~4× openai-whisper** at same accuracy; excellent for CUDA servers.
- **Apple Silicon:** **Weaker than whisper.cpp** — no Metal path; runs CPU (or limited backends). Third-party comparisons often show whisper.cpp winning on M-series.
- **Quest:** Not a headset runtime.

### 3. Accuracy
- Effectively **parity with Whisper** at same model size (CTranslate2 path does not change WER materially).
- Medical: same as Whisper family unless you load a medical fine-tune.

### 4. Integration shape
- **Python-first** library → natural fit for existing `apps/arena/api-python-backend` posture already referenced in voice-gateway types (`python-fastapi-compatible-websocket`).
- Streaming via community stacks (WhisperLive, whisper_streaming) — not first-class as Moonshine.
- Adapter: Python STT service behind the existing WS proxy; TypeScript `VoiceProviderAdapter` remains thin.

### 5. Quest / WebXR
- Host-only.

### 6. Maturity
- **Production-grade** on NVIDIA; large ecosystem. On M1 Max it is a **second-choice runtime** unless the team standardizes on Python and accepts CPU latency.

**Verdict:** Keep in cagematch for **accuracy parity baseline** and Python adapter path; **do not expect it to win latency on M1 Max**.

---

## A3. Moonshine (Moonshine AI / Useful Sensors)

### 1. License — **read carefully**
- **Code:** MIT.
- **English STT model weights:** MIT.
- **Non-English models:** **Moonshine Community License** — research/non-commercial free; commercial allowed under **$1M annual revenue** then requires enterprise; attribution (“Powered by Moonshine AI”) required for distribution. **Not AGPL, but not pure permissive for all languages.**
- For OpenClinXR English-first stations: English MIT path is OK; multilingual expansion needs legal review.

### 2. Latency
- **Designed for live speech.** Vendor table (streaming models): Medium Streaming ~**107 ms** on MacBook Pro vs Whisper Large v3 ~**11 s** on their measurement harness for comparable short-window work — **vendor-supplied; methodology in their README/benchmarks section**.
- Architecture claims: no fixed 30 s pad, caching for incremental audio — addresses Whisper’s live-UX weaknesses.
- **Quest on-device:** WASM + mobile packages exist; whether Quest Browser can run it well is **unproven**. Host-side Python/C++ is the safe path.

### 3. Accuracy
- Vendor claims Medium Streaming **WER 6.65%** vs Whisper Large v3 **7.44%** on their suite; also claim OpenASR leaderboard competitiveness.
- **Medical-domain WER: UNKNOWN** (not on Omi PriMock57 open leaderboard snapshot reviewed). **Flag as open bake-off item.**

### 4. Integration shape
- High-level **event API** (line started/updated/completed) maps cleanly to `partial_transcript` / `final_transcript`.
- Python package + C++ core + ONNX Runtime → **sidecar** or embed via native addon.
- Strong fit for conversational stations (VAD + streaming built-in).

### 5. Quest / WebXR
- Host inference preferred. On-headset Moonshine is a stretch goal, not gate.

### 6. Maturity
- Rapidly evolving productized toolkit (STT+TTS+dialog). Younger than whisper.cpp but **actively maintained** for voice agents. Treat streaming numbers as **measure yourself**.

**Verdict:** **Primary latency contender** for live dialogue. Must pass medical-term accuracy and English-license confirmation before promotion.

---

## A4. Vosk

### 1. License
- **API:** Apache-2.0.
- **Models:** Per-model; classic models generally Apache-friendly commercial use — **verify each model card** before shipping.
- **AGPL:** No for the API.

### 2. Latency
- True **streaming** Kaldi decoder; “zero-latency” partials on modest CPU (Pi-class).
- On M1 Max, latency is excellent; accuracy is the bottleneck.

### 3. Accuracy
- Trails modern end-to-end transformers on open English benchmarks in post-Whisper era.
- **Strength:** vocabulary adaptation / grammar constraints (could bias clinical lexicon).
- **Medical WER: largely unknown / expected weak** without domain LM adaptation — bake-off must include drug names.

### 4. Integration shape
- Python, Node, Java, C# bindings; **Node binding is rare among offline STT** → could keep STT inside Node process without Python sidecar.
- Streaming API → natural partials for `VoiceProviderAdapter`.

### 5. Quest / WebXR
- Host-side. Mobile models exist but not the Quest Browser path.

### 6. Maturity
- Mature, battle-tested offline toolkit; **PyPI last major release era is older** relative to Whisper stack (API still used in production IoT). Community slower than Whisper/Moonshine.

**Verdict:** Good **streaming baseline** and Node-native option; likely **lose accuracy** on open medical dialogue unless heavily adapted. Include for latency floor and binding shape, not as expected winner.

---

## A5. Silero

### Clarification (important)
People say “Silero STT” but today’s healthy Silero surface is primarily:

1. **Silero VAD** — MIT, production, ubiquitous endpointing companion.  
2. **Silero TTS / models hub** — mixed licenses (**CC-BY-NC** appears on main silero-models badge; CIS models sometimes MIT). **NC is a commercial blocker.**  
3. **Historical Silero STT** via torch.hub — still documented on PyTorch Hub but **not the modern SOTA path** for English medical dialogue.

### 1. License
- **VAD:** MIT.  
- **STT (legacy):** verify per weights; do not assume MIT.  
- **TTS weights:** often **CC-BY-NC** → **not OK** if product is commercial without separate license.

### 2. Latency
- VAD: **&lt;1 ms / 30 ms chunk** on one CPU thread — ideal front-end for any STT.
- Full Silero STT: light CPU, but accuracy outdated vs Whisper/Moonshine/Parakeet.

### 3. Accuracy
- VAD is not WER.  
- Silero STT English: **not competitive** with 2024–2026 transformer ASR on medical dialogue (no recent PriMock leadership).

### 4. Integration shape
- **Use Silero VAD as a seedwork component** in front of whisper.cpp / Moonshine / Parakeet (faster-whisper already embeds Silero VAD).
- Do **not** treat Silero as the primary STT adapter candidate unless bake-off proves otherwise.

### 5–6. Quest / Maturity
- VAD: production-grade. STT: legacy. Quest: host-side.

**Verdict:** **Include Silero VAD as mandatory infrastructure**, not as Decision A winner. Full Silero STT is a **weak primary candidate**.

---

## A6. WebGPU / transformers.js (in-browser Whisper)

### 1. License
- Transformers.js / Xenova demos: typically Apache-2.0 for library; Whisper ONNX weights inherit Whisper MIT.  
- **AGPL:** No for the common stack.

### 2. Latency
- Desktop Chrome + WebGPU can approach interactive for **tiny/base** models; demos exist for realtime Whisper-base.
- **Quest 3 Browser:** WebGPU support and performance for transformer ASR is **OPEN QUESTION**. XR + GPU contention with WebGL/WebGPU scene is high risk. Thermal throttling likely.

### 3. Accuracy
- Browser deployments usually ship **tiny/base/small** → higher WER; medical terms suffer first.  
- Large-v3 in-browser on Quest is unrealistic for station pacing.

### 4. Integration shape
- Runs **in the headset browser** → no audio leave device (good for privacy narrative) but breaks the current **host adapter** composition model and makes faculty review/replay harder unless transcripts are still sent upstream.
- `VoiceProviderAdapter` would become a **browser-local** adapter or dual-path; composition root changes.

### 5. Quest / WebXR — critical
- Needs: secure context (HTTPS/localhost), mic permission, WebGPU availability, and enough GPU budget **while** rendering WebXR.  
- **This is the highest-risk integration**, not the simplest privacy win.

### 6. Maturity
- Exciting demos; **experimental for production XR**. Maintenance via Hugging Face / Xenova ecosystem is good; headset evidence is thin.

**Verdict:** Optional **research spike** only after host-side path works. **Do not** make first production STT depend on in-browser WebGPU.

---

## A7. Additional candidates worth including (found better for this hardware)

### WhisperKit (Argmax) — Apple Silicon host
- **License:** MIT code; Whisper MIT weights.  
- **Latency:** ANE-optimized; research claims ~**0.46 s** streaming latency class in paper benchmarks (not medical-specific).  
- **Medical:** Omi PriMock57: WhisperKit Large v3 Turbo ~**12.28% WER / 6.35% M-WER** on Apple Silicon.  
- **Integration:** Swift-native / local inference server — awkward from Node monorepo unless HTTP sidecar.  
- **Verdict:** Strong **M1 Max accuracy/latency** candidate if team accepts Swift/CoreML sidecar.

### NVIDIA Parakeet TDT (via parakeet-mlx on Mac)
- **Weights:** CC-BY-4.0 (commercial OK with attribution).  
- **Code (NeMo / MLX ports):** typically Apache-2.0 for tooling.  
- **Medical:** Omi: Parakeet TDT 0.6B v2 on Apple Silicon ~**10.75% WER / 6.19% M-WER** but **Drug M-WER weak (~17%)**.  
- **Latency:** Excellent throughput on Apple Silicon (among fastest in that table).  
- **Verdict:** Include in cagematch for **speed**; may need medical fine-tune or lexicon bias for drug names.

### Qwen3-ASR (open, optional)
- Strong open medical M-WER on GPU in Omi table (1.7B ~4.40% M-WER) but **GPU-oriented**; only add if M1 Max path is proven or secondary machine exists. **Out of scope if it forces paid cloud.**

---

# DECISION B — Realtime transport (Quest Browser ↔ local runtime)

**Existing spike shape (survives as baseline):**  
`apps/arena/mock-realtime-voice-server` + `realtimeVoiceProtocol` in `@openclinxr/voice-gateway`:
- Path `/voice/realtime/ws`
- Codec label **`opus`**, 48 kHz
- Control frames: `voice.start|stop|audio_metadata`
- Server events: `backend.ready`, `transcript.partial|final`, `audio.chunk`, latency fields `clientSentAtMs` / `backendObservedAtMs`
- Node + Hono + `ws`; optional Python backend proxy  
MADR **0017** already chose **WebSocket-first**, WebTransport as later spike.

---

## B1. Raw WebSocket + Opus (existing design)

### 1. License
- WebSocket is a standard; `ws` is MIT. Opus (libopus) is BSD-style. **No copyleft issue.**

### 2. Latency
- LAN USB-tethered or same-WiFi: typically **tens of ms** transport RTT; total latency dominated by STT, not WS.
- Binary frames already proven in arena harness (echo + latency budget checks in package tests).
- **Not optimal** for lossy Wi-Fi (no built-in media congestion control).

### 3. Accuracy
- N/A for transport; Opus at 16–24 kbps mono is fine for STT if packet loss is low. Packet loss → STT errors.

### 4. Integration shape
- **Best fit for current seams.** Keeps `session-state` design contract evolvable to `runtimeImplemented: true` without redesign.
- Client: capture mic → encode Opus (WASM opus / WebCodecs if available) → binary WS.
- Server: decode → STT adapter → JSON transcript events + binary TTS audio back.

### 5. Quest / WebXR
- WebSocket is **universally supported**.  
- Secure context required for mic (`https` or localhost via adb port-forward per MADR 0027).  
- **OPEN:** mic + WS both while immersive session active.

### 6. Maturity
- Boring, production-proven. Matches MADR 0017.

**Verdict:** **Default transport for cagematch and likely pilot.** Spike already exists; extend, don’t replace, unless measurements force it.

---

## B2. WebRTC (audio track + data channel)

### 1. License
- Browser API; server stacks (mediasoup, Pion, livekit open core, etc.) — pick **Apache/MIT** only; avoid AGPL SFU if any.

### 2. Latency
- Best-in-class for **media** over lossy networks (jitter buffer, NACK, congestion control).
- Local LAN single-user may be **overkill**; ICE/DTLS setup adds complexity and cold-start time.

### 3. Accuracy
- Better resilience under packet loss → better STT under bad Wi-Fi.

### 4. Integration shape
- Signaling still needs WS/HTTP; media is PeerConnection.
- Does **not** map 1:1 to current `realtimeVoiceProtocol` binary frames — need a **RealtimeTransport** port (already hinted in MADR 0017 / voice-gateway protocol lanes).
- Server must terminate WebRTC (not just Node `ws`). Heavier ops.

### 5. Quest / WebXR
- Quest Browser is Chromium-based; WebRTC is widely used in XR streaming products (e.g. CloudXR.js paths).  
- Still need mic permission + immersive compatibility.
- **More moving parts** for a single-user local exam.

### 6. Maturity
- Extremely mature for conferencing; **heavier than needed** for local-first single station if WS+Opus meets latency.

**Verdict:** Keep as **failover candidate** if Wi-Fi packet loss ruins Opus-over-WS STT. Not first bake-off winner for local USB/LAN pilot.

---

## B3. WebTransport / QUIC

### 1. License
- Standard API; server implementations vary (often BSD/MIT).

### 2. Latency
- Unreliable datagrams + independent streams: attractive for media+control multiplexing.
- Baseline browser support improved (Safari 2026 claims); still validate **Quest Browser**.

### 3. Accuracy
- Transport only; same Opus payload concerns.

### 4. Integration shape
- voice-gateway already lists `webtransport-http3-media` as a **protocol lane** with status blocked/proposal.  
- Requires HTTP/3 server path (Bun HTTP/3 is aspirational in posture types; Node fallback is WS today).

### 5. Quest / WebXR
- **OPEN QUESTION:** Quest Browser WebTransport support and stability in immersive sessions is **not verified** in Meta public WebXR docs reviewed for this report.  
- MADR 0017 already deferred promotion until Quest + proxy + runtime path proven.

### 6. Maturity
- Spec maturing to Baseline on desktop; **Quest production maturity unknown**.

**Verdict:** Keep as **spike lane** per MADR 0017; **do not block** STT cagematch on WebTransport.

---

## B4. Does `mock-realtime-voice-server` survive?

**Yes — as the cagematch harness and likely pilot transport host.**

| Aspect | Assessment |
|---|---|
| Protocol | Already encodes Opus + partial/final transcripts + latency timestamps |
| Runtime | Node + Hono + `ws` matches monorepo and MADR 0024 Node-first |
| Promotion path | Documented: evidence → voice-gateway contracts → MADR update if assumptions change |
| Gaps to close | Real Opus encode/decode (not just binary echo); real STT adapter; TLS for non-USB; immersive mic client in `apps/ui-xr` or arena client |

**Survival condition:** Keep the **frame schema** stable; swap STT backend behind the WS server; optionally later implement the same schema over WebRTC data/audio.

---

# Quest 3 / WebXR microphone — dedicated research note

This is the critical path risk. Evidence summary:

| Claim | Evidence quality | Notes |
|---|---|---|
| `getUserMedia` exists for mic | Strong (web platform) | Requires secure context |
| Quest multiplayer WebXR apps use mic via `getUserMedia` | Medium (BabylonJS forum, 2023 Quest 2) | Suggests **possible**, not a Meta guarantee for all OS/Browser versions |
| Meta WebXR docs detail mic-in-immersive-vr | **Weak / not found** as first-class API | Meta docs focus on WebXR features, passthrough, hands — not a dedicated “immersive mic” guide |
| Permission UX in Quest Browser | Medium | Meta help covers immersive permissions (hands/body/spatial); mic may be separate browser permission |
| Mic works **while** `immersive-vr` session is active | **OPEN QUESTION** | Must measure: permission before vs during session; audio track muted on session start; deviceId changes; sampleRate |
| WebGPU STT on Quest | **OPEN QUESTION** | |
| WebTransport on Quest Browser | **OPEN QUESTION** | Chromium lineage is hopeful, not proof |

**Bake-off must not assume desktop Chrome behavior.** Use MADR 0027 USB + `chrome://inspect` path.

---

# Comparison matrices

## Decision A — STT candidates

| Candidate | Code license | Weights license | AGPL/NC risk | M1 Max latency fit | Quest on-device | Medical accuracy | Integration | Maturity | Cagematch priority |
|---|---|---|---|---|---|---|---|---|---|
| **whisper.cpp** | MIT | Whisper MIT | Low | **Excellent** (Metal/CoreML) | Poor (WASM only) | Medium (Whisper ~6% M-WER class) | Sidecar C++/HTTP | High | **P0** |
| **faster-whisper** | MIT | Whisper MIT | Low | Fair (CPU) | No | Medium (same Whisper) | Python sidecar | High | **P0** (baseline) |
| **Moonshine** | MIT | EN MIT; other Community | Medium (non-EN) | **Excellent** (vendor) | Unproven | **Unknown medical** | Python/C++ sidecar | Med-High | **P0** |
| **Vosk** | Apache-2.0 | Per model | Low | Excellent streaming | No | Likely weak | Node/Python in-process | Med | **P1** |
| **Silero VAD** | MIT | MIT | Low | Excellent | Possible ONNX | N/A (VAD) | Library front-end | High | **P0 infra** |
| **Silero STT** | Mixed | Verify | Medium | Fast but outdated | No | Weak/unknown | PyTorch hub | Low | **P2 / skip** |
| **transformers.js WebGPU** | Apache-ish | Whisper MIT | Low | Desktop only | High risk | Weak if small model | In-browser | Med | **P2 spike** |
| **WhisperKit** | MIT | Whisper MIT | Low | Excellent ANE | No | Medium (~6.3% M-WER) | Swift sidecar | High | **P1** |
| **Parakeet TDT + MLX** | Apache tools | **CC-BY-4.0** | Low (attribution) | Excellent speed | No | Medium; **weak Drug M-WER** | Python/MLX sidecar | High | **P1** |

## Decision B — Transport candidates

| Candidate | License risk | LAN latency | Lossy Wi-Fi | Fits existing protocol | Quest Browser support | Ops complexity | Cagematch priority |
|---|---|---|---|---|---|---|---|
| **WS + Opus** (mock server) | Low | Excellent | Fair | **Yes** | Strong | Low | **P0 default** |
| **WebRTC A/V + data** | Low if OSS stack | Excellent | **Best** | Needs new port | Likely good | High | **P1 if WS fails** |
| **WebTransport/QUIC** | Low | Excellent (theory) | Good | Partial (lane exists) | **Unknown on Quest** | Med-High | **P2 per MADR 0017** |

---

# Recommended bake-off protocol

## Goals
1. Prove **Quest immersive mic → local host audio** (gate G0).  
2. Rank STT adapters on **latency + medical term correctness** on fixed corpus (gate G1).  
3. Confirm transport choice under **USB LAN** and **Wi-Fi** (gate G2).  
4. Emit numbers that can fill a successor MADR without debate.

## Hardware & software freeze
- **Host:** Apple M1 Max 64 GB (or document if different).  
- **Headset:** Quest 3, Developer Mode, Browser version recorded (`chrome://version` equivalent via inspect).  
- **Link:** (a) USB-C adb reverse + localhost, (b) same-LAN Wi-Fi.  
- **Pin versions:** model hashes, git SHAs, quantization (q5_0 vs fp16), thread counts, `OPENCLINXR_*` env.  
- **No cloud APIs** during runs; models pre-downloaded offline.

## Fixed corpus (suggest)

### Primary: **PriMock57-derived short utterance set** (clinical conversational)
- Source dataset: Babylon **PriMock57** mock primary-care consultations (public research set).  
- **Do not** score full 9-hour suite in week-1; extract **N=40 utterances** (20 easy conversational + 20 clinical-term heavy): drugs, dosages, anatomy, vitals, negatives (“denies chest pain”).  
- Provide: `utt_id`, `wav` 16 kHz mono, `reference.txt`, `medical_terms.json` (list of must-get tokens).  
- License: review PriMock57 LICENSE before redistributing audio in-repo; if redistribution is restricted, keep corpus **local operator path** and store only metrics in evidence JSON.

### Secondary: **OpenClinXR scenario phrases** (product-aligned)
- 20 phrases from existing ED/peds blueprints (e.g. “When did the chest pressure start?”, meds, allergy).  
- Recorded by 2 speakers (headset mic + desktop mic) for domain gap.

### Tertiary: **LibriSpeech test-clean subset** (10 utterances)
- Sanity check that engines are installed correctly (not for medical ranking).

## STT engines to run (minimum set)

| ID | Engine | Model | Notes |
|---|---|---|---|
| S1 | whisper.cpp | large-v3-turbo + q5/CoreML if available | Metal on |
| S2 | faster-whisper | large-v3-turbo int8 CPU | Python |
| S3 | Moonshine | medium streaming EN | vendor default |
| S4 | Vosk | en-us-0.22 (or largest en) | streaming baseline |
| S5 | Parakeet-MLX | tdt-0.6b-v2 | optional P1 |
| S6 | WhisperKit server | large-v3-turbo | optional P1 |

All use **Silero VAD** (or engine-native VAD) with documented parameters.

## Transport legs to run

| ID | Path | Condition |
|---|---|---|
| T0 | Desktop Chrome → WS → host STT | Control |
| T1 | Quest 2D Browser → WS → host | Mic outside XR |
| T2 | Quest **immersive-vr** → WS → host | **Gate G0** |
| T3 | Quest immersive → WS over Wi-Fi | Loss stress |
| T4 | (Optional) WebRTC audio | Only if T2/T3 packet loss high |

## Metrics (measure all)

| Metric | Definition | Why |
|---|---|---|
| **MicOK** | Permission granted + RMS energy > threshold during speech | Falsifies capture |
| **T_partial_p50/p95** | speech onset → first `transcript.partial` | Interactivity |
| **T_final_p50/p95** | end-of-utterance (VAD) → `transcript.final` | Turn-taking |
| **RTF** | processing_time / audio_duration | Capacity |
| **WER** | standard, jiwer | Baseline |
| **M-WER** | WER only on medical term list | Clinical relevance |
| **Drug-term recall** | fraction of drug tokens exact-match | Safety-adjacent quality (not clinical validity claim) |
| **Hallucination rate** | non-empty transcript on pure silence 5 s | Whisper failure mode |
| **Transport loss** | % Opus packets missing / jitter ms | Explains WER gaps |
| **CPU/GPU/mem peak** | host during station simulation | Coexistence with LLM/TTS |

Timestamps: use existing `clientSentAtMs` / `backendObservedAtMs` plus host `transcript.atMs`.

## Pass / fail thresholds (and why)

These are **pilot engineering gates**, not clinical validation.

| Gate | Pass | Why |
|---|---|---|
| **G0 Quest mic** | T2: MicOK on ≥9/10 attempts; ≥1 successful final transcript | Without this, product voice is blocked |
| **G1 Latency** | T_final p95 ≤ **1500 ms** on M1 Max for ≤8 s utterances; T_partial p50 ≤ **500 ms** | Station feel; 200 ms ideal is aspirational; 1.5 s final is usable for SP dialogue |
| **G2 Accuracy** | M-WER ≤ **12%** on clinical 20-utt set **or** better than S4 Vosk by ≥ relative 30%; drug-term recall ≥ **80%** | Aligns roughly with open Whisper-class medical numbers (~6–12%); Vosk is floor |
| **G3 Silence** | Hallucination rate ≤ **10%** on silence trials | Prevents ghost learner utterances advancing dialogue |
| **G4 Local-only** | Network capture shows **no** external STT/TTS endpoints | Hard product constraint |
| **G5 License** | No AGPL; no CC-BY-NC weights in selected path; Community-license revenue terms documented | Legal blocker |
| **G6 Transport** | WS RTT p95 ≤ **50 ms** USB; ≤ **100 ms** Wi-Fi LAN; if Wi-Fi Opus loss >2%, open WebRTC spike | Keeps STT as bottleneck |

**Fail does not kill research:** document which gate failed and pivot (e.g. G0 fail → Godot native client path already arena’d in `ui-quest-voice-godot`).

## Reproducibility package

```text
.cagematch/voice-stt-transport-<date>/
  manifest.json          # hardware, OS, browser, model SHAs, git SHA
  corpus/                # or pointer to local corpus path + hash
  configs/*.yaml         # VAD, beam_size, quant, sample rate
  raw_logs/*.jsonl       # per-utt metrics
  transcripts/*.txt
  summary.md             # tables for MADR
  network_pcaps/         # optional, prove local-only
  quest_screenshots/     # permission dialogs
```

Commands (illustrative — implement in arena, not prescribed as existing):
1. Start `pnpm arena:voice:dev` (mock realtime server).  
2. Start STT sidecar for engine Sx.  
3. Run headless corpus job on host (T0).  
4. Run Quest scripted client for T1/T2 (manual mic grant is OK; record video).  
5. Emit `summary.json` with pass/fail per gate.

**Statistical minimum:** 3 runs × full corpus for top 2 engines after elimination round (first pass single-run is OK to drop losers).

## Suggested elimination tournament (1 week)

| Day | Work |
|---|---|
| 1 | Freeze corpus; install S1–S4; T0 desktop latency+WER |
| 2 | Wire S1 & S3 into mock-realtime-voice-server; partial/final events |
| 3 | **G0 Quest immersive mic** (T2) — stop the line if fail |
| 4 | Full clinical corpus on host for all P0 engines |
| 5 | Wi-Fi stress T3; optional WebRTC if needed |
| 6 | Skeptic pass: drug terms, silence, overlapping speech |
| 7 | Write MADR outcome from `summary.md` |

---

# Draft MADR (framing only — Decision TBD)

Use as `docs/madr/00XX-local-stt-and-quest-realtime-transport-cagematch.md` after results.

```markdown
# MADR 00XX: Local STT Engine And Quest Realtime Transport (Cagematch)

Date: 2026-08-XX  
Status: **Proposed — Decision TBD pending cagematch results**  
Arena: `apps/arena/mock-realtime-voice-server`, future STT sidecars under `apps/arena/`  
Related: MADR 0017, 0019, 0021, 0023, 0027

## Context

OpenClinXR needs learner speech capture on Quest 3 WebXR and local speech-to-text
so a virtual standardized patient can respond in a timed station without paid cloud
APIs or PHI leaving the machine. `@openclinxr/voice-gateway` defines
`VoiceProviderAdapter` with only mock/local stubs; `@openclinxr/session-state`
declares websocket messaging as design-contract-only (`runtimeImplemented: false`).
Arena harness `mock-realtime-voice-server` proves WebSocket framing (Opus-labeled
binary + transcript events) but not real STT or headset mic capture.

## Decision Drivers

1. Local-first / no paid cloud / no off-machine audio (MADR 0021).
2. Permissive licensing (no AGPL/copyleft; weights reviewed separately).
3. Interactive latency for multi-turn dialogue (not batch transcription).
4. Medical/conversational term robustness (M-WER, drug-term recall).
5. Fit to existing `VoiceProviderAdapter` + `realtimeVoiceProtocol` seams.
6. Quest 3 Browser feasibility (mic in immersive session — measured, not assumed).
7. Operability on Apple Silicon M1 Max 64 GB as primary host.

## Considered Options

### STT
- whisper.cpp (Metal/CoreML Whisper)
- faster-whisper / CTranslate2
- Moonshine streaming (English MIT weights)
- Vosk
- Silero (VAD required; full STT deprioritized)
- transformers.js WebGPU in-browser
- (Optional) WhisperKit, Parakeet-MLX

### Transport
- WebSocket + Opus (extend mock-realtime-voice-server) — status quo per MADR 0017
- WebRTC audio + data channel
- WebTransport/QUIC (deferred spike)

## Decision

**TBD — pending cagematch results.**

Anticipated decision shape (not binding):
1. Promote host-side STT engine **E\*** behind `VoiceProviderAdapter`.
2. Keep **WebSocket + Opus** as default transport unless G0/G6 fail.
3. Keep WebTransport/WebRTC as alternate `RealtimeTransport` implementations.
4. Treat Quest immersive mic evidence as a hard gate before learner-readiness claims.

## Consequences

### Positive (expected)
- Real transcription path replaces mock determinism for local dialog spikes.
- Adapter model remains auditable (MADR 0019).
- Arena evidence can flip session-state `runtimeImplemented` only after gates pass.

### Negative / risks
- Medical WER may force later fine-tunes or constrained vocab — still not clinical validation.
- Sidecar ops (Python/C++/Swift) increase runtime surface.
- Moonshine non-English or Community License terms may constrain i18n.
- If Quest mic-in-XR fails, may need native client path (Godot arena) — larger product change.

## Evidence Required Before Acceptance

- Cagematch `summary.md` with gates G0–G6.
- Model + code license inventory (weights SHA + SPDX).
- Network proof of local-only inference.
- `notEvidenceFor`: clinical_validity, exam_equivalence, scoring, learner_readiness
  until product policy says otherwise.

## Reversal Triggers

- Selected engine fails G1/G2 after two measurement cycles.
- License conflict discovered post-hoc.
- Quest Browser regression breaks mic or WS.
- WebSocket loss on target network exceeds threshold → promote WebRTC.

## Sources

- Cagematch report 2026-08-05 (this research)
- In-repo: voice-gateway types, mock-realtime-voice-server, MADRs 0017/0019/0021/0027
- External: whisper.cpp, faster-whisper, Moonshine LICENSE, Vosk, Silero VAD,
  Omi PriMock57 medical STT benchmark, Meta WebXR docs, BabylonJS Quest mic threads
```

---

# Recommended swappable-package shape

Align with existing Cellix-style ports (`@cellix/provider-contracts`) and current `VoiceProviderAdapter`.

## 1. Seedwork / generic tier (stable, no engine deps)

**Package ideas:** keep/extend `@openclinxr/voice-gateway` (or split if it grows):

```ts
// Already essentially present — harden these contracts:
interface VoiceProviderAdapter {
  readonly id: string;
  readonly capabilities: VoiceCapability[];
  health(): Promise<ProviderHealth>;
  transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent>;
  synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent>;
}

// Add for streaming capture (composition-time selection):
interface RealtimeTransport {
  readonly id: "websocket-opus" | "webrtc-media" | "webtransport-quic";
  connect(url: string, auth: TransportAuth): Promise<RealtimeSession>;
}

interface RealtimeSession {
  sendAudio(chunk: Uint8Array, meta: AudioChunkMeta): void;
  sendControl(frame: ClientControlFrame): void;
  events(): AsyncIterable<ServerVoiceEvent>; // partial/final/audio/backend.*
  close(): Promise<void>;
}

interface SpeechEndpointDetector { // Silero VAD lives here
  push(pcm: Float32Array, sampleRate: number): VotEvent[];
}
```

**Belongs in seedwork:**
- Frame schema (`realtimeVoiceProtocol`)
- Provenance / audit fields
- Policy gates (`cloudApisUsed: false`)
- WER harness interfaces (not model code)
- Mock adapters for CI

**Does not belong in seedwork:**
- ggml, CTranslate2, ONNX, CoreML, Python wheels

## 2. Product / adapter tier (composition-selected)

| Package | Responsibility |
|---|---|
| `@openclinxr/voice-adapter-whisper-cpp` | Spawns/connects whisper.cpp server; maps to `VoiceProviderAdapter` |
| `@openclinxr/voice-adapter-moonshine` | Moonshine streaming events → partial/final |
| `@openclinxr/voice-adapter-faster-whisper` | Python sidecar client |
| `@openclinxr/voice-adapter-vosk` | Optional Node in-process |
| `@openclinxr/voice-vad-silero` | Shared VAD |
| `@openclinxr/realtime-transport-ws` | Current mock server promoted |
| `@openclinxr/realtime-transport-webrtc` | Optional later |

**Composition root** (apps/api or arena gateway):

```ts
const stt = process.env.OPENCLINXR_STT_ADAPTER === "moonshine"
  ? createMoonshineAdapter(cfg)
  : createWhisperCppAdapter(cfg);

const transport = createWebSocketOpusTransport({ path: "/voice/realtime/ws" });

const gateway = new VoiceGateway({ adapters: [stt, tts], routeId: "local-station" });
```

## 3. Runtime topology (recommended default)

```text
Quest Browser (WebXR)
  mic → Opus encode
  WebSocket binary + control
        │
        ▼
Mac host: mock-realtime-voice-server / promoted voice gateway
  decode Opus → PCM
  Silero VAD → utterance bounds
  STT sidecar (whisper.cpp | Moonshine | …)
  transcript.partial / transcript.final → session-state / dialogue
  TTS sidecar (separate Decision; VibeVoice MADR 0023)
  Opus audio.chunk → headset playback
```

**Why sidecar over in-process Node:**  
Native STT stacks are C++/Python/Swift; sidecars isolate crashes, allow Metal/ANE, and keep monorepo TypeScript free of native build matrices. The adapter stays a thin WS/HTTP client implementing `VoiceProviderAdapter`.

## 4. What “success” looks like for package promotion

1. Adapter `health()` returns `ready` only with local evidence file (pattern already in `LocalVoiceProviderAdapter`).  
2. Architecture test forbids importing arena STT engines from `apps/ui-xr` directly.  
3. `session-state` may set `runtimeImplemented: true` only after G0–G6 evidence pack.  
4. Claims carry `notEvidenceFor: clinical_validity, exam_equivalence, scoring`.

---

# Skeptical synthesis — what is popular but a bad first fit

| Popular choice | Why it’s a bad first fit here |
|---|---|
| **In-browser WebGPU Whisper on Quest** | Contends with XR GPU; model size vs accuracy; unproven mic+WebGPU+immersive combo |
| **faster-whisper as primary on M1 Max** | Great on NVIDIA; on Apple Silicon loses to whisper.cpp/Moonshine/WhisperKit |
| **Silero as full STT** | VAD is great; STT is legacy; TTS often NC-licensed |
| **WebTransport first** | Already rejected as pilot default in MADR 0017; Quest support unverified |
| **Cloud medical STT** | Violates local-first / PHI boundary regardless of WER leadership |

| Honest best-guess (not a decision) | Why |
|---|---|
| Transport: **WS+Opus survives** | Already spiked; simple; sufficient on USB/LAN |
| STT: **whisper.cpp or Moonshine** wins host bake-off | Latency vs accuracy trade; both MIT-friendly for EN |
| Must measure: **Quest immersive mic** | Evidence quality is forum-level, not Meta-guaranteed |

---

# Open questions (explicit — for bake-off, not speculation)

1. Does Quest Browser grant and sustain **microphone tracks during `immersive-vr`**?  
2. Sample rate / echo / AEC behavior with SP TTS playback (barge-in / half-duplex)?  
3. WebCodecs Opus vs WASM opus encode CPU cost on Quest?  
4. Moonshine **medical** WER on PriMock-style audio?  
5. Can STT + local LLM + TTS coexist on M1 Max 64 GB within station latency budget?  
6. Quest Browser **WebTransport** and **WebGPU** feature reality for target OS build?  
7. Is PriMock57 redistributable into the monorepo or operator-local only?

---

# Sources (primary)

**In-repo:** `packages/openclinxr/voice-gateway/src/types.ts`, `adapters.ts`; `apps/arena/mock-realtime-voice-server`; `docs/madr/0017`, `0019`, `0021`, `0023`, `0027`, `0029`.

**External (non-exhaustive):**  
- whisper.cpp (ggml-org) README / MIT  
- faster-whisper (SYSTRAN) README / MIT LICENSE  
- Moonshine LICENSE (MIT code + EN weights; Community License for other languages)  
- Vosk (Apache-2.0)  
- Silero VAD (MIT)  
- OpenAI Whisper MIT weights announcement / GitHub  
- Omi Health PriMock57 medical STT benchmark (archived v4 table)  
- PriMock57 dataset (Babylon Health)  
- Meta Horizon WebXR docs  
- BabylonJS forum: Quest mic + getUserMedia  
- NVIDIA Parakeet CC-BY-4.0 model cards  
- WhisperKit / Argmax MIT  

---

**End of report.** No repo files were modified. An engineer should be able to run the week-1 cagematch from the protocol section and fill Decision = TBD in the draft MADR from measured G0–G6 outcomes.