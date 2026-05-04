from __future__ import annotations

import json
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
                "status": "proposal_required",
                "cloudApisUsed": False,
                "paidApisUsed": False,
                "modelDownloadsUsed": False,
                "description": "Future local full-duplex voice candidate gated by operator approval and model install evidence.",
                "blockers": [
                    "proposal_local_realtime_voice_model_inference_pending",
                    "model_weights_not_installed",
                    "mlx_runtime_not_installed",
                ],
            },
            {
                "id": "qwen3-tts-mlx",
                "status": "proposal_required",
                "cloudApisUsed": False,
                "paidApisUsed": False,
                "modelDownloadsUsed": False,
                "description": "Future local streaming TTS fallback gated by operator approval and model install evidence.",
                "blockers": [
                    "proposal_local_realtime_voice_model_inference_pending",
                    "model_weights_not_installed",
                    "mlx_runtime_not_installed",
                ],
            },
        ],
    }


@app.websocket("/voice/realtime/ws")
async def voice_realtime_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "session.started",
            "protocol": "json-control-and-binary-audio-echo",
        }
    )

    audio_chunks = 0
    audio_bytes = 0

    try:
        while True:
            message = await websocket.receive()
            message_type = message.get("type")

            if message_type == "websocket.disconnect":
                break

            if message_type != "websocket.receive":
                await websocket.send_json(
                    {"type": "error", "reason": f"unsupported message type: {message_type}"}
                )
                continue

            text_payload = message.get("text")
            binary_payload = message.get("bytes")

            if text_payload is not None:
                await handle_control_frame(websocket, text_payload)
                continue

            if binary_payload is not None:
                audio_chunks += 1
                audio_bytes += len(binary_payload)
                await websocket.send_json(
                    {
                        "type": "audio.metadata",
                        "chunkIndex": audio_chunks,
                        "chunkBytes": len(binary_payload),
                        "totalBytes": audio_bytes,
                        "format": "opaque-binary",
                    }
                )
                await websocket.send_json(
                    {
                        "type": "transcript.delta",
                        "text": "",
                        "isFinal": False,
                        "sourceChunkIndex": audio_chunks,
                    }
                )
                await websocket.send_bytes(binary_payload)
                continue

            await websocket.send_json({"type": "error", "reason": "empty websocket frame"})
    except WebSocketDisconnect:
        return


async def handle_control_frame(websocket: WebSocket, payload: str) -> None:
    try:
        control = json.loads(payload)
    except json.JSONDecodeError as error:
        await websocket.send_json(
            {
                "type": "error",
                "reason": "invalid JSON control frame",
                "detail": str(error),
            }
        )
        return

    if not isinstance(control, dict):
        await websocket.send_json(
            {"type": "error", "reason": "control frame must be a JSON object"}
        )
        return

    frame_type = str(control.get("type", "control"))
    await websocket.send_json(
        {
            "type": "control.ack",
            "controlType": frame_type,
            "received": sanitize_control_frame(control),
        }
    )

    if frame_type in {"start", "commit", "flush"}:
        await websocket.send_json(
            {
                "type": "transcript.metadata",
                "status": "ready",
                "controlType": frame_type,
            }
        )


def sanitize_control_frame(control: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in control.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            sanitized[key] = value
        elif isinstance(value, list):
            sanitized[key] = f"list[{len(value)}]"
        elif isinstance(value, dict):
            sanitized[key] = f"object[{len(value)}]"
        else:
            sanitized[key] = type(value).__name__
    return sanitized
