# Proposal: IWSDK Phase 2 Sharp Native Libvips Exception

Status: Proposed on 2026-05-04 after a sidecar-only `@iwsdk/vite-plugin-dev@0.3.1` install attempt exposed blocked `@img/sharp-libvips-*` native transitive packages. Awaiting Patrick/legal/security approval before reinstalling or committing the package.

## Decision Needed

Approve, reject, or defer a license/security exception for the native `@img/sharp-libvips-*` transitive path brought in through `sharp` by `@iwsdk/vite-plugin-dev@0.3.1`.

## Context

Patrick approved [Proposal: IWSDK Phase 2 Devtools](proposals/approved/proposal-iwsdk-phase2-devtools.md), allowing sidecar-only evaluation of `@iwsdk/vite-plugin-dev@0.3.1` when useful. Codex ran the preinstall gate successfully with:

```bash
pnpm iwsdk:preinstall -- --proposal docs/openclinxr/iwsdk-phase2-devtools-preinstall-proposal.json --approved-phase2-devtools --output docs/openclinxr/iwsdk-phase2-devtools-preinstall-report-2026-05-04.json
```

The actual install then pulled `sharp@0.33.5`, which is Apache-2.0 itself. Codex later double-checked the current public sharp repository license metadata and `sharp@0.34.5` npm metadata on 2026-05-04; both still report Apache-2.0. The blocker is narrower: sharp's optional native dependency set includes `@img/sharp-libvips-*` packages, and both `@img/sharp-libvips-darwin-arm64@1.0.4` and the current `1.2.4` metadata report `LGPL-3.0-or-later`. The workspace posture and license gates blocked that native binary-package path:

- `docs/openclinxr/iwsdk-phase2-devtools-workspace-posture-2026-05-04.json`
- `pnpm security:licenses` failed on `@img/sharp-libvips-darwin-arm64@1.0.4`

Codex rolled the package and lockfile changes back before committing, so the current workspace remains license-clean.

## Options

1. Reject the exception.
   Keep `@iwsdk/vite-plugin-dev` uninstalled. Continue using Quest CDP, Chrome DevTools MCP, Browser Use, and manual headset testing for XR evidence.

2. Approve a sidecar-only devDependency exception.
   Permit `@iwsdk/vite-plugin-dev@0.3.1`, `sharp@0.33.5`, and exact-versioned `@img/sharp-libvips-*` native transitive packages only inside `apps/ui-xr-iwsdk-spike`, only for local devtool evidence, never production deployment, and with a markdown license exception record plus explicit `pnpm audit` and `pnpm security:licenses` exception metadata.

3. Defer and seek a no-native-libvips path.
   Investigate whether IWSDK devtools can disable screenshot resizing or use an alternate dependency path that avoids the native `@img/sharp-libvips-*` packages. This may require upstream issue work or a local fork, and should not modify `packages/cellix`.

## Recommendation

Defer or reject for now. The value of IWSDK MCP/browser tooling is real, but the existing Quest CDP harness, browser verification, and manual headset path are already producing useful evidence. `sharp` itself is Apache-2.0; accepting the native `@img/sharp-libvips-*` LGPL path should still be an explicit legal/security decision, not a side effect of a devtool install.

If Patrick approves the exception, Codex should:

- Add a dedicated license exception markdown file explaining scope and rationale.
- Extend the license checker to allow only the exact sidecar devtool transitive package/version set.
- Keep `@iwsdk/vite-plugin-dev` out of production and default `pnpm verify`.
- Run `pnpm iwsdk:workspace:posture -- --approved-sidecar --approved-phase2-devtools`.
- Run `pnpm security:audit`, `pnpm security:licenses`, sidecar typecheck/tests/build, and then full `pnpm verify`.

## Pros

- Unlocks IWSDK MCP-driven scene hierarchy, browser screenshots, console capture, controller emulation, and agent-mode tooling.
- Could accelerate XR iteration without relying solely on physical Quest interaction.
- Keeps the risk localized to an approved sidecar if policy checks remain strict.

## Cons

- Introduces LGPL-licensed native `@img/sharp-libvips-*` transitive packages into the lockfile.
- Adds Playwright, MCP SDK, WebSocket, IWER, and sharp dependency weight to local install.
- `@iwsdk/vite-plugin-dev@0.3.1` still has a Vite 7 peer range while OpenClinXR uses Vite 8.
- Does not replace physical Quest foreground frame pacing, comfort, controller latency, or text-readability evidence.

## Evidence

- Preinstall report: `docs/openclinxr/iwsdk-phase2-devtools-preinstall-report-2026-05-04.json`
- Failed transient workspace posture report: `docs/openclinxr/iwsdk-phase2-devtools-workspace-posture-2026-05-04.json`
- Approved parent proposal: `proposals/approved/proposal-iwsdk-phase2-devtools.md`
- Sharp license source record: `sources/sharp-license-2026-05-04.json`
- Local npm metadata check: `sharp@0.33.5` and `sharp@0.34.5` report `Apache-2.0`; `@img/sharp-libvips-darwin-arm64@1.0.4` and `@img/sharp-libvips-darwin-arm64@1.2.4` report `LGPL-3.0-or-later`.
