# Cagematch — kimodo.cpp as a build-time motion-generation station

Date: 2026-08-23
Question: can `https://github.com/localai-org/kimodo.cpp` generate motion clips this project could
use as a **factory station** (build-time clip generation, not a runtime component), per operator
direction D14?

---

## VERDICT: `reject_measured`

**One sentence:** kimodo.cpp carries **no licence file at all** and the only checkpoint it implements
is under a licence that forbids production use and forbids generating works for distribution, and
separately its build **fails to link on this Apple Silicon machine** because the text encoder and the
weight loader call Vulkan entry points unconditionally — so it cannot be legally used for a shipped
exam even if the build were fixed.

Two independent refusals, either sufficient on its own. The licence one is the load-bearing one: it
would still stand on a machine where the build succeeded.

`reject_measured` and not `inconclusive_blocked` because experiments **executed**: the repository was
cloned and audited, CMake configured, the build ran, and the failure has a named cause with a captured
linker diagnostic. Inference was not used where measurement was available.

---

## 1. Licence — the primary refusal

### 1a. The port itself is UNLICENSED

There is no LICENSE file to quote. That is the finding.

Measured on a clone of `2558baec654c356c4f3d809eea5c6f6b184e9681` (`git clone --depth 1`, 2026-08-23):

```
$ find . -iname 'LICENS*' -o -iname 'COPYING*' -o -iname 'NOTICE*'
./NOTICE
```

```
$ gh api repos/localai-org/kimodo.cpp --jq '.license'
null
```

Source-header audit across `*.cpp *.h *.py *.sh *.go`: **0 files** contain `SPDX` or `Copyright`.

The entire `NOTICE` file, quoted verbatim (`NOTICE`, 5 lines):

```
kimodo.cpp

This project uses ggml, Copyright the ggml authors:
https://github.com/ggml-org/ggml

The demo displays the LocalAI logo from the LocalAI project:
https://github.com/mudler/LocalAI
```

That grants nothing. It is an attribution notice for a vendored dependency, not a licence for
kimodo.cpp. Absent an express grant, default copyright applies: all rights reserved. **Unlicensed is
strictly worse than AGPL for us** — with AGPL there is a grant whose conditions we decline; here there
is no grant to accept.

This is the failure mode `PROTO_CURIOUS_RESEARCHER` names directly — *licence status with CC0/CC-BY as
the bar, and unspecified is a refusal*. It is also why this cagematch checked the file rather than the
README: the README makes no licence claim at all, and the repo is **~25 hours old** (created
`2026-08-22T20:26:58Z`, 166 stars), which is the profile of a project that has not yet decided.

Vendored `ggml` is MIT (`ggml/LICENSE`, *"MIT License / Copyright (c) 2023-2026 The ggml authors"*).
That covers ggml, not the port.

### 1b. The checkpoint forbids exactly what we would do with it

kimodo.cpp implements one checkpoint: `Kimodo-SMPLX-RP-v1`. Its own `PORTING.md:6-8` says so:

> "It is an **R&D-licensed checkpoint**, so distribution and test-download automation must preserve
> the upstream licence gate."

Upstream `nv-tlabs/kimodo` states the codebase is Apache-2.0 but that *"model checkpoints and data are
licensed separately"* — weights are NVIDIA Open Model License **except Kimodo-SMPLX-RP-v1**, which is
the **NVIDIA Internal Scientific Research and Development Model License**. That licence grants:

> "a limited, worldwide, non-exclusive, no-charge, royalty-free, revocable license to install, use,
> reproduce, prepare Derivative Models, and configure the Model **for the sole purpose of Your
> internal, scientific research and development and in a non-production environment**."

and restricts:

> "The Model and any Derivative Model **may not be distributed, deployed, sublicensed, publicly
> displayed, publicly performed** ... You **may not use the Model or a Derivative Model in a production
> environment or for the purpose of generating works for sale or distribution**."

Source: `https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-internal-scientific-research-and-development-model-license/`;
model card `https://huggingface.co/nvidia/Kimodo-SMPLX-RP-v1` (gated) states *"for non-commercial
research use only."*

A build-time factory station that bakes generated clips into shipped encounter assets is **precisely**
"generating works for ... distribution" from a model used in a production pipeline. The build-time /
runtime distinction that makes this attractive under D9 does **not** rescue it under this licence: the
licence restricts the *works generated*, not only the *inference process*. The generated clip is the
problem, and the clip is the whole point.

**FLAGGED FOR THE LEAD — licence-ledger rows I did not write** (another lane owns
`third-party-asset-licence-ledger.md`; per instruction I state them here instead):

| candidate | finding | bar |
|---|---|---|
| `localai-org/kimodo.cpp` (code) | **NO LICENCE FILE**; GitHub `license: null`; 0 SPDX headers; NOTICE grants nothing | **REFUSE — unspecified** |
| `nvidia/Kimodo-SMPLX-RP-v1` (weights) | NVIDIA Internal Scientific R&D Model License — non-production, no works for distribution | **REFUSE — non-commercial** |
| `meta-llama/Meta-Llama-3-8B-Instruct` (required text encoder) | Llama 3 Community License; gated; bespoke terms + acceptable-use policy | not OSI-open; not reached |
| `McGill-NLP/LLM2Vec-*-mntp{,-supervised}` (required adapters) | gated; not assessed | not reached |

### 1c. The category-level finding, worth more than this one repo

Most text-to-motion research models are trained on **AMASS / HumanML3D**, which are *"publicly released
under research licenses prohibiting commercial use"* (AMASS: non-commercial scientific research only,
commercial terms via `ps-licensing@tue.mpg.de`). NVIDIA's Kimodo is one of the few that deliberately
escaped that — it trained on Bones Rigplay 1, described as commercially-friendly mocap — and the
checkpoint we would need is R&D-gated **anyway**.

So the refusal here is not bad luck with one port. **Before spending another cagematch on a
text-to-motion generator, check the training-data licence first** — it kills the category faster than
any build does, and it is a five-minute check.

---

## 2. Platform and build reality on Apple Silicon without CUDA

Machine: macOS 26.5.2, arm64 (M1 Max), Xcode 26.5 SDK. No CUDA anywhere in the stack — irrelevant, as
kimodo.cpp has no CUDA path either. The relevant backend gap is **Vulkan**, not CUDA.

### 2a. The sanctioned build path structurally excludes macOS

`flake.nix:6`:

```nix
systems = [ "x86_64-linux" "aarch64-linux" ];
```

No `aarch64-darwin`. Every command in the README is `nix develop path:. --command …`, so the documented
build cannot evaluate on this machine. The `shellHook` confirms the assumption — it exports
`LD_LIBRARY_PATH` and `/run/opengl-driver/lib`, both Linux-only conventions. `nix` is not installed
here either.

### 2b. Configuring outside Nix works; **building fails**

I bypassed Nix and drove CMake directly (`cmake 3.29.0` from Homebrew; Ninja absent, so Unix Makefiles),
with Vulkan explicitly off and weight-dependent tests off:

```
cmake -S . -B build/cpu -DCMAKE_BUILD_TYPE=Release \
      -DKIMODO_ENABLE_VULKAN=OFF -DKIMODO_BUILD_TESTS=OFF
```

**Configure: exit 0.** ggml detected the platform correctly and enabled Accelerate BLAS and — notably —
its own **Metal** backend (`-- Metal framework found / -- Including METAL backend`, ggml 0.20.2,
commit `8c63e70`).

**Build: exit 2.** `libkimodo.a` compiled (216 KB, 11 exported `kimodo_*` symbols). Every
inference-capable binary failed to link:

```
ld: library 'ggml-vulkan' not found          × 5 targets
```

failing `kmd-sample-fixture`, `kimodo-llm-embedding-parity`, `kimodo-llm-final-norm-parity`,
`kimodo-llm-layer-parity`, `kimodo-llm-text-session-parity`. Building the two CLI tools alone fails
differently and more informatively:

```
Undefined symbols for architecture arm64:
  "_ggml_backend_vk_get_device_count", referenced from:
      kimodo::detail::llm_text_encoder::load(...) in libkimodo.a[11](llm_text_encoder.cpp.o)
  "_ggml_backend_vk_init", referenced from:
      kimodo::detail::llm_text_encoder::load(...) in libkimodo.a[11](llm_text_encoder.cpp.o)
```

`kmd-generate` and `kmd-inspect` therefore **do not exist on this machine**.

### 2c. Root cause — Vulkan is mandatory, not optional

Two call sites reference the Vulkan backend with **no preprocessor guard**, in files compiled into
`libkimodo` whenever ggml is present (`CMakeLists.txt:46`, which sits inside the GGML block but outside
the `if(KIMODO_ENABLE_VULKAN AND TARGET ggml-vulkan)` guard):

- `src/llm_text_encoder.cpp:219` — `if (use_vulkan() && ggml_backend_vk_get_device_count()) … ggml_backend_vk_init(0)`
- `src/ggml_weights.cpp:79` — `if (ggml_backend_vk_get_device_count() > 0) … ggml_backend_vk_init(0)`

The first is the prompt→embedding stage — the entire text-to-motion entry point. The second is the
**denoiser weight loader**, so this is not confined to the text encoder. Five further targets are
hard-linked against `ggml-vulkan` in `CMakeLists.txt` outside the same guard.

The README's "on CPU or Vulkan" is a **runtime** switch (`KIMODO_BACKEND` env, `llm_text_encoder.cpp:33`)
on a build that must still link Vulkan. `KIMODO_ENABLE_VULKAN=OFF` produces a library that cannot be
linked into anything.

**Honest note on how hard this would be to fix:** not very. Two `#ifdef` guards plus a backend-selection
branch would make it backend-agnostic, and ggml's Metal backend already builds here unprompted. A
MoltenVK route also exists (MoltenVK is Apache-2.0; `glslc`/Vulkan SDK are absent here and would be
needed). **I did not attempt either, deliberately** — patching an unlicensed codebase to run a
non-commercial model is effort spent on something we still could not ship. The build failure is real
and measured; it is the *second* reason, not the first.

### 2d. Weights would exceed the download budget by ~50×

`scripts/download_weights.sh` pulls four gated repositories:

| repo | role | size |
|---|---|---|
| `nvidia/Kimodo-SMPLX-RP-v1` | motion denoiser (282 M params) | ~1 GB |
| `meta-llama/Meta-Llama-3-8B-Instruct` | LLM2Vec base, **bfloat16** | **~16 GB** |
| `McGill-NLP/LLM2Vec-…-mntp` | LoRA adapter | small |
| `McGill-NLP/LLM2Vec-…-mntp-supervised` | LoRA adapter | small |

**>17 GB total, behind three separate licence acceptances and `hf auth login`.** My instruction caps
unrequested downloads at a few hundred MB, so **I did not download any weights** and am not requesting
them: the licence refusal makes the request moot. `PORTING.md` corroborates the encoder cost —
*"The upstream README's approximately 17 GB all-GPU figure is primarily the 8B bfloat16 LLM2Vec text
encoder."*

Note the shape of that dependency: an 8-billion-parameter **LLM sits inside the generator**. Under D9
that is acceptable at build time (its output is frozen into a clip), but it is worth naming plainly —
this is not a small deterministic tool, it is a 17 GB two-stage model stack.

---

## 3. Output, and whether it retargets onto our rigs

**What it emits.** `kimodo_generate` / `kimodo_generate_embedding` return, per the README and
`include/kimodo/kimodo_capi.h`, *"SMPL-X22 root translations and local XYZW rotations"* — raw
quaternion arrays over 22 SMPL-X body joints, in memory, through a C API.

**What it does not emit.** README, verbatim: *"Constraints, SOMA, G1, **GLB export**, and quantised
models are **not implemented yet**."* `PORTING.md` lists *"skeletal GLB export"* at milestone 3 of 5.
There is no BVH writer, no glTF writer, no FBX writer — measured, not merely read:

```
$ grep -rIil -e 'bvh' -e 'gltf' -e 'glb' -e 'fbx' src/ include/
(no matches)
```

The full output surface of the C API is four accessors over raw float arrays
(`include/kimodo/kimodo_capi.h:102-106`): `kimodo_motion_frames`, `kimodo_motion_joints`,
`kimodo_motion_local_rotations_xyzw`, `kimodo_motion_root_positions`. The demo renders in a Go web
page.

So the interchange this project needs — BVH or glTF animation — **does not exist in the port today**.
Consuming it would mean writing our own SMPL-X22-quaternions → BVH/glTF exporter first.

**Would the retarget work if that existed?** Plausibly, and this is the one genuinely attractive part.
Our maps are name→name with a fingerprint:

- `known-rigs/mesh2motion-human-66.json` — 66 measured source joints, e.g. `pelvis→hips`,
  `clavicle_l→shoulder.L`, `upperarm_l→upper_arm.L`
- `known-rigs/mpfb2-default-no-toes.json` — MPFB2 standard armature

SMPL-X22 is a clean, well-documented, standard hierarchy and a `smplx22→mpfb2` map would be an ordinary
third entry beside those two. **22 joints is also a good match for our canonical 23-bone runtime rig** —
notably better than Mesh2Motion's finger-heavy 66, which MADR 0036 declined partly on that basis. Root
translation plus local rotations is exactly what our BVH retarget lab already consumes.

**NOT MEASURED:** I never generated a clip, so I have graded no motion. Whether the output is
clinically plausible — a patient shifting on an exam table, guarding a painful abdomen, a parent
leaning in — is completely unknown and unknowable from this investigation.

---

## 4. Comparison against the alternatives

### 4a. My brief's premise about Mesh2Motion was stale — correcting it here

The brief for this cagematch said *"Mesh2Motion is approved and unused; it was declined for being
browser-only with no API."* The repo already corrects that, and I am recording it so the next reader
does not inherit the stale version:

- `third-party-asset-licence-ledger.md:25` explicitly corrects `PROTO_VERIFY_DELEGATION`, which *"still
  calls Mesh2Motion 'approved, preferred and unused (#70)'"* — **MADR 0036/0052 declined it as the
  pipeline *rigger*; the *clip library* is a separate and salvageable thing.**
- The clip library is **CC0-1.0, VERIFIED, and already on disk** at
  `~/.openclinxr-tools/mesh2motion-app` — both `LICENSE-MIT.MD` (code) and `LICENSE-CC0.MD` (*"All 3d
  models, blend files, rigs, animations / CC0 1.0 Universal"*) are present.
- I counted them: `static/animations/human-base-animations.glb`, 5.7 MB, **87 named clips**.

### 4b. A deterministic motion station already works here

`docs/openclinxr/bvh-retarget-lab-smoke-2026-08-05.json` records CMU BVH clips bound onto
`ed_chest_pain_patient_adult_bod` and measured live: `walking` explodeRatio **0.986**, motionRange
**0.359 m**, `animating: true`, 169 joints, 0 page errors; `running` explodeRatio 0.968. The ledger
names `cmu_07_01_walk.BVH` as the proven bind and an hm08-native BVH as first choice ahead of
Mesh2Motion.

**That is a working, licence-clean, LLM-free, deterministic motion station.** D9 asks for the motion row
to move from "hand-tuned eulers" to "retargeted clips" — and a retarget path is landed and measured.
The premise that this is an empty hole is not accurate; the hole is narrower than it looked.

### 4c. The honest case FOR a generator, which I am not dismissing

The 87 CC0 clips are a **game-action** library. The full list includes `Sword_Attack`, `Zombie_Walk`,
`Pistol_Shoot`, `Chop_Tree`, `Farm_PlantSeed`. Clinically usable candidates number roughly a dozen:
`Idle_A`, `Idle_FoldArms`, `Idle_Talking`, `Idle_TalkingPhone`, `Sitting_Idle`, `Sitting_Talking`,
`Sitting_Enter`, `Sitting_Exit`, `LayToIdle`, `Walk`, `Walk_Formal`, `Yes`. Nothing named supine,
Fowler, bed-rest, guarding, splinting, or respiratory distress.

So library retargeting genuinely **cannot** cover clinical-specific motion, and text-prompt synthesis
genuinely would. That is a real gap and a real argument — it just does not license this candidate.

### 4d. Ranking

| candidate | licence | runs here | output usable | verdict |
|---|---|---|---|---|
| **CMU/hm08 BVH → retarget lab** (current) | clean | **yes, measured** | GLB clips, bound and animating | **keep — this is the station** |
| **Mesh2Motion CC0 clip library** | CC0-1.0 verified | on disk | 87 clips, ~12 clinically usable | keep as second source; harvest the dozen |
| hand-tuned eulers | n/a | yes | works, not reproducible per D9 | retire per clip as retarget covers it |
| **kimodo.cpp** | **none (code) + non-commercial (weights)** | **no — link failure** | no GLB/BVH exporter exists | **reject** |

**Pick: none of the new candidates. Keep the BVH retarget station and widen its clip sources.** The
next motion slice should be *"harvest the ~12 clinically usable CC0 clips and bind them"* or
*"find a commercially-licensed clinical mocap source"*, not *"stand up a text-to-motion model"*.

---

## 5. What I did NOT test — stated explicitly

- **No inference. No clip was generated.** No weights were downloaded (>17 GB, gated, three licence
  acceptances). Every statement about output format comes from the README, `PORTING.md`, the C API
  header and the CMake graph — **not** from a running binary.
- **No motion quality grade.** Nothing was rendered, so nothing was pixel-graded. I have no opinion on
  whether Kimodo's motion looks like a human, let alone like a patient.
- **No MoltenVK attempt**, and **no patching of the two unguarded Vulkan call sites** to reach a Metal
  or CPU-only build. Both are plausible and were declined on purpose (§2c).
- **No Linux attempt.** The flake targets `x86_64-linux` / `aarch64-linux`; it may well build cleanly
  there. This finding is scoped to this machine.
- **No Ninja.** Ninja is absent, so the documented presets were not used; I substituted Unix Makefiles.
  The link failure is a missing-library and undefined-symbol failure, not a generator artefact, but the
  presets were not exercised as written.
- **The Llama 3 and LLM2Vec adapter licences were not read**, only identified. The chain stopped at the
  first refusal.
- **`Kimodo-SOMA-RP-v1.1`** (77-joint, possibly Open Model License rather than R&D) was **not
  evaluated**. `PORTING.md` names it as the future default-quality target and it is **not implemented**
  in kimodo.cpp. If NVIDIA's Open Model License permits production use, a future port of that
  checkpoint would need its own look — the code-licence refusal (§1a) would still stand.
- **No retarget was attempted** from SMPL-X22 onto either known rig. §3's claim that it would map
  cleanly is **reasoned from joint counts and naming, not measured.**

## 6. Reproduction and cleanup

```sh
git clone --depth 1 https://github.com/localai-org/kimodo.cpp   # 880 KB, HEAD 2558bae
cd kimodo.cpp && git submodule update --init --recursive --depth 1   # ggml, 28 MB
cmake -S . -B build/cpu -DCMAKE_BUILD_TYPE=Release \
      -DKIMODO_ENABLE_VULKAN=OFF -DKIMODO_BUILD_TESTS=OFF   # exit 0
cmake --build build/cpu -j8                                  # exit 2, ld: library 'ggml-vulkan' not found
```

Working tree was `/tmp/kimodo-cage` (outside the repo). Nothing was installed on this machine; no
weights were downloaded; no repo file outside this document was modified.

---

`claimScope`: licence status of `localai-org/kimodo.cpp` and `nvidia/Kimodo-SMPLX-RP-v1` as published
on 2026-08-23; CMake configure and build outcome for that exact commit on one macOS 26.5.2 arm64
machine without Nix, Ninja or Vulkan; the presence, count and CC0 status of the on-disk Mesh2Motion
clip library; the existence of prior measured BVH retarget evidence in this repo.

`notEvidenceFor`: the quality, realism or clinical plausibility of Kimodo motion output (never
generated); its buildability or performance on Linux (never attempted); whether a patched Metal or
MoltenVK build would work (never attempted); the licence terms of Llama 3 or the LLM2Vec adapters
(identified, not read); the suitability of `Kimodo-SOMA-RP-v1.1` (unimplemented, unevaluated); whether
SMPL-X22 in fact retargets onto our rigs (reasoned, not measured); and any clinical, diagnostic or
exam-equivalence claim whatsoever.
