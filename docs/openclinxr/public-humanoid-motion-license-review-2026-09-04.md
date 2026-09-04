# Public Humanoid Motion License Review

Date: 2026-09-04

Decision: **cleared for the narrowly cropped public movement artifact** at
`docs/assets/mpfb-parent-upper-body-motion-2026-09-04.webm`. This is a project
publication decision and is not legal advice.

## Cleared Chain

| Element visible or expressed | Source | Basis | Decision |
| --- | --- | --- | --- |
| Exported humanoid body | MakeHuman / MPFB export | MakeHuman Community states exported models are CC0 and may be used in video productions | Cleared |
| Bob hair | `toigo_blunt_bob_with_bangs` | Per-asset CC0 header; recorded in the repository license ledger | Cleared |
| T-shirt | `toigo_basic_tucked_t-shirt` | Per-asset CC0 header; recorded in the repository license ledger | Cleared |
| Skeletal motion | Mesh2Motion seated/talking BVH | Upstream `LICENSE-CC0.md` covers models, rigs, and animations; recorded in the repository license ledger | Cleared |
| Browser capture and crop | OpenClinXR evidence tooling and ffmpeg | Project-generated evidence | Cleared |

Primary upstream references:

- [MakeHuman licensing](https://static.makehumancommunity.org/about/license.html)
- [MakeHuman exported-model FAQ](https://static.makehumancommunity.org/oldsite/faq/can_i_sell_models_created_with_makehuman.html)
- [Mesh2Motion source repository](https://github.com/Mesh2Motion/mesh2motion-app)

## Exclusions

The source GLB contains `cortu_cargo_pants`. The repository ledger records a CC0
catalog/index assertion, while the item's own staged files do not independently
establish that license and include conflicting boilerplate. The public artifact is
therefore cropped above that geometry. This review does not clear the cargo-pants
source for redistribution.

The `makehuman-visemes02` provenance remains unresolved. No viseme or speaking
footage is included or cleared by this decision.

## Reproducibility

The adjacent provenance JSON records SHA-256 hashes for the published WebM, source
capture, animated GLB, and BVH. The publication transform is a spatial crop plus
30 fps VP9 transcode with audio removed. The clip demonstrates upper-body rig
movement only; it does not establish production animation, cloth behavior, Quest
readiness, clinical validity, or exam equivalence.
