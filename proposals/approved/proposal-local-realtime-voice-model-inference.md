# Proposal: Local Realtime Voice Model Inference

Status: Approved by Patrick on 2026-05-04 19:16:05 EDT.

Approval note: Patrick approved the constrained developer-only spike and refined the recommendation to use `kyutai/moshiko-mlx-q4` as the primary full-duplex Moshi MLX q4 candidate, with `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` as the outbound TTS fallback. All original constraints remain: isolated venv and cache outside the repo, no production use, no committed weights, no cloud, no paid APIs, and kill/acceptance criteria still apply.

## Decision Record

Approved a local-only realtime voice inference spike that evaluates Moshi MLX and Qwen3-TTS MLX behind the existing `apps/api-python-backend` FastAPI sidecar and Bun/Hono gateway posture.

This proposal is separate from the already approved VibeVoice file-generation spike. It is specifically for low-latency, bidirectional or near-bidirectional voice inference evidence.

## Recommendation

Approve a constrained developer-only spike.

Use `kyutai/moshiko-mlx-q4` as the primary full-duplex dialog candidate because Moshi is explicitly designed as a speech-text, full-duplex spoken dialogue framework. Use `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` as the outbound TTS fallback because its Apache-2.0 posture is cleaner and its published materials emphasize low-latency streaming TTS, while acknowledging that it is not a standalone full-duplex dialog system.

Do not add either model runtime to default repo scripts, production manifests, Quest claims, summative assessment flows, or `pnpm verify`.

## Proposed Scope

| Item | Proposed value | Posture |
| --- | --- | --- |
| Primary candidate | `kyutai/moshiko-mlx-q4` | Local research only |
| TTS fallback | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` | Local research only |
| Runtime packages | `moshi_mlx`, `mlx-audio`, `huggingface_hub` | Isolated venv only |
| Install root | `~/.cache/openclinxr/realtime-voice` | Outside repo |
| HF cache | `/Users/patrick/.cache/openclinxr/huggingface` | Outside repo |
| Python | 3.12 isolated venvs | No committed venv |
| Cloud calls | None | Disallowed |
| Paid APIs | None | Disallowed |
| Committed weights/audio | None | Disallowed |
| Production use | None | Disallowed |

## Pros

- Tests the voice path that actually matters for Quest station dialog: local low-latency speech, not only file generation.
- Moshi gives the best architectural fit for interruption, overlapping speech, and turn-taking realism.
- Qwen3-TTS gives a smaller Apple Silicon TTS fallback with Apache-2.0 model/code posture.
- Builds directly on the already verified FastAPI WebSocket smoke and realtime transport harness.

## Cons

- Moshi model weights are CC-BY 4.0 and the model card limits use to research, with explicit cautions against impersonation and professional-duty use.
- Qwen3-TTS is TTS, not ASR or full-duplex dialog, so it cannot prove the complete voice loop by itself.
- Downloads are large enough to require explicit operator approval and cleanup tracking.
- Voice cloning, emotional speech, and synthetic clinical actors add consent, disclosure, misuse, and safety risks.

## Minimal Spike Plan

1. Record exact model IDs, license metadata, package versions, disk expectations, cache locations, and uninstall commands before install.
2. Benchmark Qwen3-TTS MLX 4-bit with fixed neutral and clinical prompts; record startup time, first audio, total synthesis time, real-time factor, peak memory, output duration, and no-cloud proof.
3. Benchmark Moshi MLX q4 with a file or loopback audio path first; record startup time, sustained lag, audio/transcript event shape, memory, and whether lag grows over a 30-second loop.
4. Only after one candidate produces local audio, connect it behind `apps/api-python-backend` WebSocket as an optional provider.
5. Regenerate benchmark evidence without claiming Quest-ready live dialog until Quest mic/playback, Opus, WebXR/Godot playback, and safety controls are exercised.

## Kill Criteria

Stop immediately if a candidate:

- Requires a paid API, hosted inference provider, tunnel, or cloud callback.
- Cannot install in the approved cache/venv locations.
- Exceeds expected disk footprint by more than 2x without a clear explanation.
- Cannot produce local audio after a warm run.
- Runs with real-time factor above 1.5 for Qwen3-TTS or sustained Moshi lag above 2 seconds in a 30-second loop.
- Produces unsafe clinical advice, identity imitation behavior, or unusable pronunciation on short medical phrase prompts.

## Acceptance Criteria

- A markdown install record captures model IDs, exact package versions, cache paths, source URLs, licenses, disk footprint, and uninstall commands.
- No model weights, generated audio, or private env files are committed.
- A new evidence report records local-only inference metrics and explicit `developer_only` status.
- `.agent-factory/benchmark-gate-report.json` can distinguish transport smoke, FastAPI runtime smoke, and real local inference evidence.
- Existing blockers remain for Quest mic/playback, native Opus or equivalent codec path, WebXR/Godot audio playback, and clinical voice safety controls.

## Sources

- Moshi repository and MLX backend: https://github.com/kyutai-labs/moshi
- Moshi paper: https://arxiv.org/abs/2410.00037
- Moshi MLX q4 model card: https://huggingface.co/kyutai/moshiko-mlx-q4
- Qwen3-TTS repository: https://github.com/QwenLM/Qwen3-TTS
- Qwen3-TTS paper: https://arxiv.org/abs/2601.15621
- Qwen3-TTS MLX 4-bit conversion: https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit
- VibeVoice repository for comparison with the approved file-generation spike: https://github.com/microsoft/VibeVoice
