# Dependency Hygiene And e18e Policy

This repo treats `e18e` as an advisory dependency-architecture signal, not an automatic cleanup mandate.

## Current posture

- `pnpm hygiene:e18e:analyze` remains part of `pnpm hooks:strict`.
- `pnpm hygiene:e18e:summary` captures the current duplicate-dependency count and accepted warning families.
- `pnpm hygiene:e18e:summary:write` writes `.agent-factory/e18e-hygiene-summary-current.json` for local review.
- Dependency changes must improve one measured signal while keeping `pnpm peers check` and `pnpm hooks:strict` green.
- The current IWSDK/Vite compatibility exception is encoded in `pnpm-workspace.yaml` with `peerDependencyRules.allowedVersions.vite: "8.0.10"` so peer validation is explicit rather than ambient.

## Unsafe autofix patterns

Do not use these as unattended cleanup shortcuts:

- `pnpm dedupe` without proving `pnpm peers check` and `pnpm hooks:strict` remain green and the duplicate count improves.
- Upgrading `@typescript/native-preview` as part of an `e18e` cleanup slice. Compiler-preview upgrades are a separate package-boundary migration.
- Adding pnpm overrides solely to silence transitive duplicate warnings.
- Removing nested workspace `exports` fields solely because `e18e` flags them. Validate package-resolution intent first.
- Upgrading broad toolchains when the resulting lockfile increases duplicate families.

## Accepted warning families

These warnings are known and should not become toil by themselves:

- Transitive duplicate dependencies owned by older upstream toolchains.
- Workspace package `exports` warnings pending a separate package-boundary decision.
- IWSDK/Vite compatibility posture is pinned through `pnpm-workspace.yaml`; latest observed IWSDK plugin metadata is `0.4.2`, and the Vite plugins still peer on `vite: ^7.0.0` while the repo uses Vite `8.0.10`.
- Legacy GLTF tooling dependencies while `gltf-pipeline` remains an approved local asset capability and `@gltf-transform/core` Node API evidence is promoted through source-smoke consumers.

## First real reduction candidates

1. Finish the `gltf-pipeline` removal decision only after security notes, asset-pipeline docs, and e18e summary evidence all show `@gltf-transform/core` can cover the required source-smoke and conversion-runtime gates.
2. Keep IWSDK Vite plugins sidecar-gated until a published IWSDK plugin peer range accepts Vite 8 or an explicitly approved compatibility override is recorded.
3. Move legacy optional asset tools behind capability-specific install/runtime gates if they remain required.

## Required validation for dependency cleanup

Run these before committing dependency-hygiene changes:

```bash
pnpm peers check
pnpm hygiene:e18e:summary
pnpm hooks:strict
```

A dependency cleanup slice should be rejected if it only changes the lockfile and does not improve a measured signal.
