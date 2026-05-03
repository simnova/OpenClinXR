# Local Hardware Spike Results

Date: 2026-05-03
Status: Internal planning evidence

## Purpose

The user asked for local-only validation where possible, avoiding cloud charges and third-party model API use. This spike checks the current machine, installed runtime tools, and lightweight local throughput assumptions for planning-scale OpenClinXR work.

This is not a Quest 3 performance test and not a local LLM or local voice benchmark.

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
| Bun | Not installed | Bun/Hono production path needs install gate or Node adapter during development |
| Blender | Not installed | Asset pipeline needs install gate before 3D generation/optimization |
| gltf-transform | Not installed | Asset optimization CLI needs install gate |
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
- Blender and glTF Transform must be installed before asset pipeline spikes.
- llama.cpp, Ollama, MLX LM, and VibeVoice are not installed.
- No Quest 3 runtime benchmark has been run.

Recommended local-only next spikes:

1. Install Bun and verify Hono WebSocket local server.
2. Install `gltf-transform` and run GLB validation on a small placeholder asset.
3. Install MLX LM or llama.cpp and benchmark Qwen3-4B/Qwen3-8B or DeepSeek-R1-Distill-Qwen-7B quantized model.
4. Install VibeVoice-Realtime-0.5B only after reviewing model terms and disk/runtime requirements.
5. Run a Quest 3 WebXR smoke against a static local Vite scene.

## Sources

- `src-local-hardware-spike-2026-05-03`
