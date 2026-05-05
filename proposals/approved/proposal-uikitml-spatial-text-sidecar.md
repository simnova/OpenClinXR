# Proposal: UIKitML Spatial Text Sidecar

**Status:** Approved  
**Approved by:** Patrick Gidich on 2026-05-05  
**Decision:** Approved with clarifications  
**Requested by:** Codex, after read-only UIKitML package and integration assessment on 2026-05-05  
**Scope:** `apps/ui-xr-iwsdk-spike` only

## Approval Clarifications

- Vite 8 compatibility with `@iwsdk/vite-plugin-uikitml@0.3.1` must be explicitly verified and documented before any code or lockfile changes are committed.
- `@pmndrs/uikit` license must be reviewed and recorded before install.
- This remains a text readability comparison spike only; broader spatial UI adoption requires a separate proposal.
- Codex may install the proposed packages in `apps/ui-xr-iwsdk-spike` only, add minimal `.uikitml` source files for text panel testing, run local build/tests/desktop-IWER visual evidence, and commit only after verification passes and clarifications are addressed.
- Codex must not add UIKitML dependencies to `apps/ui-xr` or shared production packages, commit generated UI blobs without reviewed source and provenance, ignore Vite 8 peer mismatch, or claim Quest text readiness from sidecar/IWER evidence alone.

## Decision Needed

Approved: run a constrained sidecar-only spike to evaluate UIKitML for readable spatial text panels in the IWSDK sidecar.

This approval would allow Codex to install the package set below in `apps/ui-xr-iwsdk-spike`, add reviewed `.uikitml` source files, compile local dev assets, and collect desktop/IWER/Quest readability evidence. It would not authorize production adoption, runtime changes in `apps/ui-xr`, or unreviewed generated UI blobs.

## Recommendation

Approve a gated sidecar spike, but keep it out of production until the sidecar proves better readability and acceptable Quest performance.

UIKitML is a plausible replacement for the current duplicated canvas-texture text path in the XR apps. It may provide sharper spatial text, cleaner layout semantics, and better input affordances for simulated EHR/case-note panels. The risk is dependency and tooling maturity: the published IWSDK UIKitML Vite plugin currently declares a Vite 7 peer range while OpenClinXR is on Vite 8.

## Proposed Package List

| Package | Version | License posture | Role |
| --- | ---: | --- | --- |
| `@iwsdk/vite-plugin-uikitml` | `0.3.1` | MIT | Vite compiler for `.uikitml` assets |
| `@pmndrs/uikitml` | `0.1.12` | MIT | UIKitML parser/compiler runtime dependency |
| `@pmndrs/uikit` | `1.0.66` | npm metadata says `SEE LICENSE IN LICENSE`; upstream license text is MIT-style and must be reviewed before install | Spatial UI primitives used by UIKitML/IWSDK |
| `@iwsdk/core` | `0.3.1` | MIT | Already sidecar-approved and installed; provides IWSDK runtime surface |
| `three` | `0.184.0` | MIT | Already sidecar-approved and installed |
| `vite` | `8.0.10` | MIT | Existing repo Vite version; creates peer mismatch risk with the plugin |

Package install is authorized only within `apps/ui-xr-iwsdk-spike` and only after the Vite 8 and license clarifications are addressed.

## License And Compatibility Precheck

- `npm view @iwsdk/vite-plugin-uikitml@0.3.1 peerDependencies dependencies license --json` on 2026-05-05 reported license `MIT`, dependency `@pmndrs/uikitml: ^0.1.12`, and Vite peer range `^7.0.0`; this confirms the Vite 8 mismatch must be explicitly tested.
- `npm view vite version` reported `8.0.10` and `npm view @iwsdk/vite-plugin-uikitml version` reported `0.3.1` on 2026-05-05.
- `npm pack @pmndrs/uikit@1.0.66` was inspected in `/tmp/openclinxr-npm-inspect` on 2026-05-05.
- `@pmndrs/uikit@1.0.66` metadata reports `SEE LICENSE IN LICENSE`; the tarball `LICENSE` contains MIT-style permission terms with copyright attribution to Bela Bohlender and Coconut Capital.
- The implementation must record the exact install outcome, peer warnings, lockfile diff, Vite 8 build result, and any generated artifact provenance before commit.

## Explicit Scope

- Sidecar-only: `apps/ui-xr-iwsdk-spike`.
- No production adoption in `apps/ui-xr`.
- No shared package dependency on UIKitML unless a later proposal approves it.
- No committed generated `.json` UI blobs unless their source `.uikitml`, compiler version, license posture, and diff impact are reviewed.
- No cloud/API usage, paid services, hosted assets, or production credentials.
- No change to default Quest readiness claims; UIKitML evidence remains text-rendering evidence until worn-headset observations pass.

## Vite 8 Peer Mismatch Risk

The read-only assessment found `@iwsdk/vite-plugin-uikitml@0.3.1` declaring `vite: ^7.0.0`, while this repo currently uses `vite@8.0.10`. The spike must treat this as an explicit compatibility risk.

Before commit, Codex must verify the plugin import shape from installed type declarations, confirm Vite 8 build behavior, and record any peer warning or workaround. If the package manager refuses the install, if the plugin fails under Vite 8, or if compatibility requires broad workspace downgrades, rollback immediately and leave this proposal unimplemented.

## Pros

- Likely sharper in-XR text than canvas texture panels after scaling and head movement.
- Gives case notes, simulated EHR panels, checklists, and encounter prompts a more maintainable authoring model.
- Keeps complex text experimentation inside the already-gated IWSDK sidecar.
- Produces a clean comparison point against HTML-in-canvas and current manual canvas wrapping.
- Aligns with the longer-term need for spatial UI evidence in both Full VR and Mixed Reality paths.

## Cons

- Adds another Vite plugin with a Vite 7 peer range into a Vite 8 workspace.
- Adds UIKit/uikitml runtime surface area before production text requirements are fully proven.
- `@pmndrs/uikit` license metadata is not a plain SPDX string and needs explicit review.
- Generated UI JSON can become opaque if committed without source and compiler provenance.
- Better desktop or IWER text does not automatically prove Quest readability, comfort, or performance.

## Verification Plan

- Install only in `apps/ui-xr-iwsdk-spike` after approval.
- Inspect installed `dist/index.d.ts` and record the correct Vite plugin import shape before editing config.
- Add one minimal `.uikitml` panel source for case-note or station-status text.
- Compile locally and keep generated assets uncommitted unless reviewed.
- Run sidecar checks, including at minimum:
  - `pnpm --filter @openclinxr/ui-xr-iwsdk-spike test`
  - `pnpm --filter @openclinxr/ui-xr-iwsdk-spike build`
  - `pnpm iwsdk:verify`
  - `pnpm security:licenses`
  - `pnpm security:audit`
  - `git diff --check`
- Capture browser or IWER screenshot evidence with adversarial notes on text readability, clipping, occlusion, scale, and clinical usability.
- Keep physical Quest readability and frame-pacing evidence separate from automated sidecar evidence.

## Rollback

If install, license review, Vite 8 compatibility, build, or visual evidence fails:

- Remove `@iwsdk/vite-plugin-uikitml` and any newly introduced UIKitML-only packages from `apps/ui-xr-iwsdk-spike/package.json`.
- Revert lockfile changes from the spike.
- Remove generated UI assets and any unreviewed `.uikitml` sample files.
- Restore the prior IWSDK sidecar Vite config.
- Record the failure as evidence or backlog notes rather than forcing adoption.

## Operator Approval Boundaries

Approval would allow Codex to:

- Install the proposed package set in `apps/ui-xr-iwsdk-spike` only.
- Add sidecar-owned `.uikitml` source files.
- Run local-only compiler/build/evidence commands.
- Commit reviewed source/config/evidence changes if verification passes.

Approval would not allow Codex to:

- Add UIKitML or IWSDK spatial UI dependencies to `apps/ui-xr` or shared production packages.
- Commit generated UI JSON blobs without source/provenance review.
- Ignore the Vite 8 peer mismatch or suppress it without recording evidence.
- Use cloud services, paid APIs, hosted assets, or production credentials.
- Claim Quest text readiness without a later human worn-headset report.

## Sources

- Read-only UIKitML assessment by background agent on 2026-05-05.
- Local `pnpm view` metadata queries from that assessment for `@iwsdk/vite-plugin-uikitml`, `@pmndrs/uikitml`, `@pmndrs/uikit`, and `@iwsdk/core`.
- IWSDK UIKitML docs: https://iwsdk.dev/concepts/spatial-ui/uikitml
- IWSDK spatial UI overview: https://iwsdk.dev/concepts/spatial-ui/
- IWSDK Chapter 10 UIKitML guide: https://iwsdk.dev/guides/10-spatial-ui-uikitml
- pmndrs/uikit license: https://github.com/pmndrs/uikit/blob/main/LICENSE
