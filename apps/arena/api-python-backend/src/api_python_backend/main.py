from __future__ import annotations

import json
import time
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect


app = FastAPI(
    title="OpenClinXR Realtime Voice AI Spike",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "api-python-backend"}


@app.get("/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        "service": "api-python-backend",
        "defaultMode": "transport-echo",
        "routes": {
            "health": "/health",
            "capabilities": "/capabilities",
            "realtimeWebSocket": "/voice/realtime/ws",
        },
        "modes": [
            {
                "id": "transport-echo",
                "status": "ready",
                "cloudApisUsed": False,
                "paidApisUsed": False,
                "modelDownloadsUsed": False,
                "description": "Local WebSocket control and binary-frame echo for gateway integration tests.",
                "blockers": [],
            },
            {
                "id": "moshi-mlx",
                "status": "approved_runtime_missing",
                "cloudApisUsed": False,
                "paidApisUsed": False,
                "modelDownloadsUsed": False,
                "approvedProposal": "proposals/approved/proposal-local-realtime-voice-model-inference.md",
                "modelId": "kyutai/moshiko-mlx-q4",
                "description": "Approved local full-duplex voice candidate, still blocked until model weights, MLX runtime, and real inference evidence exist.",
                "blockers": [
                    "model_weights_not_installed",
                    "mlx_runtime_not_installed",
                    "real_inference_not_observed",
                ],
            },
            {
                "id": "qwen3-tts-mlx",
                "status": "approved_runtime_missing",
                "cloudApisUsed": False,
                "paidApisUsed": False,
                "modelDownloadsUsed": False,
                "approvedProposal": "proposals/approved/proposal-local-realtime-voice-model-inference.md",
                "modelId": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
                "description": "Approved local streaming TTS fallback, still blocked until model weights, MLX runtime, and real inference evidence exist.",
                "blockers": [
                    "model_weights_not_installed",
                    "mlx_runtime_not_installed",
                    "real_inference_not_observed",
                ],
            },
        ],
    }


@app.websocket("/voice/realtime/ws")
async def voice_realtime_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "backend.ready",
            "backendProtocol": "python-fastapi-compatible-websocket",
        }
    )

    audio_chunks = 0
    audio_bytes = 0
    pending_audio_metadata: dict[int, dict[str, Any]] = {}

    try:
        while True:
            message = await websocket.receive()
            message_type = message.get("type")

            if message_type == "websocket.disconnect":
                break

            if message_type != "websocket.receive":
                await websocket.send_json(
                    {"type": "backend.error", "reason": f"unsupported message type: {message_type}"}
                )
                continue

            text_payload = message.get("text")
            binary_payload = message.get("bytes")

            if text_payload is not None:
                await handle_control_frame(websocket, text_payload, pending_audio_metadata)
                continue

            if binary_payload is not None:
                chunk_index = audio_chunks
                metadata = pending_audio_metadata.pop(chunk_index, {})
                audio_chunks += 1
                audio_bytes += len(binary_payload)
                await websocket.send_json(
                    {
                        "type": "audio.chunk",
                        "codec": "opus",
                        "chunkIndex": chunk_index,
                        "byteLength": len(binary_payload),
                        "totalBytes": audio_bytes,
                        "clientSentAtMs": metadata.get("clientSentAtMs"),
                        "backendObservedAtMs": round(time.perf_counter() * 1000, 2),
                    }
                )
                await websocket.send_json(
                    {
                        "type": "transcript.partial",
                        "text": "",
                        "confidence": 0.0,
                        "sourceChunkIndex": chunk_index,
                    }
                )
                await websocket.send_json(
                    {
                        "type": "transcript.final",
                        "text": "",
                        "confidence": 0.0,
                        "sourceChunkIndex": chunk_index,
                    }
                )
                await websocket.send_bytes(binary_payload)
                continue

            await websocket.send_json({"type": "backend.error", "reason": "empty websocket frame"})
    except WebSocketDisconnect:
        return


async def handle_control_frame(
    websocket: WebSocket,
    payload: str,
    pending_audio_metadata: dict[int, dict[str, Any]],
) -> None:
    try:
        control = json.loads(payload)
    except json.JSONDecodeError as error:
        await websocket.send_json(
            {
                "type": "backend.error",
                "reason": "invalid JSON control frame",
                "detail": str(error),
            }
        )
        return

    if not isinstance(control, dict):
        await websocket.send_json(
            {"type": "backend.error", "reason": "control frame must be a JSON object"}
        )
        return

    frame_type = str(control.get("type", "control"))

    if frame_type == "voice.start":
        await websocket.send_json(
            {
                "type": "voice.started",
                "codec": "opus",
            }
        )
        return

    if frame_type == "voice.stop":
        await websocket.send_json({"type": "voice.stopped"})
        return

    if frame_type == "voice.audio_metadata":
        chunk_index = control.get("chunkIndex")
        client_sent_at_ms = control.get("clientSentAtMs")
        if isinstance(chunk_index, int) and not isinstance(chunk_index, bool):
            pending_audio_metadata[chunk_index] = {
                "clientSentAtMs": client_sent_at_ms
                if isinstance(client_sent_at_ms, (int, float)) and not isinstance(client_sent_at_ms, bool)
                else None
            }
        return

    await websocket.send_json(
        {
            "type": "backend.error",
            "reason": f"unsupported control frame: {frame_type}",
        }
    )
