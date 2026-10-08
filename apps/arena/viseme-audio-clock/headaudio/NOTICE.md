# Licences — viseme audio-clock bake-off

Arena-only evaluation. No code or model from these sources is wired into any runtime or package.

| Name | Licence | URL | Version |
|---|---|---|---|
| HeadAudio (code: modules, dist JS) | MIT (Copyright (c) 2025 Mika Suominen) | https://github.com/met4citizen/HeadAudio | commit d3af5f9, package 0.1.0 |
| HeadAudio English model `model-en-mixed.bin` (14,352 bytes, sha256 0358f68989b5861f9b7d18871b010fa6cbf88a53bda4954a954d8c548bbcf251) | MIT per repo root LICENSE (shipped in the same repo; trained by the author from HeadTTS/Kokoro synthetic Harvard sentences — upstream voice data not shipped) | https://github.com/met4citizen/HeadAudio/tree/main/dist | same commit d3af5f9 |
| wawa-lipsync (bundled from source, no model file — pure DSP/FSM) | MIT (Copyright (c) 2025 Wassim SAMAD) | https://github.com/wass08/wawa-lipsync | commit 312dc31, package 0.0.2 |

Model weights live only under `cache/` (gitignored) and are never committed. No CC BY-SA material. No GPL/AGPL material.
