# GLTF Transform Replacement Decision

Date: 2026-05-27

## Decision

Do not demote or remove `gltf-pipeline` yet, but the first downstream consumers now accept `@gltf-transform/core` evidence.

Add `@gltf-transform/core` Node API smoke evidence as the replacement candidate path, and allow source-readiness/runtime gates to consume that evidence. Keep `gltf-pipeline` as an approved local conversion CLI until security notes and dependency-footprint evidence prove removal or isolation is safe.

## Evidence Compared

Historical point-in-time smoke JSON has been pruned from the active docs tree. The retained decision is that both paths produced valid GLB output for the deterministic single-triangle smoke:

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

1. Keep `gltf-pipeline` installed for now because `agent:verify` still validates the legacy `asset:gltf:smoke` lane and e18e evidence has not shown an install-size or duplicate-count improvement from removal/isolation.
2. Treat a future removal/isolation attempt as a separate dependency slice: update `agent:verify`, remove or isolate `asset:gltf:smoke`, run `pnpm install`, compare `pnpm hygiene:e18e:summary`, then require `pnpm peers check` and `pnpm hooks:strict` before committing.
3. Do not substitute the `@gltf-transform/cli` path for this decision while its native Sharp/libvips dependency path remains review-gated.
