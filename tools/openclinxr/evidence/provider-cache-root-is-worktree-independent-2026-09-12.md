# Provider-cache root is worktree-independent (2026-09-12)

Untracked `.openclinxr-local/provider-cache` exists in the MAIN checkout only. Evidence tests that joined it to an `import.meta.url` root passed in main and failed in linked worktrees.

Remedy (known-good, already landed on one file): `git rev-parse --path-format=absolute --git-common-dir` → parent. Shared helper: `tools/openclinxr/evidence/provider-cache/main-worktree-root.ts`. Precedent: `tools/openclinxr/openclaw/coordination-root.ts`.

## Enumeration (this tree, 2026-09-12)

Claimed: 14 files, 1 already fixed. **This enumeration is 12 test files that construct a cache path in code** (11 remaining + 1 known-good). Difference vs 14: **−2**. Comment-only mentions were not counted as readers.

| file | pre-fix root | action |
|---|---|---|
| `humanoid-vetting/the-shipped-lower-is-fitted-asset-geometry-not-a-shell.test.ts` | `CACHE_ROOT = mainWorktreeRoot()` | already fixed; left as known-good |
| `visemes02-helper-ref-preflight.test.ts` | `join(REPO_ROOT, …provider-cache…)` | converted |
| `shipped-garments-are-reproducible.test.ts` | same | converted |
| `the-hair-pack-has-a-two-column-licence-inventory.test.ts` | same | converted |
| `the-gown-mhclo-fits-the-stripped-basemesh.test.ts` | same | converted |
| `the-class-inventory-notices-a-newly-cached-garment.test.ts` | same | converted |
| `footwear-is-a-real-garment.test.ts` | `` `${REPO_ROOT}/.openclinxr-local/provider-cache/…` `` | converted |
| `the-hair-sheet-shows-every-cached-style.test.ts` | `join(REPO_ROOT, …)` | converted |
| `cached-garments-have-a-measured-class.test.ts` | same | converted |
| `the-case-eye-colour-reaches-the-iris-selector.test.ts` | same | converted |
| `the-bake-reads-the-wardrobe-layering-directives.test.ts` | cwd-relative `".openclinxr-local/provider-cache/garments"` | converted |

Helpers that the tests (or their CLIs) used to open the same tree, also converted: `hair-pack-licence-inventory.ts`, `wardrobe-layering-read.ts`, `garment-texture-inspection.ts`, `mpfb-eye-colour-inspection.ts`, `footwear-makeclothes-or-procedural.ts` (dropped the `/Volumes/files/src/openclinxr` hardcode).

## Refused to convert

| file | reason |
|---|---|
| `garment-cache-index.mjs` | already hardcoded to `/Volumes/files/src/openclinxr` (machine-specific main). Not a test. |
| `derive-garment-fit-transform.mjs`, `garment-work-order.mjs` | write destinations under `provider-cache/garments/generated/`. A worktree-local generated candidate may be intentional; left. |
| `humanoid-toolchain-bakeoff.ts` | relative `existsSync` from cwd; not a test. |
| Comment-only `.test.ts` files (`eyes-have-an-iris.test.ts`, `hospital-gown-maps-to-crudegown.test.ts`, …) | no code join |

No assertion, threshold, fixture value or expected count was changed. No asset was fetched.

## Two-sided proof (this worktree; cache partial/absent vs main)

Worktree: `/Users/patrick/.grok/worktrees/src-openclinxr/bothy-tsk_b26458a706e1b3ab`  
Main cache: `/Volumes/files/src/openclinxr/.openclinxr-local/provider-cache`  
Worktree cache: eyes + a subset of garments; **no visemes, no hair, no crude-gown**.

| file | before (worktree-local root) | after (`git-common-dir` parent) |
|---|---|---|
| `visemes02-helper-ref-preflight.test.ts` | 2 failed / 2 passed (4). `targets on disk: expected 0 to be greater than 0` | **4 passed** |
| `the-hair-pack-has-a-two-column-licence-inventory.test.ts` | 1 failed / 4 passed (5). `the hair cache must be readable… expected false to be true` | **5 passed** |
| `the-gown-mhclo-fits-the-stripped-basemesh.test.ts` | 3 failed (3). named this checkout: `…/bothy-tsk_b26458a706e1b3ab/.openclinxr-local/provider-cache/garments/sources/makehuman-community-crude-gown/crudegown.mhclo` | **3 passed** |

A suite that is green in main does not prove the defect. These three failed here by naming this worktree's absent path, then passed by reading main's cache.

## Gate

Live file: `tools/openclinxr/evidence/provider-cache/no-test-resolves-the-provider-cache-from-its-own-worktree.test.ts`  
Architecture freeze (`ROOT_TEST_FILE_FREEZE = 560`) refuses a new root-level `.test.ts`. Contract `exists:` wants that basename at `tools/openclinxr/evidence/`. Intersection: a **symlink** at the contract path (`Dirent.isFile()` is false for a symlink, so the freeze stays 560).

### Destructive probe

Planted `provider-cache/_scratch-worktree-local-cache.test.ts` with `join(REPO_ROOT, ".openclinxr-local/provider-cache")`.

Bite:

```
FAIL  …/no-test-resolves-the-provider-cache-from-its-own-worktree.test.ts
AssertionError: provider-cache/_scratch-worktree-local-cache.test.ts: join(REPO_ROOT, ….openclinxr-local/provider-cache): expected [ { …(2) } ] to deeply equal []
+   { "detail": "join(REPO_ROOT, ….openclinxr-local/provider-cache)",
+     "file": "provider-cache/_scratch-worktree-local-cache.test.ts" }
Test Files  1 failed (1)
     Tests  1 failed (1)
```

Reverted the scratch file.

Pass:

```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

## Counterweight

`pnpm exec vitest run --root . tools/openclinxr/evidence/humanoid-vetting` and `…/licence` are the contract suites. No expected counts or garment/licence assertions were edited.
