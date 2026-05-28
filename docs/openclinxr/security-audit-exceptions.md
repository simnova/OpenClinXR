# Security Audit Exceptions

Date: 2026-05-21
Status: No active security audit exceptions; active package-manager overrides and version-pinned license inventory normalizations are recorded below.

## Policy

OpenClinXR runs `pnpm audit --audit-level=high` as part of `pnpm verify`. Production-only and dev-only checks are available through `pnpm security:audit:prod` and `pnpm security:audit:dev`.

`pnpm security:audit-policy` validates that the hard audit scripts remain in the default verification path and that any future high or critical audit exception is recorded in a machine-checkable form before it is allowed to coexist with audit evidence.

To preserve a point-in-time audit evidence artifact, run:

```bash
pnpm security:audit:snapshot
```

or run manually:

```bash
pnpm audit --json > docs/openclinxr/security-audit-YYYY-MM-DD.json
pnpm security:audit-policy -- --audit-json docs/openclinxr/security-audit-YYYY-MM-DD.json --output docs/openclinxr/security-audit-policy-YYYY-MM-DD.json
```

The latest local audit evidence is:

- `docs/openclinxr/security-audit-2026-05-21.json`
- `docs/openclinxr/security-audit-policy-2026-05-21.json`

## Audit Cadence (Backlog-Tracked)

Run a recurring point-in-time snapshot at least weekly (or after any dependency lockfile change) and keep evidence in `docs/openclinxr/`.

Recommended cadence:

- **Weekly baseline:** after dependency reviews, or at least every Tuesday.
- **Post-change snapshot:** immediately after any dependency update that changed lockfile inputs.
- **Before major milestones:** run one extra snapshot before any proposal handoff that changes verification posture.

Command:

```bash
pnpm audit --audit-level=high --json > docs/openclinxr/security-audit-YYYY-MM-DD.json
pnpm security:audit-policy -- --audit-json docs/openclinxr/security-audit-YYYY-MM-DD.json --output docs/openclinxr/security-audit-policy-YYYY-MM-DD.json
```

Update both the timestamped file references in this document and the validation worker matrix when a newer snapshot replaces the prior one.

Detailed cadence steps also live in:

- [docs/openclinxr/security-audit-cadence.md](security-audit-cadence.md)

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

Any pnpm audit ignore must link back to an exception entry in this file. Any package-manager override must be recorded under Active Package Manager Overrides.

## License Policy Gate

OpenClinXR runs:

```bash
pnpm security:licenses
```

The gate reads `pnpm licenses list --json`, fails on AGPL/GPL/LGPL/SSPL/non-commercial/proprietary/unknown/unlicensed dependency records, applies only version-pinned license-file normalizations recorded in this file, and reports review-only licenses separately. The latest local report is:

- `docs/openclinxr/dependency-license-policy-2026-05-05.json`

## Active Exceptions

None.

## Active Package Manager Overrides

| Package | Pinned version | Rationale | Owner | Review-by | Removal condition |
| --- | --- | --- | --- | --- | --- |
| `brace-expansion` | `5.0.6` | Force transitive minimatch users onto the patched release that resolves the brace-expansion ReDoS advisory while upstream toolchain packages catch up. | security-posture-steward | 2026-06-27 | Remove when all lockfile paths resolve `brace-expansion >=5.0.6` without a root override. |
| `fast-uri` | `3.1.2` | Force AJV's transitive URI parser onto the patched version that resolves GHSA-q3j6-qgpj-74h6 and GHSA-v39h-62p7-jpjc while keeping `ajv@8.20.0` pinned. | security-posture-steward | 2026-06-21 | Remove when `ajv` or the lockfile resolves `fast-uri >=3.1.2` without a root override. |
| `hono` | `4.12.18` | Keep direct API packages and transitive MCP/IWSDK dev-tool paths on the patched release that resolves current Hono audit advisories. | security-posture-steward | 2026-06-27 | Remove when every workspace package and transitive lockfile path resolves `hono >=4.12.18` without a root override. |
| `ip-address` | `10.1.1` | Force express-rate-limit transitive resolution in the IWSDK dev-tool spike onto the patched release while preserving the isolated sidecar evaluation. | security-posture-steward | 2026-06-27 | Remove when the IWSDK dev-tool path resolves `ip-address >=10.1.1` without a root override or the sidecar spike is removed. |
| `protobufjs` | `8.2.0` | Force Cesium/gltf-pipeline transitive resolution onto the patched release while the legacy local GLTF CLI remains installed. `@gltf-transform/core` Node API is now the preferred replacement candidate for source-smoke/runtime gates. | security-posture-steward | 2026-06-27 | Remove when `gltf-pipeline` is removed/isolated or all remaining GLTF tooling resolves `protobufjs >=8.2.0` without a root override. |
| `qs` | `6.15.2` | Force transitive Express/MCP/IWSDK dev-tool resolution onto the patched release that resolves the qs prototype pollution advisory. | security-posture-steward | 2026-06-27 | Remove when all lockfile paths resolve `qs >=6.15.2` without a root override. |
| `rolldown` | `1.0.0-rc.18` | Keep packaging and local preview bundling aligned while the existing build scripts are validated against this pinned `rolldown` version. | frontend-platform-lead | 2026-06-05 | Remove when the full stack lockfile and workspace overrides can be moved to a newer pinned version after compatibility validation. |
| `three` | `0.184.0` | Keep IWSDK sidecar and production XR packages on one reviewed Three.js version while `@iwsdk/core` permits a broad Three.js range. | frontend-platform-lead | 2026-06-05 | Remove when all workspace packages declare the same exact Three.js version without a root override. |
| `ws` | `8.20.1` | Keep the mock realtime voice server and transitive GraphQL/IWSDK dev-tool WebSocket paths on the patched release that resolves the ws DoS advisory. | security-posture-steward | 2026-06-27 | Remove when all workspace packages and transitive lockfile paths resolve `ws >=8.20.1` without a root override. |

## Active License Inventory Normalizations

These are not copyleft, vulnerability, or audit-ignore exceptions. They normalize package records where `pnpm licenses list --json` reports `Unknown` because `package.json` says `SEE LICENSE IN LICENSE`, while the installed package contains MIT license text and the upstream repository records the same MIT license text.

| Package | Version | Reported by pnpm | Effective license | Evidence | Removal condition |
| --- | ---: | --- | --- | --- | --- |
| `@pmndrs/handle` | `6.6.29` | `Unknown` | MIT | Installed `LICENSE`; [pmndrs/xr LICENSE](https://github.com/pmndrs/xr/blob/main/LICENSE) | Remove when pnpm reports MIT or package metadata uses a standard SPDX license. |
| `@pmndrs/pointer-events` | `6.6.29` | `Unknown` | MIT | Installed `LICENSE`; [pmndrs/xr LICENSE](https://github.com/pmndrs/xr/blob/main/LICENSE) | Remove when pnpm reports MIT or package metadata uses a standard SPDX license. |
| `@pmndrs/uikit` | `1.0.64` | `Unknown` | MIT | Installed `LICENSE`; [pmndrs/uikit LICENSE](https://github.com/pmndrs/uikit/blob/main/LICENSE) | Remove when pnpm reports MIT or package metadata uses a standard SPDX license. |
| `@pmndrs/uikit` | `1.0.66` | `Unknown` | MIT | Installed `LICENSE`; [UIKitML sidecar evidence](uikitml-spatial-text-sidecar-2026-05-05.md); [pmndrs/uikit LICENSE](https://github.com/pmndrs/uikit/blob/main/LICENSE) | Remove when pnpm reports MIT, package metadata uses a standard SPDX license, or the UIKitML sidecar spike is removed. |

## Active Review-Only License Findings

These are not blockers and are not audit exceptions. They remain visible because they carry terms that are acceptable for local sidecar evaluation but should be revisited before production packaging.

| Package | Version | Reported by pnpm | Evidence | Removal condition |
| --- | ---: | --- | --- | --- |
| `@pmndrs/msdfonts` | `1.0.66` | `SIL OPEN FONT LICENSE Version 1.1 OR OFL` | Installed `LICENSE`; [UIKitML sidecar evidence](uikitml-spatial-text-sidecar-2026-05-05.md) records Roboto under Apache-2.0 and listed Google Fonts under SIL OFL 1.1. | Remove when UIKitML sidecar spike is removed, or replace with a narrower reviewed font subset before production spatial UI adoption. |

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

- `@gltf-transform/cli@4.3.0` remains dev-only and review-gated because its CLI dependency path installs `sharp@0.34.x` and native `@img/sharp-libvips-*` packages. Do not promote the CLI path into production/runtime adoption without an explicit license review.
- `@gltf-transform/core` resolved at `4.3.0` is the preferred local Node API replacement candidate for deterministic GLB source-smoke evidence. It avoids relying on the blocked GLTF Transform CLI path and is already used by humanoid/asset tooling.
- `gltf-pipeline@4.3.1` remains the legacy pinned local GLB conversion/optimization CLI because it is Apache-2.0 and passes the current license gate. Do not remove it until `pnpm hygiene:e18e:summary`, `pnpm peers check`, and `pnpm hooks:strict` show that removal or isolation is safe and beneficial.

## Build Script Approval Notes

No dependency build scripts have been explicitly approved through `pnpm approve-builds` in this slice. pnpm reported ignored build scripts for development dependencies such as `esbuild`, `mongodb-memory-server`, and `protobufjs`; those remain package-manager defaults rather than local allow-list exceptions.

## Historical Exceptions

None.
