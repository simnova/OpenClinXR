# Security Audit Exceptions

Date: 2026-05-03
Status: No active exceptions

## Policy

OpenClinXR runs `pnpm audit --audit-level=high` as part of `pnpm verify`. Production-only and dev-only checks are available through `pnpm security:audit:prod` and `pnpm security:audit:dev`.

Exceptions are allowed only when all of the following are recorded here:

- Advisory ID or GHSA.
- Affected package and dependency path.
- Why upgrade, removal, replacement, or pnpm override is not immediately feasible.
- Compensating control or blast-radius note.
- Owner.
- Review-by date.
- Planned removal condition.

Any package-manager override or pnpm audit ignore must link back to an exception entry in this file.

## License Policy Gate

OpenClinXR runs:

```bash
pnpm security:licenses
```

The gate reads `pnpm licenses list --json`, fails on AGPL/GPL/LGPL/SSPL/non-commercial/proprietary/unknown/unlicensed dependency records, and reports review-only licenses separately. The latest local report is:

- `docs/openclinxr/dependency-license-policy-2026-05-03.json`

## Active Exceptions

None.

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
