# Proposal: IWER Sidecar Emulation Spike

Status: Proposed on 2026-05-04 19:59 EDT; awaiting Patrick approval before Codex treats IWER-specific emulation runs as an approved evidence lane.

## Decision Needed

Approve a constrained IWSDK sidecar evidence spike that exercises IWER through the already-approved `apps/ui-xr-iwsdk-spike` Phase 2 devtool path. This proposal does not add packages, does not modify production `apps/ui-xr`, does not use cloud or paid APIs, and does not replace physical Quest foreground validation.

## Recommendation

Approve the spike.

IWER is already present locally as a transitive dependency of the approved sidecar-only `@iwsdk/vite-plugin-dev@0.3.1`. That makes the lowest-risk next step an evidence-only run that proves whether IWER can help Codex close the current automated WebXR entry gap in desktop/emulated development, collect repeatable screenshot/video artifacts, and exercise controller/hand/action playback signals before asking Patrick to perform more headset runs.

Keep IWER labeled as emulation evidence. It can improve iteration speed and adversarial visual QA, but it cannot prove Quest 3 foreground frame pacing, thermals, comfort, real controller latency, passthrough behavior, or in-headset readability.

## Proposed Scope

| Item | Proposed value | Posture |
| --- | ---: | --- |
| Sidecar app | `apps/ui-xr-iwsdk-spike` | Existing approved sidecar only |
| Direct devtool | `@iwsdk/vite-plugin-dev@0.3.1` | Already installed as sidecar devDependency |
| IWER runtime | `iwer@2.2.1` | Transitive, MIT, emulation only |
| IWER DevUI | `@iwer/devui@2.2.0` | Transitive, MIT, dev-only |
| IWER SEM | `@iwer/sem@0.2.5` | Transitive, MIT, dev-only |
| MCP command | `pnpm --filter @openclinxr/ui-xr-iwsdk-spike exec iwsdk-dev-mcp` | Local only |
| Dev server | `PORT=5183 pnpm --filter @openclinxr/ui-xr-iwsdk-spike dev:portless` | Local only; port may vary |
| Evidence output | `docs/openclinxr/iwer-sidecar-emulation-evidence-YYYY-MM-DD.json` | Committed report, no screenshots/videos unless storage path is explicitly chosen |

## Evidence To Capture

- Package metadata: names, exact versions, licenses, transitive path through `@iwsdk/vite-plugin-dev`, installed footprint, and Vite peer mismatch.
- MCP/devtool availability: whether `iwsdk-dev-mcp --help` or equivalent local command starts without machine-level trust changes.
- Emulated session entry: whether the sidecar can enter an IWER emulated XR session without a physical Quest click.
- Input coverage: whether controller select, gamepad state, basic hand input, or action playback can be observed.
- Visual QA artifacts: screenshot and, if tooling supports it without adding packages, a short video or frame sequence with adversarial notes on clinical scene fidelity, actor/equipment realism, UI readability, occlusion, scale, interaction affordances, and evidence limits.
- Evidence classification: every artifact must be labeled as desktop/emulated evidence and explicitly marked as not replacing Quest foreground observations.

## Explicitly Out Of Scope

- Adding new packages, including direct `iwer`, `@iwer/*`, browser extension, WebTransport, QUIC, Web3, wallet, DID, or cloud relay packages.
- Running cloud, paid, hosted relay, or third-party API services.
- Production `apps/ui-xr` adoption.
- Committing `.codex/config.toml`, browser extension state, generated screenshots/videos outside an agreed evidence path, or any machine-level trust changes.
- Claiming Quest hardware performance, comfort, thermals, or controller latency from IWER.
- Treating IWER action playback as psychometric validity evidence.

## Pros

- May solve the current automated immersive-entry gap that CDP clicks cannot reliably close because of WebXR user-activation rules.
- Gives adversarial agents repeatable visual artifacts for scene-fidelity critique before more human headset time is needed.
- Uses packages already present through an approved sidecar path, so no new dependency or lockfile risk is introduced by the spike itself.
- Helps separate desktop/emulated confidence from physical Quest evidence in a more disciplined way.

## Cons

- IWER is emulation and can mask real Quest Browser, controller, hand-tracking, thermal, frame pacing, and comfort issues.
- `@iwsdk/vite-plugin-dev@0.3.1` still declares a Vite `^7.0.0` peer while the sidecar uses Vite `8.0.10`; empirical sidecar typecheck/test/build passed, but the peer mismatch remains a caveat.
- Transitive DevUI/SEM footprint is non-trivial: local installed size is about 2.2 MB for `iwer`, 5.7 MB for `@iwer/devui`, and 25 MB for `@iwer/sem`.
- Screenshots/videos can create false confidence unless adversarial notes explicitly call out evidence limits and missing clinical equipment or cues.

## Acceptance Criteria

- `pnpm iwsdk:workspace:posture -- --approved-sidecar --approved-phase2-devtools --approved-sharp-libvips-exception` passes before and after the spike.
- No new dependencies or lockfile changes are introduced.
- Any local server or MCP process is stopped before Codex ends the slice.
- Evidence JSON records exact package versions, licenses, commands run, exit statuses, artifact paths, and blockers.
- Evidence labels IWER as emulation and keeps Quest manual foreground blockers open.
- `pnpm agent:sources`, `pnpm iwsdk:verify`, and a focused sidecar test/build command pass after evidence is committed.

## Rollback

Stop local dev/MCP processes, remove uncommitted evidence files if the spike fails before a useful report is produced, and keep the sidecar dependencies unchanged. If any package or lockfile change appears, revert that change before continuing unless Patrick explicitly approves a new dependency proposal.

## Sources

- `sources/iwer-docs-2026-05-04.json`
- `sources/iwsdk-ai-docs-2026.json`
- `proposals/approved/proposal-iwsdk-phase2-devtools.md`
- `proposals/approved/proposal-iwsdk-phase2-sharp-libvips-exception.md`
- `docs/openclinxr/iwsdk-codex-mcp-runbook.md`
- Local `pnpm-lock.yaml` and installed package metadata for `iwer@2.2.1`, `@iwer/devui@2.2.0`, `@iwer/sem@0.2.5`, and `@iwsdk/vite-plugin-dev@0.3.1`
