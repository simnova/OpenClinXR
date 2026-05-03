# MADR 0016: Use An OSS-First Offline Asset Generation Pipeline

Status: Accepted for planning
Date: 2026-05-03

## Context

OpenClinXR needs realistic characters, clothing, skin, equipment, and environments, but the Quest 3 runtime and Azure B1 pilot cannot support live generation. The user also wants open-source grounding and avoidance of AGPL/GPL/copyleft contamination where possible.

## Decision

Use an offline asset pipeline that creates optimized runtime bundles before stations are administered. Prefer Anny, Blender, MakeClothes-compatible assets, Mesh2Motion, glTF Transform, KTX2, and meshopt where license review passes. Treat StableGen as optional isolated authoring because it is GPL-3.0. Treat MakeHuman/MPFB source as authoring-only because source licensing is AGPL/GPL, while verified CC0 output assets can be considered.

Every asset entering the runtime must have an asset manifest, license metadata, provenance, triangle/material/texture budgets, LODs, and QA status.

## Consequences

Positive:

- Keeps the Quest 3 runtime stable.
- Gives the development team reproducible assets.
- Reduces copyleft and provenance risk.
- Allows richer station environments without live compute.

Negative:

- Slower asset iteration than live generation.
- Requires asset registry and QA tooling before visual fidelity can scale.
- Some desirable tools remain authoring-only until counsel approves their output terms.

## Reversal Trigger

Revisit only if a permissively licensed live-generation tool can meet Quest 3 latency, frame stability, asset provenance, and clinical QA requirements.

## Sources

- `src-anny-github-2026`
- `src-makehuman-community-license-2026`
- `src-makehuman-makeclothes-github-2026`
- `src-stablegen-github-2026`
- `src-mesh2motion-2026`
- `src-mdn-webxr-performance-2026`
