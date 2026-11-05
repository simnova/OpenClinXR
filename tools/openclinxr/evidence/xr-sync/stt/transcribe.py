#!/usr/bin/env python3
"""Local speech recognizer for the xr-sync speech-intake harness (C29).

faster-whisper (MIT code, MIT Whisper weights, CTranslate2 CPU int8). No network at run time once the model
is cached; no LLM. usage: transcribe.py <16 kHz mono wav> [model=base.en]
Prints one JSON line {"text", "confidence", "model", "ms"}. confidence = exp(mean avg_logprob) over segments,
clamped to [0,1]; no segment -> text "" and confidence 0. Audio is read with the stdlib wave module (PyAV
is not needed).
"""
import json
import math
import sys
import time
import wave

import numpy as np
from faster_whisper import WhisperModel


def main() -> None:
    path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base.en"
    with wave.open(path) as handle:
        if handle.getframerate() != 16000 or handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise SystemExit("transcribe.py needs 16 kHz mono 16-bit PCM wav")
        samples = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    started = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(samples, language="en", beam_size=5, condition_on_previous_text=False)
    parts = list(segments)
    text = " ".join(part.text.strip() for part in parts).strip()
    confidence = 0.0
    if parts:
        confidence = max(0.0, min(1.0, math.exp(sum(part.avg_logprob for part in parts) / len(parts))))
    print(json.dumps({"text": text, "confidence": round(confidence, 4), "model": model_name, "ms": int((time.time() - started) * 1000)}))


main()
