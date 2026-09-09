---
title: Cagematch — Kimodo-SOMA-RP-v1.1 as a learned motion provider
authority: evidence
scope: motion
last-updated: 2026-09-09
relates-to: docs/openclinxr/humanoid-scene-layout-research-brief-2026-09-09.md, docs/openclinxr/kimodo-cpp-cagematch-2026-08-23.md
---

# Cagematch — Kimodo-SOMA-RP-v1.1 as a learned motion provider

Date: 2026-09-09
Question: does `nvidia/Kimodo-SOMA-RP-v1.1` clear the brief's §7 step 6 filters — required motion
controls, then the exact code/checkpoint/encoder/body/data/output manifest, then a verified local
or otherwise authorized execution path?

---

## VERDICT: `reject_measured` — retain the baseline

**One sentence:** the code and the checkpoint state DIFFERENT output skeletons — the repository
README says 77 joints, the model card says 30 — so the manifest filter fails on a measured
contradiction rather than on an absence, and the brief's rule applies: "No eligible provider or no
demonstrated benefit means retain the baseline."

This closes step 6. A negative cagematch result is a successful cagematch, and the brief says so.

---

## FIRST, a correction that could have closed this wrongly

`docs/openclinxr/kimodo-cpp-cagematch-2026-08-23.md` already carries a `reject_measured` verdict for
"kimodo". **It is about a different artifact.** That record examines
`https://github.com/localai-org/kimodo.cpp`, an unlicensed community C++ port. The brief names
`https://github.com/nv-tlabs/kimodo` and `https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.1`, which
are NVIDIA's own repository and weights and carry real licences.

Reusing the port's rejection here would have been the "quoter is not a source" failure: a
same-named artifact, a ready verdict, and the wrong subject. The two are recorded separately on
purpose.

---

## Filter 1 — required motion controls

NOT ASSESSED. The filters are ordered and filter 2 fails, so assessing controls would be work spent
on a candidate already refused. Recorded as unassessed rather than passed.

## Filter 2 — the exact manifest: **FAILS**

Measured 2026-09-09 by reading both surfaces:

| surface | what it states | licence |
|---|---|---|
| `nv-tlabs/kimodo` README | *"Model inputs/outputs now use the SOMA 77-joint skeleton (`somaskel77`)"*, marked **Breaking** | Apache-2.0 |
| `nvidia/Kimodo-SOMA-RP-v1.1` model card | Joint Rotations `num_frames x 30 x 3 x 3` — a 30-joint SOMA skeleton | NVIDIA Open Model License, "ready for commercial use" |

**77 against 30, for what the brief treats as one artifact.** The brief anticipated exactly this:
"its README describes `somaskel77` while the model card describes 30-joint outputs; their exact
relationship remains unverified." It is no longer unverified. It is verified as a contradiction.

**Why that is disqualifying rather than a detail.** The brief requires the MPFB mapping to be
pinned, and a retargeting map is a per-joint correspondence. A map cannot be written against an
output whose joint count is either 30 or 77 depending on which document you believe, and a map
written against the wrong one produces a skeleton that loads, plays, and is anatomically wrong —
the failure class this repo has already paid for with head-down humanoids that passed every
mechanical gate.

**The likely explanation is NOT recorded as a finding.** README "Breaking" language suggests the
repository has moved to a newer skeleton than the v1.1 checkpoint. That is inference. What would
settle it: download the safetensors and read the actual output tensor shape, or find an NVIDIA
statement pinning the v1.1 checkpoint to a named skeleton revision. Neither was done here.

## Filter 3 — a verified execution path: **NOT ESTABLISHED**

The README states *"Kimodo requires ~17GB of VRAM to generate locally entirely on GPU"* and names
GeForce RTX 3090 / 4090 and A100 as tested. `TEXT_ENCODER_DEVICE=cpu` reduces the requirement to
"<3 GB VRAM" — that moves the text encoder off the GPU, it does not remove the GPU.

This project's primary machine is an M1 Max with no CUDA device. **No local execution was
attempted**, so this is recorded as NOT ESTABLISHED rather than as a measured failure. Filter 2
already refuses the candidate; running a model whose output skeleton is ambiguous would produce
motion nobody could map.

---

## Decision

**Retain the baseline.** Kimodo-SOMA-RP-v1.1 is not adopted, and it is not rejected on licence
grounds — the NVIDIA Open Model License permits commercial use and the code is Apache-2.0, which is
a materially better position than the C++ port's. It is refused on manifest ambiguity, which is
fixable upstream.

**What would reopen this**, in the order it would have to be settled:

1. A pinned statement of which skeleton the **v1.1 checkpoint** emits, or a direct read of the
   safetensors output shape.
2. A joint-by-joint MPFB correspondence for that skeleton, written against the pinned revision.
3. An authorized execution path reachable from this project's hardware.

## claimScope / notEvidenceFor

**claimScope:** the manifest agreement and licence posture of `nv-tlabs/kimodo` and
`nvidia/Kimodo-SOMA-RP-v1.1` as published on 2026-09-09.

**notEvidenceFor:** motion quality, anatomical plausibility, Quest performance, any statement about
other Kimodo checkpoints, and any statement about `localai-org/kimodo.cpp`, which has its own
record. No weights were downloaded and no inference was run.
