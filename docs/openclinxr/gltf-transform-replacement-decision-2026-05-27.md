# GLTF Transform Replacement Decision

Date: 2026-05-27

## Decision

Do not demote or remove `gltf-pipeline` yet, but the first downstream consumers now accept `@gltf-transform/core` evidence.

Add `@gltf-transform/core` Node API smoke evidence as the replacement candidate path, and allow source-readiness/runtime gates to consume that evidence. Keep `gltf-pipeline` as an approved local conversion CLI until security notes and dependency-footprint evidence prove removal or isolation is safe.

## Evidence compared

- `docs/openclinxr/gltf-pipeline-smoke-2026-05-27.json`
- `docs/openclinxr/gltf-transform-smoke-2026-05-27.json`

Both paths produced valid GLB output for the deterministic single-triangle smoke:

| Tool path | Package | Result | Output bytes | Notes |
| --- | --- | --- | ---: | --- |
| `gltf-pipeline` CLI | `gltf-pipeline` | pass | 848 | Current approved source smoke and asset-readiness input. |
| GLTF Transform Node API | `@gltf-transform/core` | pass | 816 | Faster local conversion proof and viable replacement candidate. |

## Why removal is not safe yet

- `asset-production-readiness` now consumes either `gltf-pipeline` smoke evidence or GLTF Transform Node API smoke evidence.
- `local-runtime-probe` can now satisfy the asset conversion runtime gate with `@gltf-transform/core` Node package availability even if the GLTF Transform CLI is blocked.
- `security-audit-exceptions.md` and asset pipeline docs still describe `gltf-pipeline` as the approved local conversion CLI.
- The `gltf-transform` CLI is currently blocked by the repo `brace-expansion` security override, so the safe replacement route is `@gltf-transform/core` Node API, not `@gltf-transform/cli`.

## Next migration order

1. Update security and asset-pipeline docs after dependency evidence shows code consumers no longer require `gltf-pipeline`.
2. Run `pnpm hygiene:e18e:summary`, `pnpm peers check`, and `pnpm hooks:strict`; only then remove or isolate `gltf-pipeline` if the duplicate count or install footprint improves.
