# Local Hardware Spike Results

Date: 2026-05-03
Status: Internal planning evidence

## Purpose

The user asked for local-only validation where possible, avoiding cloud charges and third-party model API use. This spike checks the current machine, installed runtime tools, and lightweight local throughput assumptions for planning-scale OpenClinXR work.

This is not a local LLM or local voice benchmark. It now includes static and OpenClinXR XR-shell Quest 3 USB-C browser routing smokes, but not an immersive performance benchmark.

## Current Machine

The local machine reports:

| Field | Result |
| --- | --- |
| macOS | 26.4.1 |
| Kernel | Darwin 25.4.0 ARM64 |
| Chip | Apple M1 Max |
| CPU cores | 10 total, 8 performance and 2 efficiency |
| Memory | 64 GB |
| Free disk | About 2.5 TiB available |

Important note: this is not the M4 Pro mentioned by the user. Treat these results as a conservative local-machine snapshot. Re-run this spike on the target M4 Pro or M4 Max machine before locking local model sizes.

## Installed Runtime Tools

| Tool | Result | Implication |
| --- | --- | --- |
| Node | 22.19.0 | Good for TypeScript planning and local tooling |
| npm | 10.9.3 | Available |
| pnpm | Installed | Preferred workspace package manager for implementation |
| yarn | Installed | Available, not preferred |
| Python | 3.11.4 | Available for local AI/asset tooling |
| ffmpeg | 8.1 | Good for local audio and media processing |
| Android Platform Tools | Installed on 2026-05-03 | `adb` is available for Quest 3 USB-C WebXR smoke testing |
| Bun | Not installed | Bun/Hono production path needs install gate or Node adapter during development |
| Blender | Not installed | Asset pipeline needs install gate before 3D generation/optimization |
| gltf-pipeline | 4.3.1 installed as a pinned pnpm dev dependency | Apache-2.0 local GLB conversion/optimization CLI available through pnpm |
| gltf-transform | Not installed | Keep as optional external workstation tool until its current CLI dependency path is cleared by license review |
| ImageMagick | Not installed | Texture pipeline needs install gate or alternative |
| Ollama | Not installed | Local LLM convenience runtime unavailable until installed |
| llama.cpp binaries | Not installed | Local GGUF inference needs install/build gate |
| MLX LM | Not installed | Apple Silicon MLX inference needs install gate |
| Whisper binaries | Not installed | Local STT needs install/build gate |

Python module check:

| Module | Result |
| --- | --- |
| `torch` | 2.0.1 installed |
| `transformers` | 4.31.0 installed |
| `numpy` | 1.25.2 installed |
| `scipy` | 1.11.1 installed |
| `mlx` | Not installed |
| `soundfile` | Not installed |

## Repeatable Local Runtime Probe

Run time: 2026-05-03 18:31 EDT

Command:

```bash
pnpm local:runtime:probe -- --output docs/openclinxr/local-runtime-probe-2026-05-03.json
```

Machine-readable evidence:

- `docs/openclinxr/local-runtime-probe-2026-05-03.json`

Gate results:

| Gate | Status | Blockers |
| --- | --- | --- |
| Quest USB | Ready | None |
| Local model | Not configured | `no_ollama_llama_cpp_or_mlx_runtime_detected` |
| Local voice | Not configured | `no_vibevoice_runtime_detected` |
| Asset pipeline | Not configured | `missing_blender` |

The probe intentionally does not download models, install runtimes, or call cloud APIs. It is suitable for repeating before a local-model or local-voice benchmark so the team can separate "runtime not installed" from "runtime installed but model not benchmarked."

## GLB Pipeline Smoke

Run time: 2026-05-03 18:35 EDT

Command:

```bash
pnpm asset:gltf:smoke -- --output docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json
```

Machine-readable evidence:

- `docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json`

Result:

| Check | Result |
| --- | --- |
| Tool | `gltf-pipeline` 4.3.1, Apache-2.0 |
| Input | Generated single-triangle glTF |
| Output | 848-byte GLB |
| GLB magic | `glTF` |
| GLB version | 2 |
| Declared length | Matches file length |
| Verdict | Passed |

This proves the local permissive GLB conversion path is executable. It does not replace Blender, mesh decimation, texture compression, headset frame pacing, or visual QA.

## Local Provider Benchmark Contract

Run time: 2026-05-03 18:51 EDT

Command:

```bash
pnpm local:provider:benchmark -- --output docs/openclinxr/local-provider-benchmark-2026-05-03.json
```

Machine-readable evidence:

- `docs/openclinxr/local-provider-benchmark-2026-05-03.json`

Result:

| Lane | Status | Evidence |
| --- | --- | --- |
| Mock model | Passed | Deterministic actor response, token counts, zero cost |
| Mock voice | Passed | Two transcript events, one audio chunk, viseme cue, zero cost |
| Local model | Not configured | No Ollama/llama.cpp/MLX runtime detected; local model env vars unset |
| Local voice | Not configured | No VibeVoice runtime detected; local voice env vars unset |

The benchmark contract intentionally avoids cloud calls, model downloads, and local runtime execution. It is ready to become a real local-provider benchmark once runtimes and model IDs are configured explicitly.

## Lightweight Throughput Smokes

These are local-only Node checks. They do not use cloud services and do not download model weights.

### Brute Force Vector Retrieval

Smoke:

- 20,000 synthetic vectors.
- 384 dimensions.
- Single-thread JavaScript dot-product scan.
- Top 8 result selection.

Result:

```json
{
  "docs": 20000,
  "dim": 384,
  "topK": 8,
  "elapsedMs": 10.6,
  "docsPerSecond": 1886948,
  "note": "single-thread JS brute-force vector retrieval smoke, not production ANN"
}
```

Implication: planning-scale vector retrieval and actor-memory tests can be simulated locally without a production vector database. Production should still use indexed MongoDB Atlas/Cosmos/vector search or a local ANN library after benchmark.

### Trace JSON Serialization

Smoke:

- 100,000 trace-event JSON serialize/parse loops.
- About 18.17 MB serialized.

Result:

```json
{
  "events": 100000,
  "mbSerialized": 18.17,
  "elapsedMs": 181.05,
  "eventsPerSecond": 552330,
  "note": "Node JSON trace serialization/parsing smoke on current hardware"
}
```

Implication: trace event serialization is not a local bottleneck for single-user pilot design. Persistence, indexing, replay queries, and network batching still need implementation benchmarks.

### AJV Schema Validation

Smoke:

- 20,000 validations of the iteration-0003 leadership scorecard schema.

Result:

```json
{
  "runs": 20000,
  "ok": 20000,
  "elapsedMs": 123.11,
  "validationsPerSecond": 162460,
  "note": "AJV schema validation smoke for local planning artifacts"
}
```

Implication: schema-first validation is feasible for local development and test harnesses.

## Conclusions

Local strengths:

- TypeScript planning and schema validation are ready.
- Disk capacity is sufficient for moderate local model and asset experiments.
- ffmpeg is available for audio processing.
- Python and Node are usable.

Local gaps:

- Bun must be installed or the first implementation must use a Node Hono adapter locally.
- Blender must be installed before asset pipeline generation/bake spikes. `gltf-pipeline` is now available as the pinned pnpm CLI for permissive local GLB conversion/optimization checks.
- llama.cpp, Ollama, MLX LM, and VibeVoice are not installed.
- Quest 3 USB debugging was authorized, `adb reverse tcp:5173 tcp:5173` succeeded, and Quest Browser loaded both a static local smoke page and the OpenClinXR XR station shell.
- No immersive WebXR runtime benchmark has been run yet; the current evidence is browser-shell rendering and interaction only.

Recommended local-only next spikes:

1. Install Bun and verify Hono WebSocket local server.
2. Install Blender and run the next asset bake smoke against a small placeholder GLB; keep `gltf-transform` as an optional external workstation tool until its CLI dependency path satisfies the copyleft policy.
3. Install MLX LM or llama.cpp and benchmark Qwen3-4B/Qwen3-8B or DeepSeek-R1-Distill-Qwen-7B quantized model.
4. Install VibeVoice-Realtime-0.5B only after reviewing model terms and disk/runtime requirements.
5. Add a measured Quest 3 10-minute performance and comfort smoke for the real station shell with DevTools screencasting disabled.

## Quest 3 USB Preflight

Android Platform Tools were installed through Homebrew. The local `adb` version is 37.0.0. The headset was visible with serial `2G0YC5ZGB5000J`.

After the in-headset USB debugging prompt was accepted, the device reported:

```text
List of devices attached
2G0YC5ZGB5000J         device usb:0-1 product:eureka model:Quest_3 device:eureka transport_id:1
```

Device details:

- Model: Quest 3.
- Device codename: `eureka`.
- Android release base: `14`.
- Build incremental: `52083180032000520`.
- Browser package: `com.oculus.browser`.
- Browser version observed: `146.0.0.19.27.942135376`.

Port reverse setup also succeeded:

```text
UsbFfs tcp:5173 tcp:5173
```

Static smoke result:

- Local Node HTTP server on `127.0.0.1:5173` served the Quest Browser.
- Quest Browser requested `/` and `/favicon.ico`.
- Remote DevTools over `adb forward tcp:9222 localabstract:chrome_devtools_remote` listed the `OpenClinXR Quest Smoke` page.
- Browser user agent included `Quest 3`, `OculusBrowser/146.0.0.19.27.942135376`, and `Chrome/146.0.7680.177`.

This validates the local USB-C development loop. It does not validate the future XR scene.

OpenClinXR XR shell smoke result:

- `apps/ui-xr` Vite dev server served `http://localhost:5173/`.
- `adb devices -l` reported `2G0YC5ZGB5000J device usb:0-1 product:eureka model:Quest_3 device:eureka`.
- `adb reverse tcp:5173 tcp:5173` and `adb forward tcp:9222 localabstract:chrome_devtools_remote` succeeded.
- Quest Browser loaded `OpenClinXR Station Runtime` at `http://localhost:5173/`.
- Remote DevTools reported:
  - Page title: `OpenClinXR Station Runtime`.
  - Body content includes `ED Chest Pain`.
  - Canvas dimensions: `860x774`.
  - Vite/framework overlay: `false`.
  - `navigator.xr` exists.
- Trace interaction smoke:
  - Clicking `Ecg Request` advanced the local trace to `Trace 1/10`.
  - Clicking `Urgent Escalation` advanced the local trace to `Trace 2/10`.
  - Dialogue changed to the expected urgent-escalation line.
- Frame telemetry smoke:
  - The app exposed `window.__openClinXrFrameStats` to CDP.
  - Quest Browser reported `document.visibilityState` as `hidden` during the automated CDP sample.
  - The render loop recorded the first frame but did not accumulate sustained frame deltas while hidden.

Probe limitation:

- Calling `navigator.xr.isSessionSupported("immersive-vr")` through CDP did not resolve before the probe timeout. Treat this as inconclusive, not a negative WebXR-support result.
- CDP-based frame sampling is currently blocked by the Quest page being reported as hidden/inactive. Treat this as a precise automation limitation and require a foreground in-headset run before making frame-pacing claims.

This validates Quest Browser delivery of the current OpenClinXR shell, nonblank 3D canvas rendering, and basic trace-control interaction. It does not validate immersive session entry, controller interaction, frame pacing, comfort, heat, battery use, speech, or local model/voice latency.

## Sources

- `src-local-hardware-spike-2026-05-03`
