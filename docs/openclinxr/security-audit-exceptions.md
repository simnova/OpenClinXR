# Security Audit Exceptions

Date: 2026-05-04
Status: No active security audit exceptions; active version-pinned license inventory normalizations are recorded below.

## Policy

OpenClinXR runs `pnpm audit --audit-level=high` as part of `pnpm verify`. Production-only and dev-only checks are available through `pnpm security:audit:prod` and `pnpm security:audit:dev`.

`pnpm security:audit-policy` validates that the hard audit scripts remain in the default verification path and that any future high or critical audit exception is recorded in a machine-checkable form before it is allowed to coexist with audit evidence.

To preserve a point-in-time audit evidence artifact, run:

```bash
pnpm audit --json > docs/openclinxr/security-audit-YYYY-MM-DD.json
pnpm security:audit-policy -- --audit-json docs/openclinxr/security-audit-YYYY-MM-DD.json --output docs/openclinxr/security-audit-policy-YYYY-MM-DD.json
```

The latest local audit evidence is:

- `docs/openclinxr/security-audit-2026-05-05.json`
- `docs/openclinxr/security-audit-policy-2026-05-05.json`

Exceptions are allowed only when all of the following are recorded here:

- Advisory ID or GHSA.
- Affected package and dependency path.
- Why upgrade, removal, replacement, or pnpm override is not immediately feasible.
- Compensating control or blast-radius note.
- Owner.
- Review-by date.
- Planned removal condition.

If any active exception is needed, replace `None.` under Active Exceptions with this table shape:

| Advisory | Package | Severity | Affected | Fixed | Rationale | Owner | Review-by | Removal condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Any package-manager override or pnpm audit ignore must link back to an exception entry in this file.

## License Policy Gate

OpenClinXR runs:

```bash
pnpm security:licenses
```

The gate reads `pnpm licenses list --json`, fails on AGPL/GPL/LGPL/SSPL/non-commercial/proprietary/unknown/unlicensed dependency records, applies only version-pinned license-file normalizations recorded in this file, and reports review-only licenses separately. The latest local report is:

- `docs/openclinxr/dependency-license-policy-2026-05-04.json`

## Active Exceptions

None.

## Active License Inventory Normalizations

These are not copyleft, vulnerability, or audit-ignore exceptions. They normalize package records where `pnpm licenses list --json` reports `Unknown` because `package.json` says `SEE LICENSE IN LICENSE`, while the installed package contains MIT license text and the upstream repository records the same MIT license text.

| Package | Version | Reported by pnpm | Effective license | Evidence | Removal condition |
| --- | ---: | --- | --- | --- | --- |
| `@pmndrs/handle` | `6.6.29` | `Unknown` | MIT | Installed `LICENSE`; [pmndrs/xr LICENSE](https://github.com/pmndrs/xr/blob/main/LICENSE) | Remove when pnpm reports MIT or package metadata uses a standard SPDX license. |
| `@pmndrs/pointer-events` | `6.6.29` | `Unknown` | MIT | Installed `LICENSE`; [pmndrs/xr LICENSE](https://github.com/pmndrs/xr/blob/main/LICENSE) | Remove when pnpm reports MIT or package metadata uses a standard SPDX license. |
| `@pmndrs/uikit` | `1.0.64` | `Unknown` | MIT | Installed `LICENSE`; [pmndrs/uikit LICENSE](https://github.com/pmndrs/uikit/blob/main/LICENSE) | Remove when pnpm reports MIT or package metadata uses a standard SPDX license. |

## Dependency Pinning Gate

As of 2026-05-03, every OpenClinXR package manifest uses exact external dependency versions or explicit local workspace/file/link protocols. This is enforced by:

```bash
pnpm agent:pins
```

Supporting checks run during the decision:

- `pnpm audit --audit-level=high`: no known vulnerabilities found.
- `pnpm licenses list --json`: license inventory generated for local dependencies; no active AGPL/GPL runtime exception was added.
- `pnpm security:licenses -- --output docs/openclinxr/dependency-license-policy-2026-05-03.json`: 493 dependency license records checked, 0 blockers, 7 review-only findings.
- `pnpm knip --version`: `6.11.0`.
- `pnpm e18e-cli --version`: `0.5.0`.

## Dependency Decisions With No Exception

- `@gltf-transform/cli@4.3.0` was evaluated on 2026-05-03 and removed before commit because its current CLI dependency path installed `sharp@0.34.5`, which installed `@img/sharp-libvips-darwin-arm64@1.2.4` reporting `LGPL-3.0-or-later`. No pnpm override, audit ignore, or license exception was added.
- `gltf-pipeline@4.3.1` was selected instead as the pinned local GLB conversion/optimization CLI because it is Apache-2.0 and passes the current license gate.

## Build Script Approval Notes

No dependency build scripts have been explicitly approved through `pnpm approve-builds` in this slice. pnpm reported ignored build scripts for development dependencies such as `esbuild`, `mongodb-memory-server`, and `protobufjs`; those remain package-manager defaults rather than local allow-list exceptions.

## Historical Exceptions

None.
