# Approved sidecar-only LGPL exception extension: libvips 1.3.0 — 2026-10-20

## Authority

- 2026-05-04: Patrick Gidich approved the IWSDK Phase 2 sidecar-only devDependency
  exception for `@img/sharp-libvips-*@1.0.4/1.0.5/1.2.4` (historical approval record
  formerly filed under `proposals/approved/`; that directory is no longer present in the
  repo, so the historical path is named here as a non-link reference only — no linked
  approval document is claimed). Current enforcement lives in
  [check-license-policy.ts](../../../tools/openclinxr/evidence/check-license-policy.ts)
  (exception template and dev-only context gate) with regression coverage in
  [check-license-policy.test.ts](../../../tools/openclinxr/evidence/check-license-policy.test.ts).
- 2026-10-20: Patrick explicitly approved the narrow extension to 1.3.0, replying
  **"Approve dev-only libvips 1.3.0 exception"**. Scope granted: 1.3.0 only; dev
  sidecar/tooling restrictions unchanged.

## Exact scope

- Package family: `@img/sharp-libvips-*` (name prefix match, unchanged).
- Versions covered after extension: `1.0.4`, `1.0.5`, `1.2.4`, `1.3.0`. Nothing else.
- Reported license: `LGPL-3.0-or-later` only (verified on the npm registry version doc for
  `@img/sharp-libvips-darwin-arm64@1.3.0`: `"license": "LGPL-3.0-or-later"`, same SPDX
  identifier and licensor as the already-approved family).
- Context gate (unchanged): applies only when the sidecar devtool pin is exactly
  `@iwsdk/vite-plugin-dev === "0.3.1"` in `apps/arena/ui-xr-iwsdk-spike/package.json`.
- Usage scope: sidecar/dev tooling only (IWSDK dev plugin sharp path, dev-only GLTF
  Transform CLI/tooling sharp path). Never production.

## Why 1.3.0 and not a downgrade

The security-mandated root override `sharp: "0.35.0"` (`pnpm-workspace.yaml`,
owner security-posture-steward, libvips advisory floor for GHSA-f88m-g3jw-g9cj) resolves all
sharp consumers onto sharp 0.35.0 → libvips binaries 1.3.0. Downgrading sharp below 0.35.0
reintroduces HIGH libvips CVEs and trips `pnpm audit --audit-level=high`; sharp 0.34.x
resolves libvips 1.2.3 (also HIGH-affected and unapproved). No safe licensed alternative
exists. Full primary evidence: license-provenance research record of 2026-10-20.

## Regression coverage (candidate tests, parent runs on integration)

- `allows libvips 1.3.0 under the approved dev-only gate extension` — 1.3.0 with the gate
  on yields `APPROVED-SIDECAR-EXCEPTION`, zero blockers.
- `still blocks libvips 1.3.0 when the dev-only gate is off` — 1.3.0 with the gate off
  stays `LGPL-3.0-or-later` blocked.
- `does not widen the extension to neighboring unapproved versions (1.2.3, 1.3.1)` — other
  LGPL versions stay blocked even with the gate on.

## Coupling notice

`pnpm audit --audit-level=high` independently flags the pinned `sharp@0.35.0` (libheif chain,
patch ≥0.35.4; librsvg CVE-2026-96889, patch ≥0.35.5). This approval greens
`security:licenses` only. If sharp is later bumped and resolves a libvips version outside the
§Exact-scope set, a fresh approval is required. No security pin was changed by this extension.
