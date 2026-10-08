# NOTICE — viseme-audio-clock wav2arkit bake-off

Arena-only trial. Every promotion gate stays false. No production, Quest, or clinical claim.

## Model files (gitignored cache, never committed)

| File | Source URL | Version / revision | Licence | sha256 |
|---|---|---|---|---|
| `wav2arkit_cpu.onnx` (1.8 MB) | https://huggingface.co/myned-ai/wav2arkit_cpu | git revision `48b7d27a147d4dfcce4c8225b11209ce4cd76e05`, last modified 2026-02-22 | **Apache-2.0** per the HF card metadata (`cardData.license`) and README "License: Apache 2.0". No LICENSE file ships in the HF repo (siblings: `.gitattributes`, `README.md`, `arch_diagram.png`, `config.json`, `wav2arkit_cpu.onnx`, `wav2arkit_cpu.onnx.data`); the Apache-2.0 grant is the card + README statement. | `cdecbfad3915dd20b2f0718942d0b8894b2ee11edcc5a9a9da45d29a46af2ed9` |
| `wav2arkit_cpu.onnx.data` (383 MB external weights) | https://huggingface.co/myned-ai/wav2arkit_cpu | same revision as above | Same Apache-2.0 card claim (required at load; session fails without it). | `c0f0364673c6e50be126b193e2b56809c16ac6bee4805aea9b8251ce53429bf8` |
| Base model `3DAIGC/LAM_audio2exp` (upstream only, not downloaded) | https://huggingface.co/3DAIGC/LAM_audio2exp | card licence field | **Apache-2.0** (HF API `cardData.license`) | n/a (not in tree) |
| Base model `facebook/wav2vec2-base-960h` (upstream only, not downloaded) | https://huggingface.co/facebook/wav2vec2-base-960h | card licence field | **Apache-2.0** (HF API `cardData.license`) | n/a (not in tree) |

No CC BY-SA material. No weights committed to git (both files live under `.cache/`, covered by this folder's `.gitignore`).

## Libraries (installed inside this folder's `venv/`, never root deps)

| Name | Version | URL | Licence |
|---|---|---|---|
| `onnxruntime` (CPU) | 1.30.0 | https://onnxruntime.ai / https://pypi.org/project/onnxruntime/ | **MIT License** (pip metadata `License: MIT License`) |
| `numpy` | 2.5.3 | https://numpy.org / https://pypi.org/project/numpy/ | **BSD-3-Clause** (pip metadata `License-Expression: BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`; the package licence is BSD-3-Clause) |

Audio decode used only Python stdlib `wave` plus `ffmpeg`/`say` system tools; no `soundfile`/`librosa` (licence surface kept to the two rows above).

## Audio provenance

| Clip | Command / source | sha256 |
|---|---|---|
| `pangram.aiff` (fixture) | repo fixture `tools/openclinxr/evidence/parent-fitted-teeth/visemes/pangram.aiff` | `b181995195273129f0b5e8ed34d18664fba43821f1e98f0b9c9508730749435e` |
| `viseme-words.aiff` (fixture) | repo fixture `.../visemes/viseme-words.aiff` | `54abeaa9e4403c67686c7e79e959f0a3eaa33905872048f6015b2f9bd2dde3fb` |
| `i-feel-the-pain-is-better-now.aiff` (fixture) | repo fixture `.../visemes/i-feel-the-pain-is-better-now.aiff` | `61ab9f373343cf3c30d8e283cdb8326c58976437fb673e037602ae2684b541c0` |
| OOV `oov-samantha.aiff` (this card) | `say -v Samantha -r 100 -o apps/arena/viseme-audio-clock/wav2arkit/oov-samantha.aiff "Give the albuterol now."` | `71b3c9b7f6e982e1b0027fb514bba53e280c72d01978c8b1122eb2c12c435f2d` |
