"""Build-time speech synthesis via Kokoro-82M (Apache-2.0).

Invoked by speech-synth.ts, never by hand. Seeded for byte-determinism:
the same (text, voice) pair writes identical WAV bytes on every run.
Reads nothing from the repo; writes one WAV path given on argv.
"""

from __future__ import annotations

import argparse
import json
import random
import sys

import numpy as np
import soundfile as sf
import torch


def main() -> int:
    parser = argparse.ArgumentParser(description="Synthesize one line with Kokoro-82M")
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--lang", default="a")
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    from kokoro import KPipeline

    pipeline = KPipeline(lang_code=args.lang)
    chunks: list = []
    for _gs, _ps, audio in pipeline(args.text, voice=args.voice):
        chunks.append(audio)
    if not chunks:
        print(json.dumps({"ok": False, "error": "no audio chunks"}))
        return 1
    wave = np.concatenate(chunks, axis=0)
    sf.write(args.out, wave, 24000, subtype="PCM_16")
    print(json.dumps({"ok": True, "sampleRateHz": 24000, "frames": int(wave.shape[0])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
