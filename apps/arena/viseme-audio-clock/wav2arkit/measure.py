"""wav2arkit_cpu bake-off measurement. See score-sheet.md for formulas and sources."""
import json
import time
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
REPO = HERE.parent.parent.parent.parent  # apps/arena/viseme-audio-clock/wav2arkit -> repo root

NAMES = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight",
    "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
    "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight", "tongueOut",
]
FPS = 30
RUNS = 20


def load_mono_float32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1, f"{path}: {w.getframerate()}Hz {w.getnchannels()}ch"
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def col(out: np.ndarray, name: str) -> np.ndarray:
    return out[:, NAMES.index(name)]


def closure_sig(out: np.ndarray) -> np.ndarray:
    return col(out, "mouthClose") - col(out, "jawOpen")


def labio_sig(out: np.ndarray) -> np.ndarray:
    return (col(out, "mouthRollLower") + col(out, "mouthLowerDownLeft") + col(out, "mouthLowerDownRight")) / 3.0


def activity_sig(out: np.ndarray) -> np.ndarray:
    return (col(out, "mouthLowerDownLeft") + col(out, "mouthLowerDownRight")) / 2.0 + col(out, "jawOpen")


def peaks_above(x: np.ndarray, thr: float) -> set:
    idx: set = set()
    n = len(x)
    for i in range(n):
        if x[i] <= thr:
            continue
        left = x[i - 1] if i > 0 else float("-inf")
        right = x[i + 1] if i < n - 1 else float("-inf")
        if x[i] >= left and x[i] >= right and (x[i] > left or x[i] > right):
            idx.add(i)
    return idx


def stressless(phone: str) -> str:
    p = phone.strip().upper()
    while p and p[-1] in "012":
        p = p[:-1]
    return p


def main() -> None:
    sess = ort.InferenceSession(str(CACHE / "wav2arkit_cpu.onnx"), providers=["CPUExecutionProvider"])
    clips = {
        "pangram": CACHE / "pangram.16k.wav",
        "viseme-words": CACHE / "viseme-words.16k.wav",
        "i-feel-the-pain-is-better-now": CACHE / "i-feel-the-pain-is-better-now.16k.wav",
        "oov-give-the-albuterol-now": CACHE / "oov.16k.wav",
    }
    audio = {k: load_mono_float32(p) for k, p in clips.items()}

    # Silence baseline: 1 s of digital zeros through the same session.
    sil_out = sess.run(None, {"audio_waveform": np.zeros((1, 16000), dtype=np.float32)})[0][0]
    c_thr = float(np.percentile(closure_sig(sil_out), 95))
    l_thr = float(np.percentile(labio_sig(sil_out), 95))
    sil_act = activity_sig(sil_out)
    sil_act_p95 = float(np.percentile(sil_act, 95))
    sil_act_mean = float(sil_act.mean())

    # MFA reference cues.
    pangram_m = json.loads((REPO / "docs/openclinxr/mouth-dynamics/viseme-eval/pangram/metrics.json").read_text())
    words_m = json.loads((REPO / "docs/openclinxr/mouth-dynamics/viseme-eval/viseme-words/metrics.json").read_text())
    step3_cues = json.loads((CACHE / "step3-cues.json").read_text())
    mfa: dict = {
        "pangram": [{"startS": c["startS"], "endS": c["endS"], "phone": c["phone"]} for c in pangram_m["mfa"]],
        "viseme-words": [{"startS": c["startS"], "endS": c["endS"], "phone": c["phone"]} for c in words_m["mfa"]],
        "i-feel-the-pain-is-better-now": step3_cues,
    }

    # Timed runs: 20 per clip, one clip at a time (shared loaded machine).
    walls: dict = {k: [] for k in clips}
    outs: dict = {}
    for clip, wav in audio.items():
        for _ in range(RUNS):
            t0 = time.perf_counter()
            out = sess.run(None, {"audio_waveform": wav.reshape(1, -1)})[0][0]
            walls[clip].append(time.perf_counter() - t0)
        outs[clip] = sess.run(None, {"audio_waveform": wav.reshape(1, -1)})[0][0]

    def s2f(t: float) -> int:
        return int(round(t * FPS))

    per_clip = []
    for clip, cues in mfa.items():
        out = outs[clip]
        clos = closure_sig(out)
        lab = labio_sig(out)
        c_peaks = peaks_above(clos, c_thr)
        l_peaks = peaks_above(lab, l_thr)
        ch = ct = lh = lt = 0
        for cue in cues:
            ph = stressless(cue["phone"])
            a0 = max(0, s2f(cue["startS"]) - 2)
            b0 = min(len(clos), s2f(cue["endS"]) + 2)
            if ph in ("P", "B", "M"):
                ct += 1
                if any(f in c_peaks for f in range(a0, b0)):
                    ch += 1
            if ph in ("F", "V"):
                lt += 1
                if any(f in l_peaks for f in range(a0, b0)):
                    lh += 1
        act = activity_sig(out)
        d = np.abs(np.diff(act, prepend=act[0]))
        errs = []
        for cue in cues:
            c = s2f(cue["startS"])
            lo, hi = max(0, c - 9), min(len(d), c + 9 + 1)
            e = int(np.argmax(d[lo:hi]) + lo)
            errs.append(abs(e - c))
        per_clip.append({
            "clip": clip,
            "closureHits": ch,
            "closureTotal": ct,
            "labiodentalHits": lh,
            "labiodentalTotal": lt,
            "onsetMedianFrames": float(np.median(errs)),
            "onsetP95Frames": float(np.percentile(errs, 95)),
        })

    pooled_rtf = []
    per_clip_timing = {}
    for clip, wav in audio.items():
        dur = len(wav) / 16000.0
        rtfs = sorted(dur / w for w in walls[clip])
        per_clip_timing[clip] = {
            "audioS": dur,
            "frames": int(outs[clip].shape[0]),
            "wallP50": float(np.percentile(walls[clip], 50)),
            "wallP95": float(np.percentile(walls[clip], 95)),
            "rtfP50": float(np.percentile(rtfs, 50)),
            "rtfP95": float(np.percentile(rtfs, 95)),
        }
        if clip != "oov-give-the-albuterol-now":
            pooled_rtf.extend(rtfs)

    oov_act_mean = float(activity_sig(outs["oov-give-the-albuterol-now"]).mean())

    result = {
        "candidate": "wav2arkit_cpu",
        "formulas": {
            "closure": "mouthClose - jawOpen",
            "labiodental": "(mouthRollLower + mouthLowerDownLeft + mouthLowerDownRight) / 3",
            "onsetEvent": "argmax |activity(t)-activity(t-1)| in [onset-9f, onset+9f], activity=(mouthLowerDownLeft+mouthLowerDownRight)/2+jawOpen",
            "peak": "local maximum strictly above the 1 s digital-silence p95 of the same signal",
            "hitWindow": "[round(start*30)-2, round(end*30)+2)",
        },
        "silence": {"closureP95": c_thr, "labiodentalP95": l_thr, "activityMean": sil_act_mean, "activityP95": sil_act_p95},
        "perClip": per_clip,
        "timing": per_clip_timing,
        "rtf": {"p50": float(np.percentile(pooled_rtf, 50)), "p95": float(np.percentile(pooled_rtf, 95))},
        "oov": {"clip": "oov-give-the-albuterol-now", "activityMean": oov_act_mean, "active": bool(oov_act_mean > sil_act_p95)},
    }
    (HERE / ".cache" / "measure.json").write_text(json.dumps(result, indent=2) + "\n")

    lines = []
    for row in per_clip:
        lines.append({"type": "clip", **row})
    lines.append({"type": "rtf", **result["rtf"]})
    lines.append({"type": "oov", "active": result["oov"]["active"], "activityMean": oov_act_mean,
                  "silenceActivityP95": sil_act_p95})
    with (HERE / "results.jsonl").open("w") as f:
        for row in lines:
            f.write(json.dumps(row) + "\n")

    # MFA cue bundle for the record (small, committed).
    bundle = {
        "pangram": {"source": "docs/openclinxr/mouth-dynamics/viseme-eval/pangram/metrics.json (.mfa)",
                    "cues": mfa["pangram"]},
        "viseme-words": {"source": "docs/openclinxr/mouth-dynamics/viseme-eval/viseme-words/metrics.json (.mfa)",
                         "cues": mfa["viseme-words"]},
        "i-feel-the-pain-is-better-now": {"source": ".cache/step3.TextGrid (MFA 3.4.2 live run, this card)",
                                          "cues": mfa["i-feel-the-pain-is-better-now"]},
    }
    (HERE / "mfa-cues.json").write_text(json.dumps(bundle, indent=2) + "\n")
    print(json.dumps({**result["rtf"], "oovActive": result["oov"]["active"]}, indent=2))


if __name__ == "__main__":
    main()
