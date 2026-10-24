# Approved sidecar-only LGPL exception extension: libvips 1.3.4 — 2026-10-21

## Authority

- 2026-05-04: Patrick Gidich approved the IWSDK Phase 2 sidecar-only devDependency
  exception for `@img/sharp-libvips-*@1.0.4/1.0.5/1.2.4` (history retained verbatim
  in the checker reason and in
  [sharp-libvips-1.3.0-exception-2026-10-20.md](./sharp-libvips-1.3.0-exception-2026-10-20.md),
  which is unchanged by this extension). Current enforcement lives in
  [check-license-policy.ts](../../../../tools/openclinxr/evidence/check-license-policy.ts)
  (exception template and dev-only context gate) with regression coverage in
  [check-license-policy.test.ts](../../../../tools/openclinxr/evidence/check-license-policy.test.ts).
- 2026-10-20: Patrick explicitly approved the narrow extension to 1.3.0, replying
  **"Approve dev-only libvips 1.3.0 exception"**. Scope granted: 1.3.0 only; dev
  sidecar/tooling restrictions unchanged. That consent is retained, not replaced.
- 2026-10-21: Patrick explicitly approved the narrow extension to 1.3.4, replying
  **"Approve dev-only libvips 1.3.4 exception"** to the sharp@0.35.5 proposal.
  Scope granted: 1.3.4 only; same production restrictions unchanged.

## Exact scope

- Package family: `@img/sharp-libvips-*` (name prefix match, unchanged).
- Versions covered after extension: `1.0.4`, `1.0.5`, `1.2.4`, `1.3.0`, `1.3.4`.
  Nothing else.
- Reported license: `LGPL-3.0-or-later` only (verified on the npm registry version
  doc for `@img/sharp-libvips-linux-x64@1.3.4`: `"license": "LGPL-3.0-or-later"`,
  same SPDX identifier and licensor family as the already-approved versions;
  sharp@0.35.5 lists `@img/sharp-libvips-*@1.3.4` in optionalDependencies).
- Context gate (unchanged): applies only when the sidecar devtool pin is exactly
  `@iwsdk/vite-plugin-dev === "0.3.1"` in `apps/arena/ui-xr-iwsdk-spike/package.json`.
- Usage scope: sidecar/dev tooling only (IWSDK dev plugin sharp path, dev-only GLTF
  Transform CLI/tooling sharp path). Never production.

## Why 1.3.4 and not a downgrade

The previously installed `sharp@0.35.0` is red on two HIGH sharp advisories, both patched at
sharp 0.35.5: GHSA-rgj7-g3m4-5g8c (libheif chain, patched `>=0.35.4`) and
GHSA-wq5f-xc86-pv6w (librsvg dependency, CVE-2026-96889, patched `>=0.35.5`).
Bumping sharp to 0.35.5 resolves all sharp consumers onto libvips binaries 1.3.4,
which the previous exact-version set (through 1.3.0) does not cover — so the
license gate would block the security bump without this extension. Downgrading
sharp below the advisory floor reintroduces HIGH CVEs and trips
`pnpm audit --audit-level=high`.

## Regression coverage (candidate tests, parent runs on integration)

- `allows libvips 1.3.4 under the approved dev-only gate extension` — 1.3.4 with the
  gate on yields `APPROVED-SIDECAR-EXCEPTION`, zero blockers.
- `still blocks libvips 1.3.4 when the dev-only gate is off` — 1.3.4 with the gate
  off stays `LGPL-3.0-or-later` blocked (production scope stays blocked).
- `does not widen the extension to the neighboring unapproved 1.3.5` — 1.3.5 stays
  blocked even with the gate on.

## Coupling notice

This approval greens `security:licenses` only. It does not claim sharp@0.35.0 (or
any sharp line) is security-clean, and it fixes no other audit findings. If sharp
is later bumped and resolves a libvips version outside the §Exact-scope set, a
fresh approval is required. No security pin was changed by this extension.
