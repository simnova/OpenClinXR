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

Current retained snapshot: `docs/openclinxr/security-audit-2026-08-02.json` + `docs/openclinxr/security-audit-policy-2026-08-02.json` (high+ critical clear; low/moderate only). Re-run `pnpm security:audit:snapshot` after dependency/lockfile changes or before release milestones.

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

The gate reads `pnpm licenses list --json`, fails on AGPL/GPL/LGPL/SSPL/non-commercial/proprietary/unknown/unlicensed dependency records, applies only version-pinned license-file normalizations recorded in this file, and reports review-only licenses separately. Historical license reports are not retained as active evidence by default; rerun `pnpm security:licenses` for current posture.

## Active Exceptions

None.

## Active Package Manager Overrides

| Package | Pinned version | Rationale | Owner | Review-by | Removal condition |
| --- | --- | --- | --- | --- | --- |
| `brace-expansion` | `5.0.12` | Force transitive minimatch users onto the patched 5.x line that resolves brace-expansion DoS advisories (GHSA-q2hr-2g5m-vwhr / GHSA-qhr7-859c-m2p7 / GHSA-6j4f-fj2g-mc7p; compatible floor >=5.0.11 high, 5.0.12 also clears moderate 1240103). | security-posture-steward | 2026-10-21 | Remove when all lockfile paths resolve `brace-expansion >=5.0.12` without a root override. |
| `minimatch@9>brace-expansion` | `2.1.7` | Path-specific pin for minimatch 9 (glob/@donmccurdy/caporal) onto brace-expansion 2.1.7 while the default override remains on the 5.x line (GHSA-q2hr / GHSA-qhr7 / GHSA-6j4f on the 2.x line; floor >=2.1.6 high, 2.1.7 also clears moderate 1240101). | security-posture-steward | 2026-10-21 | Remove when minimatch 9 consumers resolve `brace-expansion >=2.1.7` without a path override. |
| `fast-uri` | `3.1.8` | Force AJV's transitive URI parser onto the patched 3.x line (GHSA-7p8r host confusion; GHSA-5jgf / GHSA-f65p / GHSA-fph4 / GHSA-jqff SSRF and host-confusion; GHSA-qw65 authority injection; floor >=3.1.7 high, 3.1.8 also clears moderate GHSA-hrr3; stay 3.x not 4.x). | security-posture-steward | 2026-10-21 | Remove when `ajv` or the lockfile resolves `fast-uri >=3.1.8` without a root override. |
| `form-data` | `4.0.6` | Force transitive form-data (gltf-transform / node-fetch types) onto the CRLF-injection fix. | security-posture-steward | 2026-09-01 | Remove when all lockfile paths resolve `form-data >=4.0.6` without a root override. |
| `hono` | `4.12.33` | Keep API and mock voice server on the patched Hono release for GHSA-88fw. | security-posture-steward | 2026-09-01 | Remove when every workspace package and transitive path resolves `hono >=4.12.25` without a root override. |
| `immutable` | `5.1.8` | Force graphql-codegen / relay-compiler transitive immutable onto the patched 5.1.8 line. | security-posture-steward | 2026-09-01 | Remove when codegen paths resolve `immutable >=5.1.8` without a root override. |
| `ip-address` | `10.3.1` | Force express-rate-limit transitive resolution in the IWSDK dev-tool spike onto the patched release (GHSA-mwp4-54f8-5fhr; compatible floor >=10.3.1 high; moderates up to 10.7.1 remain follow-up) while preserving the isolated sidecar evaluation. | security-posture-steward | 2026-10-21 | Remove when the IWSDK dev-tool path resolves `ip-address >=10.3.1` without a root override or the sidecar spike is removed. |
| `js-yaml` | `4.3.2` | Force cosmiconfig / graphql-codegen transitive js-yaml onto the patched 4.x line (GHSA-5p4m-2wfm-xmqj; GHSA-2883-xcg3-v3hh; floor >=4.3.2; stay 4.x not 5.x). | security-posture-steward | 2026-10-21 | Remove when all lockfile paths resolve `js-yaml >=4.3.2` without a root override. |
| `postcss` | `8.5.18` | Force Vite/Vitest transitive postcss onto the source-map path traversal fix. | security-posture-steward | 2026-09-01 | Remove when all lockfile paths resolve `postcss >=8.5.18` without a root override. |
| `protobufjs` | `8.4.1` | Force Cesium/gltf-pipeline transitive protobufjs onto the patched release. | security-posture-steward | 2026-09-01 | Remove when `gltf-pipeline` is removed/isolated or remaining GLTF tooling resolves `protobufjs >=8.4.1` without a root override. |
| `qs` | `6.15.2` | Force transitive Express/MCP/IWSDK dev-tool resolution onto the patched release that resolves the qs prototype pollution advisory. | security-posture-steward | 2026-09-01 | Remove when all lockfile paths resolve `qs >=6.15.2` without a root override. |
| `react-router` | `8.3.0` | Align ui-admin and any transitive react-router consumers on 8.3.0 (closes GHSA-8x6r, GHSA-chx6, GHSA-qwww). Requires React >=19.2.7. | security-posture-steward | 2026-09-01 | Remove when ui-admin declares `react-router >=8.3.0` without a root override. |
| `rolldown` | `1.0.0-rc.18` | Keep packaging and local preview bundling aligned while the existing build scripts are validated against this pinned `rolldown` version. | frontend-platform-lead | 2026-09-01 | Remove when the full stack lockfile and workspace overrides can be moved to a newer pinned version after compatibility validation. |
| `sharp` | `0.35.5` | Force gltf-transform CLI and IWSDK dev-tool sharp onto the libvips advisory floor >=0.35.5 (GHSA-rgj7-g3m4-5g8c patched >=0.35.4; GHSA-wq5f-xc86-pv6w / CVE-2026-96889 patched >=0.35.5) while those tools remain local/dev-only. | security-posture-steward | 2026-09-01 | Remove when `@gltf-transform/*` and IWSDK paths resolve `sharp >=0.35.5` without a root override, or sharp is isolated behind a capability gate. |
| `shell-quote` | `1.11.0` | Force graphql-codegen transitive shell-quote onto the patched release for the critical newline-escape advisory (GHSA-pqg4-j6r4-53mv audit 1241332; floor >=1.11.0). | security-posture-steward | 2026-10-21 | Remove when codegen paths resolve `shell-quote >=1.11.0` without a root override. |
| `three` | `0.184.0` | Keep IWSDK sidecar and production XR packages on one reviewed Three.js version while `@iwsdk/core` permits a broad Three.js range. | frontend-platform-lead | 2026-09-01 | Remove when all workspace packages declare the same exact Three.js version without a root override. |
| `undici` | `7.29.1` | Force vitest/jsdom transitive undici onto the patched 7.29.x line (GHSA-4cwx cache disclosure; GHSA-rfgv DoS; GHSA-w293 TLS bypass; floor >=7.29.1 minor 7.28->7.29). | security-posture-steward | 2026-10-21 | Remove when vitest/jsdom paths resolve `undici >=7.29.1` without a root override. |
| `vite` | `8.1.6` | Force workspace Vite (apps + vitest) onto the patched 8.1.x floor (GHSA-587h-7wmj-h5pm high plus GHSA-698v / GHSA-r825 moderates; floor >=8.1.6 minor 8.0->8.1; needs frontend-platform validation). | security-posture-steward | 2026-10-21 | Remove when all workspace packages declare `vite >=8.1.6` without a root override. |
| `ws` | `8.21.1` | Keep mock realtime voice server and transitive GraphQL/IWSDK WebSocket paths on the memory-exhaustion fix. | security-posture-steward | 2026-09-01 | Remove when all workspace packages and transitive lockfile paths resolve `ws >=8.21.0` without a root override. |
| `"@fastify/busboy@3"` | `3.2.1` | Scoped pin for @whatwg-node/node-fetch transitive @fastify/busboy onto the patched 3.2.x line (GHSA-xjh9-v7x6-24jw multipart boundary DoS; GHSA-x8mw-p69m-v3mx prototype-named part DoS; floor >=3.2.1). | security-posture-steward | 2026-10-21 | Remove when codegen loader paths resolve `@fastify/busboy >=3.2.1` without a scoped override. |
| `browserslist@4` | `4.28.7` | Scoped pin for babel/helper-compilation-targets transitive browserslist onto the patched 4.28.x line (GHSA-c83g-rgw3-j3cx OOM; GHSA-73wf-gq98-2v4g stats crash; floor >=4.28.7). | security-posture-steward | 2026-10-21 | Remove when toolchain paths resolve `browserslist >=4.28.7` without a scoped override. |
| `follow-redirects@1` | `1.16.1` | Scoped pin for mongodb-memory-server-core transitive follow-redirects onto the patched 1.16.x line (GHSA-q3jh-wrc6-jgq8 credential stripping; GHSA-8r9p-f939-6h3c sensitiveHeaders bypass; floor >=1.16.1). | security-posture-steward | 2026-10-21 | Remove when data-source paths resolve `follow-redirects >=1.16.1` without a scoped override. |
| `nanoid@3` | `3.3.18` | Scoped pin for vite/postcss transitive nanoid onto the patched 3.3.x line (GHSA-28wg-ghj8-5hjv negative-size loop; GHSA-2v37-7h3g-55p8 zero-size loop; floor >=3.3.18; stay 3.x not 6.x). | security-posture-steward | 2026-10-21 | Remove when build paths resolve `nanoid >=3.3.18` without a scoped override. |
| `smol-toml@1` | `1.7.1` | Scoped pin for knip transitive smol-toml onto the patched 1.7.x line (GHSA-7w5x-hrqm-74c2 malformed TOML DoS; floor >=1.7.1 minor 1.6->1.7 dev-only). | security-posture-steward | 2026-10-21 | Remove when hygiene paths resolve `smol-toml >=1.7.1` without a scoped override. |
| `source-map-js@1` | `1.2.2` | Scoped pin for vite/postcss transitive source-map-js onto the patched 1.2.x line (GHSA-68fv-2mgg-jv7q indexed source-map section DoS; floor >=1.2.2). | security-posture-steward | 2026-10-21 | Remove when build paths resolve `source-map-js >=1.2.2` without a scoped override. |
| `"@graphql-tools/executor-legacy-ws@1"` | `1.1.35` | Scoped pin for @graphql-tools/url-loader transitive executor-legacy-ws onto 1.1.35 (GHSA-6fw5-9hq8-w87g TLS certificate validation bypass; floor >=1.1.35 patch; paired with @graphql-tools/utils 12 line per ALT integration). | security-posture-steward | 2026-10-21 | Remove when codegen url-loader paths resolve `executor-legacy-ws >=1.1.35` without a scoped override. |
| `"@graphql-tools/utils@11"` | `12.0.1` | Scoped pin for @graphql-codegen/cli transitive @graphql-tools/utils onto the 12.x line (GHSA-7mx3-vvmw-hjmv mergeDeep prototype pollution; floor >=12.0.1 major 11->12; validated by byte-identical codegen generate, typecheck, build and licenses per parent ALT integration). | security-posture-steward | 2026-10-21 | Remove when codegen paths resolve `@graphql-tools/utils >=12.0.1` without a scoped override, or upstream codegen supports the utils 12 line natively. |

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
