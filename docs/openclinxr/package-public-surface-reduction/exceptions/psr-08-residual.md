# PSR-08 residual exceptions

Reviewed exceptions after applying PSR-01E to the 26-package complement. These do not authorize unpublished names, new subpaths, or numerical convenience.

## Program root-export count

Measured after apply: 1,243 root symbols vs the plan's review target of 1,000. Duplicate names are 28 (under the 200 target). Residual is keep names from PSR-01B through PSR-01E, not unpublished extras.

## Experimental source publish

`packages/openclinxr/arena/physics-touch-contract` publishes `"." : "./src/index.ts"`. It is an arena spike. Stable packages in this complement already emit `dist` JS + declarations.

## Empty declared subpaths

Seven existing export-map specifiers have keep=0. Each is an `export {}` barrel; implementation remains in a sibling `*-mod.ts`. Specifiers were not removed.

## Arena derived indexes

`pnpm arch:index` writes `packages/openclinxr/arena/*/arch-index.json`. The architecture-rules indexer still enumerates only direct children of `packages/openclinxr`; changing that gate is outside this card's write roots.
