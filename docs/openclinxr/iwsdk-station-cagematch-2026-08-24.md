# IWSDK 0.5.3 Station Cagematch — does any capability warrant a tenth factory station?

**Doc id**: `iwsdk-station-cagematch-2026-08-24`
**Path**: `docs/openclinxr/iwsdk-station-cagematch-2026-08-24.md`
**Status**: **COMPLETED cagematch decision record** (GitHub issue #616, Path B; 2026-08-24). Lane-C contract: a negative result closes the item. This file is **not** an active marching order and adds **no station** to the factory.
**Not protected-policy**; subordinate to AGENTS.md, PROJECT_STATUS.md, and the six protected blueprint-factory files. Authority order: `AGENTS.md` > `PROJECT_STATUS.md` > worker backlog > this doc.

## BLUF

No IWSDK 0.5.3 capability warrants adding a tenth station to the dark-factory chain (`tools/openclinxr/dark-factory/multi-case-runner.ts:75 DARK_FACTORY_CHAIN_STATIONS`). Every candidate capability is either (a) runtime-only by construction, which D9 excludes from the factory, or (b) build-time in principle but redundant with tooling the factory already owns (`gltf-transform`, procedural room/equipment builders, offline Rhubarb lip-sync). The two capabilities with real future value are **runtime** adoptions gated behind #615, not stations: the UIKitML spatial-text pipeline (build-time compile + runtime panel) for EHR panels, and the scene-composition document/review schemas as an optional authoring interchange, both deferred until #615 resolves whether the package is real on this machine.

**Verdict summary**: 0 × `adopt_as_station`; 2 × `adopt_in_runtime` (blocked); 4 × `reject_measured`; 1 × `inconclusive_blocked`.

## claimScope / notEvidenceFor

- **claimScope**: which named IWSDK 0.5.3 capabilities are candidates for a factory station, each with a verdict (`adopt_as_station` / `adopt_in_runtime` / `reject_measured` / `inconclusive_blocked`) and file:line or API-surface evidence.
- **notEvidenceFor**: that any capability *works* on this machine end to end — #615 owns that question and remains OPEN at writing time; any Quest 3 or performance claim; any change to the nine-station chain, which this slice does not make; any clinical-validity or readiness claim.

## Premise status (#615 dependency)

#615 ("@iwsdk/core is declared at the current 0.5.3 and does not resolve") was **OPEN** when this survey finished (checked via `gh issue view 615` on 2026-08-24). Its contract test `tools/openclinxr/evidence/the-iwsdk-spike-proves-the-package-runs.test.ts` passes in its designed state: 2 passed + 2 expected-fail (`it.fails` clauses (1) and (2) assert resolution/import from `tools/**` scope, where the packages are absent from that import root). Per issue #616's instruction, every adopt-leaning verdict below therefore carries `inconclusive_blocked` until #615 lands a recorded conclusion. The survey itself did not wait on it.

One measured observation is recorded here **without** overwriting #615's ownership: inside `apps/arena/ui-xr-iwsdk-spike`'s own install, the pinned 0.5.3 packages are present under pnpm's store (`node_modules/@iwsdk/{core,xr-input,scene-composition}` symlinks exist), a dynamic `import("@iwsdk/core")` from that directory succeeds and enumerates **683 exports** (banner: "Immersive Web SDK v0.5.3 / Three.js r184 / EliCS v3.4.2"), and `import("@iwsdk/xr-input")` succeeds with 33 exports. This is a module-graph fact about the spike app's install root, not a proof that the package runs in a browser or satisfies clause (1)/(2)'s resolution context — #615 decides that.

## Method

1. Enumerated the candidate surface from what the spike already touches and pins — `apps/arena/ui-xr-iwsdk-spike/package.json:15-24` declares `@iwsdk/core@0.5.3`, `@iwsdk/xr-input@0.5.3`, `@iwsdk/scene-composition@0.5.3` (dependencies) plus `@iwsdk/vite-plugin-dev@0.5.1` and `@iwsdk/vite-plugin-uikitml@0.4.2` (dev). No capability is listed here that was not read from installed package metadata, the repo's spike plan, or these sources.
2. Read the actual installed API surface where available: export lists from dynamic imports of `@iwsdk/core`, `@iwsdk/xr-input`, `@iwsdk/scene-composition`; `.d.ts` declarations (`dist/ui/document.d.ts:22`, `node_modules/@pmndrs/uikitml/dist/interpreter/index.d.ts:6`).
3. Mapped each candidate against the nine existing stations and their implementations (`tools/openclinxr/dark-factory/multi-case-runner.ts:15-26`).
4. Applied the D9 filter: a *station* must produce a BUILD-TIME artifact a later station or the learner bundle consumes. Runtime-only value ⇒ `adopt_in_runtime`, never a station.

## Verdict table

| # | Capability | What the factory does today | What it would produce | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | `@iwsdk/core` ECS/WebXR runtime (`World`, `Entity`, systems: `LocomotionSystem`, `GrabSystem`, `TeleportSystem`, `DepthSensingSystem`) | NONE — learner runtime is plain three.js WebXR (`apps/ui-xr`); no ECS | A runtime scene graph with component/system lifecycle for XR interactions | **adopt_in_runtime** — `inconclusive_blocked` on #615 | Import enumerates 683 exports incl. `World`, system classes (measured 2026-08-24); posture `spike_candidate`, intendedUse "Evaluate ECS…against the existing station shell" — `packages/openclinxr/arena/iwsdk-spike/src/index.ts:643-648`. Runtime-only: produces no bake artifact |
| 2 | UIKitML spatial text: `@iwsdk/vite-plugin-uikitml@0.4.2` compile step → `interpret()` → `UIKitDocument` panel | NONE for spatial UI markup; DOM-based trace UI exists in the sidecar only | Build-time: compiled UIKitML JSON (`public/uikitml/*.json`). Runtime: world-space text panels (EHR readouts) | **adopt_in_runtime** (build-time half already proven sidecar-only) — `inconclusive_blocked` on #615 | Sidecar consumes it today: `apps/arena/ui-xr-iwsdk-spike/src/uikitml-spatial-text.ts:114-137` (`interpret` + `new UIKitDocument`); plugin wired in `vite.config.test.ts:55`; evidence type self-declares `readyForQuestTextClaim: false`, `notEvidenceFor: quest_text_readability` (`uikitml-spatial-text.ts:36-49`). It renders *content*, not exam geometry — never a station |
| 3 | `@iwsdk/scene-composition@0.5.3` scene document/review schemas (`SCENE_DOCUMENT_JSON_SCHEMA`, `composeSceneDocument`, `assertValidSceneReview`, procedural-texture generators) | Room: parametric builder `apps/ui-xr/src/station-environment.ts:176 buildStationEnvironment`; equipment: `apps/ui-xr/src/station-equipment-builders.ts:448 buildDeclaredEquipmentGeometry`; staging: `packages/openclinxr/asset-registry/src/actor-placement.ts:24 generatedActorPlacement` | An interchangeable scene JSON with review contracts and acceptance checks | **reject_measured** as a station; optional authoring-interchange evaluation deferred behind #615 | 82 exports enumerated (measured); schema/review API names from `@iwsdk/scene-composition/dist` exports. Factory rooms are deterministic TypeScript builders already consumed at bake time by `multi-case-runner.ts:176` — swapping formats adds a translation layer with no capability gain |
| 4 | `@iwsdk/glxf` GLXF scene composition format | GLB/GLTF pipeline via `gltf-transform` NodeIO (e.g. `tools/openclinxr/evidence/shoulder-coverage.ts:20`); room/equipment builders above | Nested reusable scene compositions | **reject_measured** | Posture `review_required` with gate `scene_format_review`: "only if it improves reusable exam-room scene composition without fragmenting the existing GLB/GLTF asset pipeline" (`packages/openclinxr/arena/iwsdk-spike/src/index.ts:655-660`). It would fragment the pipeline today; not installed in the spike |
| 5 | `@iwsdk/vite-plugin-dev@0.5.1` MCP dev server (XR emulation, screenshots, controller sim, `/__iwer_mcp`) | Browser evidence via Playwright/portless harness (`pnpm browser:agent`, `spawnPortlessDevServer`) | Agent-driven XR screenshots and controller simulation during development | **reject_measured** (dev-tooling, not factory; also runtime-side) | Plugin prints MCP/dev-summary banners on import (measured 2026-08-24); phase gates require `vite_8_peer_compatibility`, `agent_mcp_runtime_smoke` (`iwsdk-spike-plan.test.ts:80-83`); peer-range `^7.0.0` vs Vite 8.0.16 recorded as mismatch tolerated sidecar-only (`uikitml-spatial-text.ts:27-30` for the sibling plugin family) |
| 6 | `@iwsdk/vite-plugin-gltf-optimizer` build-time GLB optimization | gltf-transform + meshopt already in tree (`tools/openclinxr/evidence/*` imports; TRELLIS optimize ladders) | Compressed/optimized GLBs at build time | **reject_measured** | Blocked in every devtools policy phase (`packages/openclinxr/arena/iwsdk-spike/src/index.ts:987,1002,1035`); blocked transitive `@img/sharp-libvips-darwin-arm64` (`index.ts:1226`); license/libvips path unreviewed (`index.ts:673-678`). Existing optimizer tooling covers the need without the blocker |
| 7 | `@iwsdk/xr-input@0.5.3` input profiles (`XRInputManager`, pointer/grab interactables, hand visuals) | NONE in learner runtime (DOM substitute in sidecar: `main.ts:409-410` counts exports only) | Controller/hand-driven interaction in XR sessions | **adopt_in_runtime** candidate, low priority — `inconclusive_blocked` on #615 | 33 exports enumerated (measured); intendedUse targets clinical interaction modeling (`index.ts:649-654`). Runtime-only by construction — zero bake artifact possible |
| 8 | Lip-sync / viseme capability in IWSDK 0.5.3 | Station 9 `lip_sync` is offline and deterministic: macOS `say` → `afconvert` → Rhubarb 1.14.0 → viseme JSON baked at build time (`multi-case-runner.ts:25-26,847 runLipSyncStation`) | — | **reject_measured** | No audio/viseme/lip-sync surface exists in the 683-export core list or 33-export xr-input list (measured 2026-08-24). Nothing to adopt; the station already owns the job |

## Decisions

1. **No tenth station.** The nine-station chain stands unchanged. Nothing in IWSDK 0.5.3 produces a build-time artifact the chain lacks.
2. **Runtime adoption candidates (deferred, gated on #615):** UIKitML spatial text for world-space EHR/case-note panels, and `@iwsdk/core`'s ECS/runtime helpers if the sidecar ever graduates toward a learner-facing XR shell. Both are `adopt_in_runtime`, not stations; both stay inside the approved sidecar boundary (`apps/arena/ui-xr-iwsdk-spike`, per AGENTS.md IWSDK Sidecar section) until #615 records that the package is real on Apple Silicon.
3. **Authoring-interchange follow-on (optional, non-blocking):** if room authoring moves from code to data, evaluate `@iwsdk/scene-composition`'s scene-document + review schemas as one candidate against plain authored JSON — as a separate slice, not implied by this one. Its acceptance/review machinery overlaps the factory's own Q5 evidence patterns but is not required by anything shipped today.
4. **Negative-result closure.** Per the lane-C contract, the survey's primary answer is negative for stations; this closes #616's question regardless of #615's outcome, because even a fully-working IWSDK changes nothing in the verdict column for stations 1–8's jobs. Only the two runtime rows change status when #615 lands.

## What would change this verdict

- A demonstrated 0.5.x capability that bakes an artifact the chain cannot produce (none found in the enumerated export surfaces).
- #615 concluding the package cannot be made real on this machine ⇒ the two `adopt_in_runtime` rows become `reject_measured`; the station verdicts do not move.
- A product requirement for world-space EHR panels in the learner runtime ⇒ row 2 activates as runtime work inside the sidecar, still not a station.

## Sources

- Spike plan postures/gates/intendedUse: `packages/openclinxr/arena/iwsdk-spike/src/index.ts:641-720`; pre-install policy `index.ts:1214-1247`.
- Contract test (untouched, passing in designed state): `tools/openclinxr/evidence/the-iwsdk-spike-proves-the-package-runs.test.ts:63-104`.
- Sidecar consumption of core/xr-input/UIKitML: `apps/arena/ui-xr-iwsdk-spike/src/main.ts:405-428`, `src/uikitml-spatial-text.ts:110-149`, `src/sidecar-state.test.ts:282-283`.
- Nine-station chain and implementations: `tools/openclinxr/dark-factory/multi-case-runner.ts:13-26,75-85,167-183`.
- Installed-package facts: `apps/arena/ui-xr-iwsdk-spike/package.json:15-24`; `@iwsdk/core/package.json` version 0.5.3; `@iwsdk/core/dist/ui/document.d.ts:22`; `@pmndrs/uikitml/dist/interpreter/index.d.ts:6`.
