# GLTF Transform Replacement Decision

Date: 2026-05-27

## Decision

Do not demote or remove `gltf-pipeline` yet.

Add `@gltf-transform/core` Node API smoke evidence as the replacement candidate path, but keep `gltf-pipeline` as the currently approved local conversion CLI until downstream source-evidence consumers are migrated.

## Evidence compared

- `docs/openclinxr/gltf-pipeline-smoke-2026-05-27.json`
- `docs/openclinxr/gltf-transform-smoke-2026-05-27.json`

Both paths produced valid GLB output for the deterministic single-triangle smoke:

| Tool path | Package | Result | Output bytes | Notes |
| --- | --- | --- | ---: | --- |
| `gltf-pipeline` CLI | `gltf-pipeline` | pass | 848 | Current approved source smoke and asset-readiness input. |
| GLTF Transform Node API | `@gltf-transform/core` | pass | 816 | Faster local conversion proof and viable replacement candidate. |

## Why removal is not safe yet

- `asset-production-readiness` still consumes the `gltf-pipeline` smoke report shape.
- `local-runtime-probe` still checks `gltf-pipeline` as an approved local asset command.
- `security-audit-exceptions.md` and asset pipeline docs still describe `gltf-pipeline` as the approved local conversion CLI.
- The `gltf-transform` CLI is currently blocked by the repo `brace-expansion` security override, so the safe replacement route is `@gltf-transform/core` Node API, not `@gltf-transform/cli`.

## Next migration order

1. Generalize asset source-smoke consumers to accept an abstract GLTF conversion smoke report.
2. Teach `asset-production-readiness` to accept either the current `gltf-pipeline` evidence or a passing GLTF Transform Node API evidence file.
3. Update `local-runtime-probe` so GLTF conversion capability can be satisfied by `@gltf-transform/core` scripts, not only `gltf-pipeline` CLI.
4. Update security and asset-pipeline docs after code consumers no longer require `gltf-pipeline`.
5. Run `pnpm hygiene:e18e:summary`, `pnpm peers check`, and `pnpm hooks:strict`; only then remove or isolate `gltf-pipeline` if the duplicate count or install footprint improves.
