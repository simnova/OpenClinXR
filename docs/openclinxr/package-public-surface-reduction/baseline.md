# PSR-00 compiler-derived baseline

Source revision: working tree at install time. Governing plan
`docs/openclinxr/package-public-surface-reduction-plan-2026-09-10.md` at
`1c493f12cd9ff5084e763c7e46f7ac4a5d57635c`
(SHA-256 `01cb5139557293ace715e65bae576b359afe0e0e06c201f18e1af3d8bab0341d`).

Machine-readable companion: `baseline.json` in this directory.

| Measurement | Value |
| --- | ---: |
| TypeScript roots | 46 |
| Declared root/subpath entrypoints | 137 |
| Root symbols | 2,533 |
| Entrypoint occurrences | 3,588 |
| Unique per-package symbols | 3,020 |
| Duplicated names | 550 |

Method: one TypeScript program over all declared entrypoint sources; the module symbol
table resolves named exports, aliases, `export *`, `export type *`, single-quoted
specifiers, and nested re-export chains. Runtime and type symbols are classified
separately. Consumer discovery covers static, dynamic, require, re-export, and computed
access across `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, and `.cjs` files.
Package-name resolution is verified against built JavaScript and declarations.

The legacy regex meter (`pnpm arch:unused-exports`: 42 direct-child packages, 2,121 root
symbols, median 34) remains a historical series only. A corrected baseline is measurement
migration, not interface growth.

Limitations and NOT TESTED: unknown consumers outside this private repository; clinical
validity, Quest readiness, runtime performance, and public npm compatibility.
