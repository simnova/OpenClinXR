# MADR 0036: External Asset Tool Evaluations — Mesh2Motion and Infinigen Indoors Declined

Status: Accepted
Date: 2026-08-06

## Context

MADR 0016 named Mesh2Motion among the preferred offline pipeline tools, and the asset registry
records it as the only entry with `preferredForInitialBuild: true` and an empty `approvalBlockers`
list. It had never been executed. Infinigen Indoors was surfaced as a candidate for the
`environment_equipment` lane, which had no generator registered at all — only generic Blender.

Both were licence-clean and hardware-viable on the development machine (macOS 26.5.2, Xcode 26.6,
arm64), so neither needed a decision from anyone before being run. #77 installed and ran both.

## Decision

**Decline both for their evaluated purpose, on measured grounds. Neither is wired into the pipeline.**

### Mesh2Motion — not adopted as the pipeline armature

| | |
|---|---|
| install | `git clone Mesh2Motion/mesh2motion-app` + `npm install`, ~1.3 s to run |
| licence | MIT (code) / CC0 (art assets) |
| input | **mesh (GLB), not an image** — the right shape for a pipeline starting from Anny bases |
| output | 66 named joints from its shipped `static/rigs/rig-human.glb` (`root … pelvis … fingers … ball_leaf_*`) |
| incumbent | `peds_patient_child.glb` skin bones: 17; OpenClinXR canonical runtime subset: **23** |

A finger-heavy Mixamo-style hierarchy against a 23-bone canonical rig the runtime already drives for
gaze, viseme and gesture. Adopting it means re-targeting every clip and morph binding to gain joints
nothing consumes.

**Residual value, unevaluated: its CC0 animation library.** The rigger was declined; the clips were
never assessed. Tracked separately.

### Infinigen Indoors — not adopted into `buildStationEnvironment`

| | |
|---|---|
| install | `indoors-stable` + python3.11 venv + `INFINIGEN_MINIMAL_INSTALL` + git submodules |
| licence | BSD-3-Clause; Apple Silicon supported; CUDA needed only for terrain, which indoor scenes do not use |
| command | `generate_indoors seed0 fast_solve.gin singleroom.gin DiningRoom terrain=False` |
| room | **15,476,539 triangles**, 7,731,158 verts, 163 meshes, 189 objects |
| wall-clock | **1,377.98 s (22 min 58 s)** for one room |
| export | ~1.0 GB glTF |

Against this repo's own stated budgets — `quest3AssetBudget.maxTriangles = 60,000` per asset and
`quest3StationBudget.maxVisibleTriangles = 180,000` per station
(`packages/openclinxr/asset-registry/src/index.ts:590,597`) — that is **86× the station budget** or
**258× per asset**. The generation time and the 1 GB export would each independently rule it out of an
authoring loop that regenerates assets per case.

**Not evaluated: decimation.** meshopt is already accepted by MADR 0016 and appears in the tree;
Open3D is referenced nowhere. Whether Infinigen works as an authoring source behind aggressive
decimation is a separate, unanswered question. This decision covers direct use only.

## Consequences

Positive:

- Two candidate technologies now have measured verdicts rather than assumptions, at a cost of one
  slice, and both artefacts are in `.openclinxr/evidence/external-tool-cagematch/`.
- The `environment_equipment` lane's emptiness is now a known state rather than an oversight.
- Establishes the pattern: install under `/tmp/ocxr77_tools/`, record the removal command, keep
  multi-GB outputs out of git.

Negative:

- **The asset registry entry for `mesh2motion` still reads `preferredForInitialBuild: true`**, which
  this evidence contradicts. Until that field is updated with a pointer here, the registry misleads
  the next reader.
- Declining Infinigen without testing decimation leaves the environment lane with no generator and no
  named candidate.

## Compliance and boundaries

No cloud APIs, no paid services, no copyleft contamination. Both installs live outside the repo and
are removable:

```
rm -rf /tmp/ocxr77_tools/mesh2motion-app /tmp/ocxr77_tools/infinigen-venv \
       /tmp/ocxr77_tools/infinigen-indoors /tmp/ocxr77_tools/infinigen-outputs
```

`claimScope`: measured install, execution and output size on one machine.
`notEvidenceFor`: output quality, visual suitability, clinical plausibility, or performance after
optimisation — none of which were assessed.
