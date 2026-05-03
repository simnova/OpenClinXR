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
- `pnpm security:licenses -- --output docs/openclinxr/dependency-license-policy-2026-05-03.json`: 459 dependency license records checked, 0 blockers, 5 review-only findings.
- `pnpm knip --version`: `6.11.0`.
- `pnpm e18e-cli --version`: `0.5.0`.

## Historical Exceptions

None.
