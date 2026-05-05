# UIKitML Spatial Text Sidecar Evidence

Status: implementation evidence for the approved sidecar-only UIKitML text-readability spike.

## Scope

This is limited to `apps/ui-xr-iwsdk-spike`. It does not add UIKitML dependencies to `apps/ui-xr`, shared production packages, or the default production client path.

The purpose is to compare spatial text readability options inside the IWSDK sidecar. Broader spatial UI adoption requires a separate proposal.

## Package Set

| Package | Version | Placement | License posture |
| --- | --- | --- | --- |
| `@iwsdk/vite-plugin-uikitml` | `0.3.1` | `apps/ui-xr-iwsdk-spike` devDependency | MIT in package metadata and package `LICENSE` |
| `@pmndrs/uikitml` | `0.1.12` | `apps/ui-xr-iwsdk-spike` devDependency | MIT in metadata; package `LICENSE` contains MIT-style terms |
| `@pmndrs/uikit` | `1.0.66` | `apps/ui-xr-iwsdk-spike` devDependency | Metadata says `SEE LICENSE IN LICENSE`; reviewed package `LICENSE` contains MIT-style terms with Bela Bohlender and Coconut Capital notices |
| `@pmndrs/msdfonts` | `1.0.66` | Transitive through `@pmndrs/uikit` | Metadata says `SEE LICENSE IN LICENSE`; package `LICENSE` says it redistributes Google Fonts in MSDF format, with Roboto under Apache-2.0 and listed font families under SIL Open Font License 1.1 |

## Vite 8 Compatibility Check

The installed sidecar uses `vite@8.0.10`.

`@iwsdk/vite-plugin-uikitml@0.3.1` declares `peerDependencies: { "vite": "^7.0.0" }`, so the install produces a peer warning. This is accepted only for this gated sidecar spike, and the sidecar build must be run before committing any lockfile or source changes.

The plugin export shape was inspected from the installed package:

- Import: `import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";`
- Options used: absolute source/output paths resolving to `apps/ui-xr-iwsdk-spike/ui` and `apps/ui-xr-iwsdk-spike/public/uikitml`, with `watch: true` and `verbose: false`.
- Source extension: `.uikitml`.
- Output shape: generated `.json` files under `public/uikitml`.

## Source And Generated Output

Reviewed source:

- `apps/ui-xr-iwsdk-spike/ui/spatial-text-readability.uikitml`

Generated output path at serve/build time:

- `apps/ui-xr-iwsdk-spike/public/uikitml/spatial-text-readability.json`

The generated JSON is derived from reviewed source and is used for local sidecar evidence. It is not Quest text-readiness evidence.

## Runtime Evidence Contract

The sidecar publishes:

- `window.__openClinXrUikitmlSpatialTextEvidence`

The evidence explicitly records:

- Package versions.
- License posture.
- Vite peer mismatch.
- Source and compiled config paths.
- `readyForQuestTextClaim: false`.
- `readyForProductionSpatialUi: false`.

## Visual Evidence

Captured sidecar screenshot:

- `docs/openclinxr/media/uikitml-spatial-text-sidecar-2026-05-05.png`

Adversarial visual read:

- The UIKitML panel renders as a spatial panel in the IWSDK sidecar scene.
- The panel is placed above the actor heads so its title, clinical lines, and scope warning remain visible in the desktop/IWER evidence view.
- This screenshot is useful for sidecar readability comparison only. It does not prove Quest text readiness, hand/controller interaction quality, or production spatial UI adoption.

Runtime checks from the desktop/IWER evidence view:

- Compiled config request: `GET /uikitml/spatial-text-readability.json` returned `200`.
- Console errors/warnings: none observed after reload.
- Preview frame summary: `avgFrameMs 8.33`, `p95FrameMs 9.4`, `approxFps 120`, `immersiveFramesObserved 0`.

## Current Recommendation

Keep UIKitML as a sidecar readability spike while it proves whether authored spatial text has better readability, layout, and maintainability than the current canvas-text panels.

Do not move UIKitML into the production `apps/ui-xr` path until a later proposal has real Quest foreground evidence and a stronger rendering/runtime posture.
