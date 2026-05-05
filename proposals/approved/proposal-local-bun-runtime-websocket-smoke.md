# Proposal: Local Bun Runtime WebSocket Smoke

**Status:** Approved  
**Approved by:** Patrick Gidich on 2026-05-05 12:37 EDT  
**Decision:** Approved with clarifications  
**Requested by:** Codex, after local runtime probe found `bun` missing on 2026-05-05  
**Scope:** local workstation runtime only; `apps/api` Bun + Hono WebSocket evidence lane

## Approval Clarifications

- HTTP/3 (`Bun.serve({ h3: true })`) and WebTransport remain out of scope for this smoke.
- Any future HTTP/3 proposal must include a dedicated review of Quest 3 / Quest Browser compatibility.
- Record the exact Bun version and whether `h3: true` was enabled, even when unused.
- Clearly distinguish pre-VR trace interaction from in-VR trace interaction in evidence.
- Codex may install or use the local Bun runtime on this workstation only, add and run focused WebSocket smoke tests against `apps/api`, and commit smoke code plus evidence after verification passes.
- Codex must not enable or test HTTP/3, add WebTransport/QUIC/Web3/cloud dependencies, or claim Quest hardware, production, or low-latency behavior from this smoke.

## Decision Needed

Approved: run a constrained local-only Bun runtime setup so Codex can measure the `apps/api` Bun + Hono WebSocket lane without cloud services, paid APIs, model downloads, production deployment changes, HTTP/3, WebTransport, QUIC, or Web3 dependencies.

## Recommendation

Approve the constrained smoke after Patrick is comfortable with the local runtime installation boundary.

The repo architecture says `apps/api` should be Bun + Hono based, and the approved protocol posture names WebSocket as the primary implemented evidence lane. The latest local runtime probe recorded `apiBunRuntime.status: "not_configured"` because `bun` is not installed on this machine. That makes the next honest step a small local runtime smoke: start the Bun API lane, exercise the realtime WebSocket endpoint with binary audio frames and canonical protocol messages, record latency/backpressure/reconnect evidence, then keep Quest, Opus, model inference, and production claims explicitly blocked.

## Proposed Runtime Setup

| Item | Proposed value | Posture |
| --- | --- | --- |
| Runtime | Bun stable runtime, exact `bun --version` recorded after install/use | Local workstation only |
| Install path | Prefer an existing user-local Bun if Patrick already provides one; otherwise use an explicit local install method approved by Patrick | Operator-gated |
| API app | `apps/api` | Existing Bun + Hono target |
| Smoke target | Realtime voice WebSocket lane, initially `/voice/realtime/ws` or the app's current equivalent route | Evidence only |
| Output | `docs/openclinxr/api-bun-websocket-runtime-smoke-YYYY-MM-DD.json` plus optional markdown summary | Committed evidence |
| Cloud/API usage | None | Disallowed |
| Model weights | None | Disallowed |

No runtime installation, package addition, lockfile change, or machine-level trust change is authorized until this proposal is approved.

## Explicit Scope

- Install or use a local Bun runtime only after approval.
- Run `apps/api` locally as the Bun + Hono gateway.
- Add a focused smoke CLI and tests if the existing scripts do not already provide enough evidence.
- Measure local WebSocket behavior with synthetic binary audio frames and canonical protocol messages.
- Record first-open latency, first-message latency, dropped/errored messages, backpressure observations when available, reconnect behavior, close codes, and server console errors.
- Keep the smoke single-user and local-only.

## Out Of Scope

- Direct QUIC, WebTransport server/polyfill, wallet, DID, blockchain, `ethers`, `viem`, `web3`, cloud relay, hosted TURN, or hosted transport packages.
- Quest mic/playback readiness, native Opus readiness, or controller/headset latency claims.
- Moshi/Qwen/VibeVoice/Grok inference readiness.
- Production deployment, Azure networking changes, production credentials, or public endpoints.
- Changing `apps/api` away from Bun + Hono as the primary backend target.
- Committing downloaded runtimes, caches, model weights, generated credentials, or machine-local configuration.

## Pros

- Converts the current `bun_runtime_not_installed_on_this_machine` blocker into measurable evidence.
- Proves the primary approved WebSocket lane before entertaining WebTransport, direct QUIC, or Web3 experiments.
- Keeps runtime evidence separate from model inference and Quest hardware evidence.
- Gives architecture gates a concrete artifact instead of relying on package intent.
- Can be rolled back by removing evidence and smoke code; no production app dependency should be introduced by the runtime itself.

## Cons

- Installing a local runtime is a machine-level change and should remain operator-approved.
- Bun behavior may differ from Node/Hono fallback harnesses already passing in the repo.
- A passing local workstation WebSocket smoke still does not prove Quest Browser audio capture, XR UI latency, Opus framing, or production Azure ingress behavior.
- The exact installed Bun version must be recorded at execution time because the runtime is not currently present.

## Verification Plan

After approval only:

- Resolve and record the exact Bun version and install path.
- Run the existing local runtime probe and confirm `bun` is visible.
- Add or run a focused Bun API WebSocket smoke with deterministic synthetic audio frames.
- Write evidence to `docs/openclinxr/api-bun-websocket-runtime-smoke-YYYY-MM-DD.json`.
- Re-run the realtime voice transport spike with the Bun evidence attached if that path is supported.
- Run at minimum:
  - `pnpm exec vitest run tools/openclinxr/api-bun-websocket-runtime-smoke.test.ts`
  - `pnpm exec vitest run tools/openclinxr/realtime-voice-transport-spike.test.ts tools/openclinxr/local-runtime-probe.test.ts`
  - `pnpm typecheck`
  - `pnpm test:tools`
  - `git diff --check`

## Rollback

If the smoke fails or the runtime setup creates unexpected drift:

- Stop any Bun/API processes.
- Remove uncommitted smoke artifacts if they do not provide useful evidence.
- Revert any unverified smoke-code changes.
- Do not alter production runtime posture.
- Leave the benchmark gate blocked with the exact failure reason.

## Operator Approval Boundaries

Approval would allow Codex to:

- Install or use a local Bun runtime for this workstation-only evidence lane.
- Add focused smoke tooling and evidence artifacts.
- Run local-only WebSocket smokes against `apps/api`.
- Commit code/tests/evidence only after verification passes.

Approval would not allow Codex to:

- Add WebTransport, direct QUIC, Web3, wallet, DID, blockchain, cloud relay, hosted transport, or paid API dependencies.
- Download model weights or call Grok/cloud APIs.
- Expose the API publicly or change Azure deployment posture.
- Claim clinical voice, Quest media, production ingress, or low-latency readiness from this smoke alone.

## Sources

- `docs/openclinxr/local-runtime-probe-2026-05-05.json`
- `.agent-factory/benchmark-gate-report.json`
- `proposals/approved/proposal-quic-web3-protocol-posture.md`
- `apps/api` Bun + Hono architecture posture in the repo
