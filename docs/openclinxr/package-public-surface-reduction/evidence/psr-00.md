# PSR-00 evidence — trustworthy compiler-resolved meter

Source revision: working tree at install time. Task: PSR-00 v2, plus the H1-H6
handback (read-only verify, table inventory hash, raw-inventory gate, scoped
approval rows, fixture self-test, explicit-output-only writes) and the H7-H8
handback (provenance over freshness: rawInventoryHash plus group-scoped groupHash;
apply-card to approval-group map in code).

Machine-readable companion: `psr-00.json` in this directory.

## Commands and outcomes

- `pnpm arch:public-surface:verify` — read-only: recomputes the compiler-derived
  surface, checks the shrink ratchet against the checked-in baseline, exits 1 on
  growth. Passes on this tree.
- `pnpm arch:public-surface:verify --write-baseline` — the only command that writes
  baseline.json (explicit output flag).
- `pnpm arch:public-surface:verify --require-inventory` — exits 1 on this tree
  (before column below): no raw-inventory.json exists until PSR-01A generates it.
- `pnpm arch:public-surface:acceptance -- --self-test` — proves the gates fail
  closed on absent manifests and on a present-but-unapplied fixture group.
- `pnpm --filter @openclinxr/architecture-rules exec vitest run src/checks/public-surface`
  — 3 passed (unit entry to the same gates).
- `git diff --check` — no whitespace errors.
- `pnpm arch:public-surface:acceptance --report <path>` — writes the JSON report
  only with the explicit flag; without one the CLI is read-only.

## Provenance model (H7-H8)

An approval records `rawInventoryHash` (the checked-in raw-inventory.json hash it was
reviewed against) and `groupHash` (its packages' rows at review time).
`--require-reviewed-group` checks rows resolved, `rawInventoryHash` against the
checked-in raw inventory, and `groupHash` against the current tree. `--require-applied`
checks `rawInventoryHash` against the checked-in raw inventory, `groupHash` against the
raw inventory's rows for the group's packages, then exact expected-surface equality
(raw rows with removes deleted, migrates moved, keeps retained) on the in-scope
packages. `--require-all-reviewed` checks provenance only, never current-tree
freshness. `--require-applied` resolves apply ids (psr-02..psr-08) through
`apply-map.ts`; a group id directly checks the whole group.

## Measured before and after

Before: legacy regex meter only (42 direct-child packages, 2,121 root symbols; arena
packages and `export type *` unmeasured). After: compiler-derived baseline of 46 roots,
137 entrypoints, 2,533 root symbols, 3,588 occurrences, 3,020 unique symbols, and 550
duplicated names, with manifest hashes plus a per-package per-entrypoint ratchet table
in `baseline.json`.

## --require-inventory before column (H3, literal output on this tree)

```text
46 roots, 137 entrypoints, 2533 root symbols, 3588 occurrences, 3020 unique, 550 duplicated names (surface 4782814823d2)
FAIL: raw inventory docs/openclinxr/package-public-surface-reduction/raw-inventory.json is absent (PSR-01A has not generated it)
ok baseline ratchet: surface matches the checked-in baseline (no growth)
public-surface verify FAILED: one or more required gates failed
```

## Removed, migrated, retained

No exports changed. No implementation deleted. No dispositions approved. No relocation
theater: no namespace wrapping, facade indirection, package splitting, or subpath
relocation was used to earn shrinkage.

## Claim

The verifier and both root proof commands are installed; the meter is compiler-derived,
verify is read-only with a shrink ratchet, the inventory hash covers the full symbol
table, approval rows are scoped to one package entrypoint, and the gates fail closed.

## Limitations and NOT TESTED

Unknown consumers outside this private repository; clinical validity, Quest readiness,
runtime performance, and public npm compatibility.
