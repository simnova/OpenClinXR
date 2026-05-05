# Proposal: Local WebXR Hand Mesh Assets

**Status:** Proposed  
**Decision needed:** Approve, reject, or defer  
**Requested by:** Codex, after Patrick's 2026-05-04 worn-headset observation that virtual hands appeared as primitive boxes  
**Scope:** `apps/ui-xr` Full VR runtime only, with an optional mirrored sidecar check in `apps/ui-xr-iwsdk-spike`

## Decision Needed

Approve a constrained implementation slice to replace the current primitive `XRHandModelFactory.createHandModel(hand, primitiveHandModelProfile)` runtime posture, currently `primitiveHandModelProfile = "spheres"`, with reviewed local mesh hand assets.

The implementation must not fetch hand models from a CDN at runtime. Three's `XRHandMeshModel` defaults to `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/` when no path is supplied, so the approved path must explicitly point to local, repo-tracked or repo-addressable assets.

## Recommendation

Approve only after the asset source/license record is completed.

Use the existing `three@0.184.0` dependency and Three's built-in `XRHandModelFactory` mesh profile. Add no new runtime npm package for the first slice. Provide local `left.glb` and `right.glb` assets under a reviewed static asset path such as `apps/ui-xr/public/xr-hands/generic-hand/`, and configure the factory with `handModelFactory.setPath("/xr-hands/generic-hand/")` before `createHandModel(hand, "mesh")`.

If local GLBs cannot be licensed and budgeted cleanly, defer realistic mesh hands and keep the current primitive `spheres` fallback while documenting the limitation in Quest evidence.

## Proposed Package And Asset Set

| Item | Proposed Version / Path | Posture |
| --- | --- | --- |
| `three` | `0.184.0` | Already installed and MIT-licensed |
| `three/addons/webxr/XRHandModelFactory.js` | Existing Three add-on import | Allowed; no new dependency |
| `three/addons/loaders/GLTFLoader.js` | Existing Three add-on, loaded by `XRHandMeshModel` if needed | Allowed; no new dependency |
| Hand mesh GLBs | `apps/ui-xr/public/xr-hands/generic-hand/left.glb` and `right.glb` or equivalent reviewed path | Requires source, license, provenance, Quest budget, and visual QA |
| `@webxr-input-profiles/assets` | No runtime install proposed | May be used only as a reviewed source for static local assets if license/provenance passes |

## Pros

- Directly addresses Patrick's observed primitive-box hand issue.
- Uses the existing Three dependency instead of adding a new package.
- Keeps runtime deterministic and offline-capable by avoiding CDN fallback.
- Gives future Quest evidence a clearer distinction between "hand tracking observed" and "realistic hand representation observed."

## Cons

- Adds skinned GLB work to every XR frame; Quest 3 frame pacing must be measured again.
- Requires asset license/provenance review before merge.
- Generic hands may still be insufficient for clinical realism or accessibility if gestures are unclear.
- If the asset source is `@webxr-input-profiles/assets`, its package/license metadata must be verified before copying any files.

## Guardrails

- Do not use Three's mesh profile without calling `setPath(...)` to a local asset path.
- Do not load from jsDelivr or any external CDN in `apps/ui-xr`.
- Do not add `@webxr-input-profiles/assets` to production manifests without a separate dependency and license review.
- Do not claim Quest hand-quality readiness until a human foreground Quest run verifies the mesh hands, hand tracking, no console asset-load errors, and frame pacing.
- Keep a primitive fallback for asset-load failure and record that fallback in manual evidence.
- Surface the active representation (`primitive_spheres`, `mesh`, `not_visible`, or fallback) in the in-scene evidence panel and copied Quest evidence payload so headset observations and JSON stay aligned.

## Acceptance Criteria

- `addHandModels()` uses a local mesh path and never relies on Three's default remote path.
- Static/source tests assert the local hand path, mesh posture, and CDN-blocking guard.
- Asset provenance is recorded for both GLBs, including source URL/package, license, modification notes, and output path.
- The visual QA evidence checker receives a desktop or IWER screenshot that documents hand representation limitations.
- A later human Quest run confirms hand mesh visibility, input observations, no hand asset console errors, and nonzero immersive frame stats before any readiness claim.

## Sources

- Local Three `XRHandModelFactory` source: `node_modules/.pnpm/three@0.184.0/node_modules/three/examples/jsm/webxr/XRHandModelFactory.js`
- Local Three `XRHandMeshModel` source and default remote path: `node_modules/.pnpm/three@0.184.0/node_modules/three/examples/jsm/webxr/XRHandMeshModel.js`
- Current runtime primitive hand model call: `apps/ui-xr/src/main.ts`
- Asset registry gates: `packages/openclinxr/asset-registry/src/index.ts`
- Asset pipeline QA gates: `docs/openclinxr/asset-generation-pipeline.md`
