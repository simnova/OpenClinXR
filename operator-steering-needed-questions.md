# Operator Steering Needed Questions

This file is for true operator blockers only: decisions, confirmations, credentials, hardware actions, paid/cloud/API usage, destructive actions, or local trust/security changes that Codex should not perform unattended.

## Current Blocker Status

- **2026-08-10 — Grok credits exhausted; `image_gen` is 403 and the equipment lane is blocked at step zero.** Probed directly: `HTTP 403 personal-team-blocked:spending-limit` — *"You have run out of credits or need a Grok subscription."* No image produced. DeepSeek **text** still routes normally (the probe itself ran on `deepseek-v4-flash` and executed tools), so workers are unaffected; **image generation is not available.** This blocks #256, which is the measured first constraint of the equipment lane: reference packs exist for only **3** subjects, **35 parametric ids have none**, and registry entry → Metal bake → optimize → promote → consume cannot begin without input images. Three options, none chosen, all needing an operator decision: (a) restore Grok credits or a subscription; (b) approve a different image source for reference packs — a licensing and provenance decision, not a technical one, which is why no substitute has been used; (c) accept that the equipment lane pauses and re-prioritise rooms or clothing. Recommended default if silent: do not substitute an unapproved image source; continue on lanes that need no new generated images (#257 stranded worktrees, #258 monitor placement, the red-test triage) and leave the equipment lane parked.
- The only deferred Quest operator action is a later 10+ minute worn-headset re-run when instrumentation improvements are ready.
- 2026-05-21 diagnostic update: USB authorization, Quest Browser CDP, foreground shell evidence, CDP Full VR activation, and long immersive-frame harvest are now working locally. The next Quest readiness blocker is physical in-headset input and audit observation: close extra Quest Browser windows, keep DevTools screencast disabled, remain in Full VR for a 10+ minute observed run, trigger trace from `xr_controller_select` or `xr_hand_select`, deliberately perform locomotion so a measurable `locomotionDelta` is copied, and record comfort, heat, battery, and operator identity fields. Recommended default: do not ask for this in chat unless Patrick is actively wearing the headset; continue local deterministic work until he steers back to the manual headset run.
- Future Quest worn-headset re-run criteria: Patrick provided the latest manual foreground report at `docs/openclinxr/quest-manual-performance-2026-05-04.json` and later reported a smooth in-headset demo with no locomotion. The manual report confirms the shell loaded, the immersive session was manually started, text was readable, two primitive box-style hands were visible but non-realistic, and short-session comfort was good. It does not yet clear foreground Quest frame pacing, locomotion, trace-interaction, or headset-select latency gates because `traceInteractionPassed` was `false`, `framesObserved` was `0`, `sampleWindowSize` was `0`, immersive frame count recorded `0`, no locomotion event was observed, and headset-select latency was not measured. Codex has since replaced the `apps/ui-xr` non-standard `hand.inputState.pinching` dependency with thumb-tip/index-tip joint-distance pinch inference and added `captureSummary.locomotionProbeSummary` so failed movement attempts preserve reason codes such as `no_gamepad_sources`, `hand_arming_dwell`, `hand_below_deadzone`, or `active_vector_without_rig_delta`. The next re-run should explicitly try the hand-tracking path by pinching, holding for the dwell interval, and moving the left hand to dolly or the right hand to turn, then copy the in-app Quest Evidence payload so the Movement row and copied JSON include the probe. Wait to request the next manual re-run until screencast can stay disabled, `performance.immersiveFramesObserved >= 600`, a 120-sample rolling window is backed by immersive frames, trace interaction is confirmed from the in-app Trace row with `traceLatencyProxy.source: "xr_controller_select"` or `"xr_hand_select"` when using headset input, locomotion evidence includes `lastLocomotionAtMs` plus measurable `locomotionDelta`, and latency can be measured before Codex claims Quest frame pacing or headset input readiness. Codex added `pnpm xr:quest:manual:harvest` as a CDP-assisted way to copy the in-app payload after a human has manually entered Full VR, but the human audit fields still need operator observation during that future run.
- Local realtime voice model cache evidence is no longer blocked on missing approved model files. `docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json` now records both approved caches under `/Users/patrick/.cache/openclinxr/realtime-voice`: `kyutai/moshiko-mlx-q4` at 5,190,750,933 bytes and `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` at 1,711,330,264 bytes. Live-dialog evidence remains blocked on real Moshi/Qwen streaming inference, WebXR or Godot Quest playback, microphone/transcript round trip, safety controls, and runtime packaging. A Moshi package dry run showed `moshi_mlx==0.3.0` would install `mlx==0.26.5`, while the existing Qwen support venv has `mlx==0.31.2`; use a separate Moshi venv before any real Moshi runtime attempt.
- Godot Quest voice sidecar import evidence is no longer blocked on a missing local editor binary. `docs/openclinxr/godot-project-import-check-2026-05-06.json` records a passed headless import using the cached Godot 4.5.1 stable macOS editor from the official GitHub release, with the archive hash and MIT source posture tied to `sources/godot-github-release-2026.json`. Quest microphone, playback, native Opus, and headset latency evidence still require physical Quest execution later.
## Nonblocking Evidence Notes

- GitHub planning surfaces: Patrick reported issue and project permissions for `https://github.com/simnova/OpenClinXR` and `https://github.com/orgs/simnova/projects/7` on 2026-05-06. Git branch publishing is verified, `gh project view 7 --owner simnova` now works through the shared keyring-authenticated `gh` CLI, and `gh repo view simnova/OpenClinXR --json viewerPermission` reports `ADMIN`. Codex can use GitHub issues/project items for lightweight planning records, while repo-local evidence and verified commits remain the source of truth. Codex seeded iteration-0009 evidence-gate planning issues in the project: [#2](https://github.com/simnova/OpenClinXR/issues/2) Quest foreground XR evidence, [#3](https://github.com/simnova/OpenClinXR/issues/3) local model quality evidence, [#4](https://github.com/simnova/OpenClinXR/issues/4) local realtime voice evidence, [#5](https://github.com/simnova/OpenClinXR/issues/5) IWSDK sidecar evidence, and [#6](https://github.com/simnova/OpenClinXR/issues/6) production asset evidence.
- Workspace relocation performance: The prior A/B note in [workspace-relocation-performance-2026-05-05.md](docs/openclinxr/workspace-relocation-performance-2026-05-05.md) found a good operational impact from moving the active repo away from iCloud-backed Documents storage, with modest positive command-speed impact and less sync volatility. Codex also confirmed the old `/Users/patrick/Documents/New project 2` mirror is now absent and the active repo is `/Volumes/files/src/openclinxr`. Current settled-workspace spot checks on 2026-05-06 were healthy: `git status --short` completed in about 0.03s, `pnpm agent:sources` in about 0.66s, and `pnpm --filter @openclinxr/session-state test` in about 0.86s under Node 22.19.0.
- Quest Browser CDP foreground state: Codex attempted a local `--enter-vr` CDP smoke on 2026-05-05 and saved the blocked report at `docs/openclinxr/quest-cdp-smoke-enter-vr-2026-05-05.json`. ADB still saw the Quest 3 and `com.oculus.browser` had a process (`browserPid: "22402"`), but `/json` returned an empty CDP response, no devtools socket lines were visible, and Android reported the Browser UID as `19 (CACHED_EMPTY)`. Codex can keep hardening tooling, but this is not a current operator blocker; any future live CDP evidence attempt should happen only when the Quest Browser page is visibly foregrounded in-headset and the instrumentation re-run is ready.

## Recently Resolved (Historical; see git + current snapshots; proposals purged)

Many (GitHub publishing, durable persistence, Blender, Portless, IWSDK sidecar, local voice, Godot, model benchmarks, Quest notes) resolved in 05-28 + purge. No new true blockers; continue UI-XR consumer + materialization. (Verbose in git; trimmed for succinct operator use.)
- Durable actor-turn persistence promotion: Patrick approved [proposal-durable-actor-turn-persistence-promotion.md](historical; proposals/ purged; see git for proposal-durable-actor-turn-persistence-promotion.md) on 2026-05-05. Codex may add MongoDB-backed repositories in `packages/openclinxr/data-mongodb` for conversation turns and emotional-state timelines only, with `mongodb-memory-server` tests. This does not authorize API/runtime wiring, Redis/Redka, realtime synchronization packages, production deployment, cloud databases, or clinical record-retention policy claims.
- Blender local asset bake: Blender 5.1.1 was installed through Homebrew cask and `pnpm asset:blender:bake` produced `docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json`, so the placeholder asset-bake blocker is resolved.
- Portless local trust: Patrick ran `portless trust`, so Codex can use Portless for local developer/browser routing experiments when useful. Codex verified an unprivileged local proxy on port `1355`; do not add Portless to mandatory repo scripts, start privileged/default-port proxy setup, or start LAN/Tailscale/public sharing without explicit steering.
- IWSDK reference corpus/model warmup scope: Patrick approved `npx iwsdk reference warmup` scope on 2026-05-04 and requested the PNPM equivalent. Codex should use an exact package-managed path such as `pnpm dlx @iwsdk/reference@0.3.2 iwsdk-reference warmup` only after validating CLI help, cache location, and download size; floating `npx iwsdk reference warmup` remains disallowed.
- Meta Quest hzdb legal/procurement posture: Patrick approved `@meta-quest/hzdb` legal/procurement posture on 2026-05-04 for package terms, npm metadata, Quest device-management scope, and asset-library lookup behavior. The package remains sidecar-gated and must not be added to production manifests or lockfile state before install-backed sidecar approval.
- IWSDK install-backed sidecar approval: Patrick approved [proposal-iwsdk-sidecar-install.md](historical; proposals/ purged; see git for proposal-iwsdk-sidecar-install.md) on 2026-05-04; Codex moved the approved record under `proposals/approved/` on 2026-05-04 10:40:15 EDT. Codex created `apps/arena/ui-xr-iwsdk-spike` with Phase 1 packages only: `@iwsdk/core@0.3.1`, `@iwsdk/xr-input@0.3.1`, and `three@0.184.0`. Production adoption remains gated by evidence.
- Local voice runtime proposal: Patrick approved [proposal-local-voice-runtime.md](historical; proposals/ purged; see git for proposal-local-voice-runtime.md) on 2026-05-04 10:40:15 EDT. Codex installed the local-only VibeVoice wrapper at `/Users/patrick/.local/bin/vibevoice`, recorded first-audio file generation, and refreshed the offline local evidence in `docs/openclinxr/local-voice-runtime-benchmark-2026-05-06.json`; production, WebXR playback, and live streaming use remain blocked.
- Godot editor import evidence: Patrick approved GitHub release binary downloads on 2026-05-06. Codex used the cached official Godot 4.5.1 stable macOS editor outside the repo, verified the release archive digest, ran `pnpm godot:project:import-check -- --godot-binary /Users/patrick/.cache/openclinxr/godot/4.5.1-stable/Godot.app/Contents/MacOS/Godot --output docs/openclinxr/godot-project-import-check-2026-05-06.json`, and added `pnpm godot:project:import-check:validate` to keep the committed import evidence from rotting. This resolves only local source/import evidence; Quest runtime and audio evidence remain blocked.
- Local model benchmark proposal: Patrick approved [proposal-local-model-benchmark.md](historical; proposals/ purged; see git for proposal-local-model-benchmark.md) on 2026-05-04 10:40:15 EDT. Codex downloaded and benchmarked `Qwen/Qwen3-4B-GGUF` through local `llama.cpp` and recorded results in `docs/openclinxr/local-model-runtime-benchmark-2026-05-04.json`; production dialogue/scoring use remains blocked.
- Local realtime voice model inference proposal: Patrick approved [proposal-local-realtime-voice-model-inference.md](historical; proposals/ purged; see git for proposal-local-realtime-voice-model-inference.md) on 2026-05-04 19:16:05 EDT with `kyutai/moshiko-mlx-q4` as the primary full-duplex Moshi MLX q4 candidate and `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit` as the outbound TTS fallback. Codex may use isolated venvs plus cache under `~/.cache/openclinxr/realtime-voice` for local research-only spikes. No production use, committed weights, cloud calls, or paid APIs are authorized.
- Production asset evidence ladder: Patrick approved [proposal-production-asset-evidence-ladder.md](historical; proposals/ purged; see git for proposal-production-asset-evidence-ladder.md) on 2026-05-06. Codex may implement repo-local deterministic evidence/reporting slices for generated-human rigging, skin/clothing provenance, medical equipment, animation retargeting, LOD/texture/collider budgets, and multi-actor Quest bundle budgets. No new asset-generation installs, downloaded third-party assets, cloud or paid APIs, committed generated third-party assets, production runtime adoption, or production asset-readiness claims are authorized by this approval.
- Protocol posture proposal: Patrick Gidich approved [proposal-quic-web3-protocol-posture.md](historical; proposals/ purged; see git for proposal-quic-web3-protocol-posture.md) on 2026-05-04 19:24 EDT. Codex may keep WebSocket as the implemented evidence lane and collect local Bun/Quest WebSocket evidence. WebTransport, direct QUIC, and Web3 remain future optional lanes; this approval does not authorize adding direct QUIC, WebTransport server/polyfill, `ethers`, `viem`, `web3`, wallet, DID, blockchain, cloud relay, hosted transport packages, or paid APIs.
- Quest foreground performance capture proposal: Patrick approved [proposal-quest-foreground-performance-capture.md](historical; proposals/ purged; see git for proposal-quest-foreground-performance-capture.md) on 2026-05-04 11:49:38 EDT. The proposal approval is resolved; the first human headset report was recorded on 2026-05-04, and the remaining blocker is a longer validated frame-pacing and controller-latency report.
- WebXR mixed-reality mode proposal: Patrick approved [proposal-webxr-mixed-reality-mode.md](historical; proposals/ purged; see git for proposal-webxr-mixed-reality-mode.md) on 2026-05-04 14:16:18 EDT as a parallel sidecar track. Codex may evolve an `immersive-ar`/passthrough alternative view alongside the existing Full VR approach, while keeping Full VR as the primary path and keeping MR evidence, privacy/safety posture, manual headset observations, and production-readiness claims separate.
- IWSDK Phase 2 devtools proposal: Patrick approved [proposal-iwsdk-phase2-devtools.md](historical; proposals/ purged; see git for proposal-iwsdk-phase2-devtools.md) on 2026-05-04 14:19:29 EDT. Codex may install and use `@iwsdk/vite-plugin-dev@0.3.1`, adapter sync, and MCP inventory evidence inside `apps/arena/ui-xr-iwsdk-spike` when useful, using the explicit `--approved-phase2-devtools` posture gate. This approval does not authorize production adoption, default verification changes, `@iwsdk/reference`, `@meta-quest/hzdb`, optimizer packages, or cloud/API usage.
- IWSDK Phase 2 sharp native libvips exception: Patrick Gidich approved [proposal-iwsdk-phase2-sharp-libvips-exception.md](historical; proposals/ purged; see git for proposal-iwsdk-phase2-sharp-libvips-exception.md) on 2026-05-04 19:18:43 EDT. Codex may reinstall and commit `@iwsdk/vite-plugin-dev@0.3.1` as a sidecar-only devDependency in `apps/arena/ui-xr-iwsdk-spike`, with exact `sharp@0.33.5` and exact native `@img/sharp-libvips-*` transitive package exceptions required by that sharp version. Never production use; default `pnpm verify` remains license-clean without this opt-in exception path.
- IWER sidecar emulation spike: Patrick approved [proposal-iwer-sidecar-emulation-spike.md](historical; proposals/ purged; see git for proposal-iwer-sidecar-emulation-spike.md) on 2026-05-04 20:13:53 EDT. Codex may run an evidence-only IWER emulation spike through the already-installed IWSDK Phase 2 sidecar path, without adding packages or replacing physical Quest proof.
- Local Bun runtime WebSocket smoke: Patrick approved [proposal-local-bun-runtime-websocket-smoke.md](historical; proposals/ purged; see git for proposal-local-bun-runtime-websocket-smoke.md) on 2026-05-05 12:37 EDT. Codex may install/use local Bun on this workstation and commit local-only WebSocket smoke code plus evidence after verification. HTTP/3, WebTransport, QUIC, Web3, cloud dependencies, production claims, Quest hardware claims, and low-latency claims remain out of scope for this smoke.
- Quest HTTP3 compatibility spike: Patrick approved [proposal-quest-http3-compatibility-spike.md](historical; proposals/ purged; see git for proposal-quest-http3-compatibility-spike.md) on 2026-05-05 12:38 EDT as future work. This is not part of the local Bun WebSocket smoke; any HTTP/3 architecture claim must be backed by a real Quest 3 / Quest Browser compatibility test. Codex added `pnpm xr:quest:http3:check` plus `docs/openclinxr/quest-http3-compatibility-template.json` so future evidence can separate Quest HTTP/3 reachability from WebTransport, Azure ingress, clinical media, and low-latency voice claims.
- Local WebXR hand mesh assets: Patrick approved [proposal-local-webxr-hand-mesh-assets.md](historical; proposals/ purged; see git for proposal-local-webxr-hand-mesh-assets.md) on 2026-05-05. Codex may proceed with local Three.js `XRHandMeshModel` hands using local GLBs and explicit primitive fallback, but must record asset provenance/license and re-measure Quest frame pacing before any quality or performance claim.
- UIKitML spatial text sidecar: Patrick approved [proposal-uikitml-spatial-text-sidecar.md](historical; proposals/ purged; see git for proposal-uikitml-spatial-text-sidecar.md) on 2026-05-05. Codex may proceed with a sidecar-only text readability spike in `apps/arena/ui-xr-iwsdk-spike`, but must verify Vite 8 compatibility and `@pmndrs/uikit` license before committing code or lockfile changes; broader spatial UI adoption remains separately gated.
- Server-side multi-actor state and context management: Patrick approved [proposal-server-side-multi-actor-state-context.md](historical; proposals/ purged; see git for proposal-server-side-multi-actor-state-context.md) on 2026-05-05 13:40:16 EDT. Codex may run a server-side architecture spike evaluating Colyseus, bitECS if license posture is acceptable, custom approaches, and other viable options. Codex may incorporate existing system functionality such as voice if useful during the spike. This does not authorize production adoption or final architecture selection without a follow-up proposal.
- Server-side multi-actor persistence Phase 2: Patrick approved [proposal-server-side-multi-actor-state-context-persistence-phase2.md](historical; proposals/ purged; see git for proposal-server-side-multi-actor-state-context-persistence-phase2.md) on 2026-05-05 14:34:17 EDT as a follow-on architecture spike after the initial state/context baseline. Codex may evaluate Redka/Redis-versus-durable-database responsibilities and prototype persistence/recovery state models, but this does not authorize production adoption, cloud Redis, hosted databases, paid services, or replacing durable clinical persistence with cache state.
- Multi-actor runtime promotion: Patrick approved [proposal-multi-actor-runtime-promotion.md](historical; proposals/ purged; see git for proposal-multi-actor-runtime-promotion.md) on 2026-05-05. Codex may create `packages/openclinxr/session-state`, promote the stable public API from the spike package, and add ArchUnitTS rules preventing production imports from `multi-actor-state-spike`. This does not authorize Colyseus, `@colyseus/schema`, bitECS, full realtime sync, production persistence, Quest performance claims, or clinical validity claims.

## Standing Rules

- Ask before destructive git/file operations, paid/cloud/API usage, production credentials, or changes that alter machine-level trust/security state.
- Prefer local deterministic spikes, repo-managed dependencies, and verified commits before requesting steering.
- Simple physical-state actions such as waking the Quest, closing extra Quest Browser windows, or reconnecting USB-C do not need proposal files; non-trivial installs, downloads, runtime enablement, security/trust changes, or production-readiness evidence captures do.

## 2026-06-03: WIP recovery note

The prior "no safe next" stop note was superseded by Patrick's explicit request to get the uncommitted work back on track. No operator blocker is active for the recovery slice; keep IWSDK sidecar packages on the approved `0.3.1` versions unless Patrick explicitly approves an upgrade.

- Capture non-blocking operator suggestions in [operator-suggestion-backlog.md](operator-suggestion-backlog.md); do not treat backlog items as approval, blockers, or immediate scope unless they are promoted through a verified slice or explicit proposal.
- Newly approved local hand mesh and UIKitML work remain implementation- and evidence-gated; they are not current operator blockers unless a verification step fails or a later slice needs broader production scope.

## 2026-08-10 — MPFB hair assets: acquire a pack, or stay procedural? (BLOCKED, needs approval)

**RESEARCH BASIS (measured 2026-08-10, issue #296).** MPFB 2 is installed as a Blender 5.1 extension
and bundles targets, rigs, poses, textures — and **0 `.mhclo`, 0 `.mhmat`**. Its `mh_user_data` root
holds only `config` and `logs`. The repo cache has **6 `.mhclo`, all shirts**. Hair today is a painted
material region (`openclinxr_mesh_native_scalp_hair_surface`) on every rail including MPFB, which is
why hair grades as torn fragments. MPFB's hair path is **asset-based, not procedural** —
`haireditorservices.py` exposes `is_hair_asset_installed()` / `get_hair_blend_path()` and wants a hair
`.blend`. So there is no code-only route to MPFB hair.

**RECOMMENDATION.** Approve acquiring a **CC0 / CC-BY MakeHuman-compatible hair asset pack** into the
existing provider cache (`.openclinxr-local/provider-cache/`), same pattern as `makehuman-shirts01`,
with licence recorded in provenance. This is the smallest step that turns painted scalp into real hair
geometry, and it reuses a proven tool rather than authoring hair (D1).

**ALTERNATIVE if you would rather not add assets:** CharMorph and MB-Lab are both already cached and
both ship hair *engines* (`hair.py`, `hairengine.py`) that may be procedural — which would satisfy D2
without acquiring anything. They were found, not evaluated. Say the word and the evaluation becomes a
cagematch slice instead.

**APPROVAL STRING:** `approve: acquire CC0/CC-BY MakeHuman hair pack into provider-cache`

**ANSWERED 2026-08-11 — APPROVED.** Operator: *"approval for hair - with CC0/CC-BY - keep track of
these as we'll eventually look for replacements where possible (you can also research options like
makehair or hair-packs/packages/plugins that are viable)."*

Acquired: **`hair01`, 26 hairstyles, CC0 1.0**, 217 MB, 25 `.mhclo` + 25 `.mhmat`, into
`.openclinxr-local/provider-cache/hair/sources/makehuman-hair01/` with a `PROVENANCE.json` stamp.

Researched and **REFUSED**: the `haireditor` pack (geometry-nodes hair/fur, `hair.blend` + `fur.blend`,
~12 MB) states **no licence** on its source page. It is the pack MPFB's own `haireditorservices.py`
looks for and the procedural route that best fits D2, so it is worth a licence clarification upstream —
but unspecified is a refusal, not a maybe.

Tracking surface created: `docs/openclinxr/third-party-asset-licence-ledger.md`, which also gives #193
("CC-BY garments are allowed — the compliance surface they are conditional on does not exist") the
record it was missing. Every row carries a replacement posture, per the operator's ask.

**DEFAULT IF SILENT:** no acquisition. Hair stays a painted region, and I will evaluate the
CharMorph / MB-Lab procedural hair engines as a lane C cagematch instead, since that needs no approval.

## 2026-08-11 — the paediatric patient's authored height is unreachable (BLOCKS full cast regeneration)

**RESEARCH BASIS (measured, #302).** `patient_maya_johnson_v1` authors `height_cm: 125` at `age: 0.09`
(8 years). The production rail creates the model with `extrapolate_phenotypes=False`, which clamps the
height macro at 1.000. At that ceiling she measures **115.7 cm — 9.3 cm short**, so the generator now
**refuses loudly** rather than silently shipping a short body. The three adults solve exactly (0.00 cm).

This does **not** block anything today: her shipped reference `peds_patient_child` is the **only one of
the seven that is already unique and correctly sized** (125.0 cm). It blocks regenerating her, and
therefore blocks ever regenerating the full cast from phenotype.

**RECOMMENDATION.** Author her at **age 10–11** rather than 8, keeping 125 cm. 125 cm is short for an
8-year-old anyway (roughly 3rd percentile) and comfortably ordinary for 10–11, so this makes the case
*more* plausible rather than bending it to fit the tool. It is the only option of the three that costs
nothing in fidelity.

**ALTERNATIVES, both worse:**
- *Author her shorter* (~116 cm at age 8). Fits the tool, but 116 cm at 8 is roughly 1st percentile —
  we would be encoding an unusually small child for a tooling reason, into a case a learner is assessed
  on.
- *Enable `extrapolate_phenotypes=True` on the production rail.* Reaches 125 cm at macro ≈1.16, but
  measured cost: the BMI-45 extrapolated body carried large self-intersecting fold artifacts that a lean
  body from the identical export path did not. Extrapolation leaves Anny's trained distribution, which
  is the whole reason Anny is the phenotype oracle.

**APPROVAL STRING:** `approve: re-author patient_maya_johnson_v1 age to 10`

**DEFAULT IF SILENT:** no change. The child keeps her existing correct reference, adult regeneration
proceeds without her (#303), and "regenerate the full cast from phenotype" stays blocked on this one
decision.

**NOT MINE TO DECIDE:** her age is clinical content a learner is assessed against — a paediatric fever
or asthma presentation reads differently at 8 than at 11 (§8d, #293).

## 2026-08-14 — a learner cannot start an exam, and the blocker is 52 human review decisions (BLOCKS the whole exam path)

**Measured 2026-08-14 10:5x, from the shipped predicate, not from a summary.**
`createExamStationRunQueue(createDefaultClinicalSkillsBlueprint(bank), bank)` returns:

```
canStartLearnerExam: false
stations: 12   { activation_ready: 1, draft_blocked: 11 }
```

Every one of the eleven carries exactly one blocker: `scenario_not_approved`.

Reading the bank directly, **13 of 14 scenarios are `status: "draft"` with all four review gates at
`draft` and `validationStage: "stage_0_synthetic_draft"`.** The single exception is
`ed_chest_pain_priority_v1` — `status: approved`, `clinical / psychometric / legal / simulationQa`
all `approved`, `stage_1_expert_reviewed`. It is the one station a learner can reach.

| | count |
|---|---:|
| bank scenarios | 14 |
| blueprint stations | 12 |
| `activation_ready` | **1** |
| `draft_blocked` on `scenario_not_approved` | **11** |

**This is not a code defect and there is no slice that fixes it.** `isActivationEligible`
(`exam-assembly/src/assembly.ts:367`) requires `status === "approved"`, all four gates approved,
a `validationStage` past `stage_0_synthetic_draft`, a `scoreUseLabel` that is not
`validated_summative`, and replay-ready dialogue seeds. The promotion machinery exists and is wired
(`apps/api/src/scenario-review-promotion.ts`, reached from `api-route-support.ts:104`): four
persisted approved gate decisions promote stage_0 → stage_1, and a client POST cannot self-approve
(#39/#41 both hardened that). **The path works. What is missing is the decisions.**

**13 scenarios x 4 gates = 52 review decisions**, spanning clinical, psychometric, legal and
simulation-QA judgement.

**Why no agent in this loop will make them.** #167's brief explicitly banned auto-approving
`stage_0`, relaxing `isActivationEligible`, lowering `STEP2CS_STATION_COUNT`, and marking anything
`validated_summative` — and those bans are correct. §8d/§8y say clinical content is not an
implementer decision. Approving a suicidal-ideation safety station or an obstetric pre-eclampsia
triage station is not a judgement any agent here is qualified to make, and doing it through the
sanctioned API route rather than by editing a fixture would not change that.

**What I need from you — one of:**

1. **Nominate a small set to review** (2–3 scenarios) and supply the gate decisions, so the exam path
   can be exercised end to end with a real multi-station queue rather than a single station.
2. **Authorise a clearly-labelled non-clinical review lane** — e.g. a `stage_1` promotion for
   pipeline-exercise purposes only, carrying a `scoreUseLabel` that forbids any score use, so the
   runtime can be tested against >1 station without implying clinical approval.
3. **Confirm this stays blocked**, in which case the exam path remains a one-station demonstration and
   I will stop treating multi-station work as reachable.

**DEFAULT IF SILENT:** I keep building against the single approved station and do not touch scenario
approval state. This is the lowest-risk option and it is what has been happening implicitly; the
point of writing it down is that it has never been a decision, only a side effect.

**NOT TESTED:** whether the four-gate promotion route has ever been exercised end to end against a
bank scenario (the machinery is wired and unit-tested; I did not drive it live); whether the two bank
scenarios outside the 12-station blueprint (`adult_abdominal_pain_v1`, `peds_fever_v1`) are excluded
deliberately or incidentally.
