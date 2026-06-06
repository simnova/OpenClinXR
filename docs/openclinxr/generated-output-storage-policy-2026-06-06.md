# Generated Output Storage Policy

Date: 2026-06-06

Status: current reference for cagematches, generated assets, evidence captures, and factory outputs. This policy does not promote any generated humanoid, provider, Quest runtime, learner launch, clinical, scoring, or production readiness claim.

## Purpose

OpenClinXR should commit the factory, not the factory's generated products.

Cagematches and model-vetting runs intentionally create large, volatile, and sometimes license-bound artifacts: GLBs, OBJ files, texture maps, screenshots, videos, ComfyUI outputs, Blender intermediate files, model checkpoints, provider cache files, and local review reports. Those outputs are essential for local evaluation, but they should not become the Git source of truth. Git should hold the reproducible machinery, contracts, gates, and small durable pointers needed to recreate, locate, validate, or review those outputs.

## Storage Classes

| Class | Examples | Git posture | Durable reference |
| --- | --- | --- | --- |
| Factory source | TypeScript/Python generators, Blender scripts, schemas, validators, app source, tests | Commit | Normal repo paths |
| Policy and architecture | MADRs, gate docs, cagematch plans, generated-output policy | Commit | Markdown path plus doc authority registry when applicable |
| Small contracts | JSON schemas, fixtures, typed examples, provider-boundary constants | Commit when they are stable inputs, not one-off run output | Path plus tests |
| Generated candidate assets | GLB/OBJ/FBX/USDZ, rigged copies, optimized variants, materialized runtime bundles | Do not commit by default | Local cache path, sha256, source factory command, optional external artifact URI |
| Generated media evidence | Screenshots, WebM/MP4 captures, visual QA images, texture tiles, albedo/normal/roughness maps | Do not commit by default | Manifest pointer with hash, dimensions, capture recipe, and reviewer note |
| Provider/model caches | RealVisXL, IPAdapter, ControlNet, ComfyUI outputs, Anny weights, voice checkpoints | Never commit | License/cache manifest with local path and hash; external source URL only when allowed |
| Run reports | Cagematch report JSON, capture artifact maps, probe outputs, local benchmark outputs | Do not commit unless promoted to a stable compatibility fixture or canonical policy input | Local `.openclinxr/` path or ignored docs path plus summary in coordination docs |

## Canonical Local Layout

Use local paths that make the lifecycle obvious:

| Need | Preferred local path |
| --- | --- |
| Working/generated assets | `.openclinxr/asset-production/<lane>/<scenario-or-case>/<run-id>/` |
| Local cagematch public files served by a Vite app | `apps/arena/<app>/public/cagematch/<run-id>/` |
| Local screenshots/videos/textures | `docs/openclinxr/model-vetting-captures/<run-id>/` or `.openclinxr/evidence/<run-id>/` |
| Provider/model caches | Provider-native cache folders, with repo manifests recording local path and hash |
| Stable compatibility fixtures | `packages/**/fixtures/` or `tools/**/fixtures/`, only after explicitly promoted |

The preferred future direction is to keep heavyweight run artifacts under `.openclinxr/**` by default and copy only the minimum public-serving subset into `apps/**/public/cagematch/**` when a local browser harness needs it.

## Manifest Contract

Every generated-output pointer should be enough for another agent to understand what exists without committing the blob:

- `artifactKind`: GLB, texture, screenshot, video, checkpoint, report, or bundle.
- `localPath`: ignored local path where the artifact was written.
- `sha256`: content hash when the artifact exists locally.
- `byteLength`: file size when useful for budget gates.
- `generatedBy`: command, script, package, and relevant version.
- `sourceInputs`: source candidate id, scenario id, provider/checkpoint, prompt or parameter hash, and source asset hashes.
- `licenseBoundary`: source license, reuse restrictions, no-redistribution notes, and local-only/provider approval status.
- `captureRecipe`: camera/view/timeline/lighting settings for screenshots or video.
- `promotionGates`: explicit false gates for B+, scene placement, Quest, production, learner, clinical, and scoring readiness.
- `retention`: local cache, artifact store, promoted fixture, or delete-after-review.

Small manifests may be committed only when they are stable architecture inputs. One-off run manifests should be ignored and summarized in the active state docs instead.

## Promotion Rules

Generated output can move closer to Git only through an explicit promotion decision:

| Promotion target | Required decision |
| --- | --- |
| Test fixture | Small, deterministic, license-clear, needed for repeatable tests, and not a real provider output unless allowed |
| Documentation image | Small, deliberately selected, license-clear, and useful as stable explanatory evidence |
| Runtime seed asset | Separate architecture/product decision with provenance, license, budget, and false-gate review |
| Public website media | Marketing review says the change is meaningful to skeptical viewers; no false readiness claim |

No generated output is promoted merely because it was produced during a cagematch.

## Cagematch Rule

Technology cagematches should produce local artifacts and durable conclusions, not Git bloat.

Commit:

- The cagematch runner.
- The schema/validator.
- The provider-boundary logic.
- The capture harness source.
- The false-gate and promotion policy.
- A concise state-doc summary of the result and next decision.

Do not commit by default:

- Candidate GLBs.
- Generated texture maps.
- Screenshots and videos.
- Raw ComfyUI/Blender/Anny outputs.
- One-off cagematch JSON reports.
- Provider checkpoints or weights.

When an agent needs to compare generated outputs, it should regenerate them locally or read a manifest that points to the local/object-store copy.

## Git Ignore Baseline

The repo should ignore generated cagematch output families such as:

- `apps/arena/model-vetting-studio/public/cagematch/`
- `apps/*/*/dist/cagematch/`
- `docs/openclinxr/model-vetting-captures/anny-skin-*/`
- `docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-*/`
- `docs/openclinxr/realvisxl-*`
- Provider/model cache directories and `.openclinxr/**`

If a new cagematch family writes elsewhere, add the ignore rule before publishing the factory slice.

## Agent Checklist

Before committing a cagematch or generated-asset slice:

1. Confirm the committed diff contains factory code, schemas, docs, and stable tests, not heavyweight generated outputs.
2. Confirm local generated artifacts are ignored but still reproducible or referenced by local manifests.
3. Record the meaningful result in `PROJECT_COORDINATION_INDEX.md`, `AUTONOMOUS_WORK_PLAN.md`, or the worker matrix without embedding large outputs.
4. Preserve false readiness gates.
5. Run the focused validators and drift/alignment guards for touched factory surfaces.

