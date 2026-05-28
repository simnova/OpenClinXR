# Worker Backlog And Validation Matrix

2026-05-27 OpenClaw hardening validation lane: long unattended runs must preserve `docs/openclinxr/openclaw-runbook-2026-05-27.md`, run `pnpm docs:drift-check` after cleanup or suspected drift, and keep each slice tied to a product path plus blueprint/factory contract. The Required Per-Slice Record belongs in `AUTONOMOUS_WORK_PLAN.md` or this backlog, not in scattered checkpoint/status files.

Required Per-Slice Record fields for OpenClaw-style operation: `Product path advanced`, `Blueprint/factory tie`, `Touched files`, `Evidence`, and `Next queued slice`. Use these fields here or in `AUTONOMOUS_WORK_PLAN.md` after each slice before queue transition.

2026-05-27 Worker tooling/dependency hardening follow-through: IWSDK npm currentness reflects latest package metadata (`@iwsdk/*` `0.4.1`, `@meta-quest/hzdb` `1.2.1`) and still blocks runtime adoption because Vite plugins peer on `vite: ^7.0.0` while the repo uses Vite `8.0.10`. Asset-production readiness accepts either `gltf-pipeline` smoke evidence or `@gltf-transform/core` Node API smoke evidence, local-runtime probing can satisfy the GLTF conversion runtime gate from the Node API package, and security/asset-pipeline docs now identify `gltf-pipeline` as legacy rather than the only approved path. The e18e-backed decision is keep/isolate later, not remove now: duplicate count remains 94 and `agent:verify` still validates the legacy smoke. Benchmark artifact fixture expectations now avoid overclaiming materialized production artifacts. Evidence: `docs/openclinxr/iwsdk-npm-currentness-2026-05-27.json`, `docs/openclinxr/gltf-transform-smoke-2026-05-27.json`, `docs/openclinxr/asset-production-readiness-benchmark-2026-05-27.json`. Next queued slice: actor-specific humanoid materialization unless Patrick explicitly requests a dependency-removal experiment.

2026-05-26 Worker 9 encounter realism screenshot review: Captured actor-realism screenshots for pediatric asthma and the five default exam-sequence encounters, then wrote `docs/openclinxr/ui-xr-encounter-realism-review-2026-05-26.md`. Findings: pediatric asthma is the only scenario-specific rendered encounter; ED Chest Pain actor-realism capture has a 3D boot blocker; OB/Clinic/Oncology/Postop fall back to ED Chest Pain visuals/text and cannot count as scenario-specific realism evidence. Next lanes: ED boot fix, non-ED fallback guard, actor-specific humanoid materialization, scenario-specific minimal room manifests.

2026-05-26 Worker 11/9 heartbeat guard slice: generated station runtime bundle validation now fails if actor humanoid materialization contracts drop actor-specific Anny variant keys or body/clothing/hair-face/rig-preservation cue IDs. Verification: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`.

2026-05-26 Worker 11/9 heartbeat continuation slice: generated station runtime bundle reports now emit `actorHumanoidMaterializationContract` with actor-specific Anny humanoid variant semantic keys for patient, parent, and nurse while explicitly flagging shared neutral GLB reuse as a materialization gap. This redirects the next product slice from runtime cue patches toward actor-specific humanoid GLB materialization. Verification: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`.

2026-05-26 Worker 9 heartbeat evidence slice: Captured refreshed desktop-browser pediatric asthma actor-realism evidence after adding visible role-distinction clothing/accessory cues. Evidence shows no page errors, 5 role-distinct humanoid cues, and 7 pediatric equipment cues. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-role-distinction-cues-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-role-distinction-cues-2026-05-26.json`. Residual risk: actors still share one underlying generated humanoid mesh, so next product advancement should move toward actor-specific humanoid asset materialization rather than more runtime cue overlays.

2026-05-26 Worker 9 heartbeat continuation slice: UI-XR pediatric asthma actors now have additional role-specific visible clothing/accessory cues that avoid proxy bars: child small-stature band, nurse scrub V-neck, and parent civilian shoulder bag. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 heartbeat evidence slice: Captured refreshed desktop-browser pediatric asthma actor-realism evidence after the panel/overlay declutter. Evidence reports no page errors, 5 role-distinct humanoid cues, 7 pediatric equipment cues, and the empty actor-realism panel hidden until trace activation. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-declutter-overlay-hidden-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-declutter-overlay-hidden-2026-05-26.json`.

2026-05-26 Worker 9 heartbeat continuation slice: UI-XR role-pose helper overlays are now hidden unless affordance/debug capture modes are requested, reducing visible proxy-bar clutter in default pediatric actor-realism review while retaining semantic cue metadata for adversarial/debug inspection. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 heartbeat continuation slice: UI-XR actor-realism capture now suppresses the empty in-scene Actor Realism Requirements panel until a trace-selected actor requirement exists, keeping default pediatric visual review focused on the generated actors and required equipment cues without losing the adversarial panel after dialogue activation. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 UI-XR pediatric scene declutter and role-pose slice: actor-realism handoff now honors `openclinxrCaptureMode`, suppresses mismatched reused placeholder environment/equipment GLBs when the dynamic scene manifest is for a different scenario, keeps semantic pediatric equipment cues visible, reframes the parent into the three-actor review zone, and adds case-role pose overlays plus fuzzy humanoid joint-name posing for Anny/Mixamo-style rigs. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-declutter-role-pose-v4-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-declutter-role-pose-v4-2026-05-26.json`.

2026-05-26 Verification note: targeted RuntimeSelectionReviewPacketPanel tests and UI-admin typecheck passed for the Admin-to-XR handoff affordance. Full architecture suite remains red on unrelated existing rules: executable worker endpoint shape, UI domain-contract imports, and unsafe score-use language in App.tsx; address separately rather than blocking this recovered app path.

2026-05-26 Worker 7/9 Admin-to-XR local handoff affordance: Runtime Selection Review Packet now shows a prepare-local-XR-handoff section and link that carries selected scenario/encounter/station/runtime bundle into the XR review surface without clearing evidence gates or claiming learner/runtime/Quest/provider readiness. Verification: `pnpm --filter @openclinxr/ui-admin test -- RuntimeSelectionReviewPacketPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.

2026-05-26 Worker 7/11 asset-registry browser-barrel architecture guard: Added a workspace architecture regression that blocks `export * from "./object-store.js"` in the asset-registry root barrel and confirms direct object-store/asset-writer subpath exports remain available. Verification: `pnpm --filter @openclinxr/architecture-rules test -- workspace-architecture.test.ts`.

2026-05-26 Worker 7/9 full-app smoke recovery: Admin blank-screen failure traced to the asset-registry root barrel exporting Node-only Azurite object-store code; root barrel now exports object-store types only, leaving runtime functions on direct subpath imports. Verification passed: `pnpm --filter @openclinxr/ui-admin typecheck`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/asset-registry test -- object-store.test.ts asset-writer.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/ui-admin build`; browser screenshot smoke for UI-XR and Admin routes.

2026-05-26 Worker 11 evidence-gated runtime handoff adapter: Added `tools/openclinxr/encounter-runtime-handoff-adapter.ts` with tests proving pediatric asthma actor realism requirements flow from launch contract into blocked runtime handoff, and mock attached evidence flips only local runtime handoff while Quest/provider/learner claims remain blocked. Verification: `pnpm exec vitest run tools/openclinxr/encounter-runtime-handoff-adapter.test.ts`.

2026-05-26 Worker 11 WebXR launch actor-badge integrity guard: Launch-selection validation now rejects missing/mismatched actor realism badges whenever case-defined actor realism requirements are present, keeping actor-specific humanoid gates intact through launch handoff. Verification: `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`.

2026-05-26 Worker 11 WebXR launch contract drift guard: Launch-selection validation now rejects contract/selection ID mismatches and generated URL scenario drift, keeping subagents from passing internally-valid but misaligned launch reports. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`.

2026-05-26 Worker 11 materialized WebXR launch-selection contract: Regenerated and validated `docs/openclinxr/encounter-local-launch-selection-2026-05-26.json`, preserving the new launch contract in durable handoff artifacts. Verification: `pnpm exec tsx tools/openclinxr/encounter-local-launch-selection.ts --validate docs/openclinxr/encounter-local-launch-selection-2026-05-26.json`.

2026-05-26 Worker 11 WebXR launch contract backward-compatible validation: Launch-selection generation now blocks older publication artifacts with missing actor runtime handoff arrays using explicit launch reasons instead of crashing or permitting readiness claims. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`; `pnpm exec tsx tools/openclinxr/encounter-local-launch-selection.ts --validate docs/openclinxr/encounter-local-launch-selection-2026-05-26.json`.

2026-05-26 Worker 11 WebXR launch contract positive path: Launch-selection tests now cover both incomplete upstream case handoff and present case-defined handoff. When handoff exists, the contract carries actor realism requirements and per-actor `realismBlocked` badges for patient/family/nurse while preserving evidence blockers. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`.

2026-05-26 Worker 11 WebXR launch contract: Encounter local launch selection now includes a case-definition-driven WebXR launch contract with actor roster, case-defined actor realism requirements when present, per-actor blocked realism badges, case-definition coverage, and launch blocking reasons. The current ED static fixture remains blocked when upstream case-defined actor handoff is incomplete, preventing local publication selection from becoming a runtime/Quest/production readiness claim. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`.

2026-05-26 Worker 7/11 UI-admin humanoid handoff badge boundary: The Environment Generation Queue humanoid runtime handoff summary now displays the `realismBlocked` actor badge boundary until actor-specific humanoid gate evidence attaches, matching factory/preflight/UI-XR vocabulary. Verification passed: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.

2026-05-26 Worker 9 UI-XR active actor launch badge browser smoke: Local Vite/browser smoke captured pediatric asthma actor-realism mode after `Urgent Escalation` and asserted active humanoid speech evidence carries `activeActorRealismLaunchBadge.status === "realismBlocked"`. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-active-actor-launch-badge-smoke-2026-05-26.png`; `docs/openclinxr/ui-xr-peds-active-actor-launch-badge-smoke-2026-05-26.json`.

2026-05-26 Worker 9 UI-XR active actor launch badge evidence: Active humanoid speech evidence now carries `activeActorRealismLaunchBadge` with actor id, actor role, `realismBlocked`, blockers, and metadata-only claim boundary, aligning copied runtime evidence with the in-scene panel and factory/preflight badge vocabulary. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 11 materialized factory actor-realism handoff reports: Regenerated and validated `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-26.json` and `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-26.json`, preserving scenario-derived actor runtime realism requirements and blocked per-actor launch badges in durable handoff artifacts.

2026-05-26 Worker 11 preflight actor badge validation guard: Local factory handoff preflight validation now rejects missing actor realism launch badge sets and duplicate actor role/id badge entries, preventing case-defined actor readiness from silently dropping before future runtime/UI consumers. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`.

2026-05-26 Worker 11 preflight actor badge requirement preservation: Local factory handoff preflight badges now preserve operation-manifest actor runtime realism requirements, including actor id, baseline mood, cue IDs, and required dimensions, instead of reducing case-defined obligations to actor roles. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`.

2026-05-26 Worker 11 local factory operation actor requirements: Encounter local factory operation manifests now include scenario-bank-derived actor runtime realism requirements for the selected scenario, so downstream preflight/badge logic can consume case-defined actor obligations instead of role-only metadata. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`.

2026-05-26 Worker 9 UI-XR actor-realism badge-boundary browser smoke: Local Vite/browser smoke captured pediatric asthma actor-realism mode after `Urgent Escalation` and asserted the in-scene "Actor Realism Requirements" panel evidence includes the `realismBlocked` badge boundary. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-actor-realism-badge-boundary-smoke-2026-05-26.png`; `docs/openclinxr/ui-xr-peds-actor-realism-badge-boundary-smoke-2026-05-26.json`.

2026-05-26 Worker 9 UI-XR actor-realism badge boundary: The in-scene Actor Realism Requirements panel now displays a `realismBlocked` launch badge boundary until actor-specific humanoid gate evidence attaches, aligning runtime reviewer affordance with the factory/preflight badge vocabulary. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 4/11 scenario-derived actor badge coverage: Humanoid realism gate tests now prove pediatric asthma scenario-bank `actorRuntimeRealismRequirements` feed the actor realism launch badge mapper directly, preserving case-defined roles, baseline mood, required dimensions, and cue IDs. Verification passed: `pnpm exec vitest run tools/openclinxr/humanoid-realism-gate.test.ts`.

2026-05-26 Worker 11 humanoid gate actor-realism launch badge mapper: Humanoid realism gate now maps case-defined actor runtime requirements plus GLB gate evidence into `realismReady`/`realismBlocked` launch badges with ready/blocked dimensions and explicit non-readiness caveats. Verification passed: `pnpm exec vitest run tools/openclinxr/humanoid-realism-gate.test.ts`.

2026-05-26 Worker 11 local factory actor-realism launch badges: Encounter local handoff preflight now emits per-actor `realismBlocked` badges for case-defined actor roles when actor-specific humanoid realism gate evidence is not attached, preventing stale generic runtime/sidecar evidence from implying humanoid launch readiness. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`.

2026-05-26 Worker 9 UI-XR actor-realism panel browser smoke: Local Vite/browser smoke captured the pediatric asthma actor-realism review mode after `Urgent Escalation`, proving active speech evidence carries `activeActorRuntimeRealismRequirement` and text-panel evidence includes the in-scene "Actor Realism Requirements" panel. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-actor-realism-panel-smoke-2026-05-26.png`; `docs/openclinxr/ui-xr-peds-actor-realism-panel-smoke-2026-05-26.json`. Boundary: desktop browser evidence only, not Quest/clinical/scoring/production/animation readiness.

2026-05-26 Worker 9 actor-realism capture panel visibility: The Actor Realism Requirements panel remains visible in humanoid mouth/gaze/pose and explicit actor-realism capture modes while other generated-scene panels can stay hidden, giving adversarial screenshot review a case-defined obligation overlay without broad clutter. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 IWSDK/sidecar actor-realism panel target: The in-scene Actor Realism Requirements panel is now a first-class IWSDK scene object and sidecar review target, allowing hierarchy/screenshot tools to verify the case-defined actor obligation affordance exists in the runtime scene. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 UI-XR in-scene actor-realism requirement panel: Added an in-scene "Actor Realism Requirements" reviewer panel driven by active humanoid speech evidence, showing role, actor id, baseline mood, required realism dimensions, cue IDs, and non-readiness caveats for adversarial screenshot review. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 UI-XR evidence-panel actor-realism readability: The Speech affect evidence line now displays the active actor runtime realism requirement summary so runtime/screenshot reviewers can see which case-defined humanoid obligations are being exercised without opening raw JSON. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 UI-XR active dialogue actor-realism evidence: Active humanoid speech evidence now includes the generated runtime-bundle actor realism requirement for the current dialogue turn, preserving actor id, role, baseline mood, locomotion/expression/gaze/lip-sync/interactivity flags, and required cue IDs for screenshot/adversarial review. Verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Nonblocking follow-up: capture browser/Quest screenshot evidence when a browser tool/runtime is available; the local workspace command could not resolve Playwright.

2026-05-26 Worker 9 UI-XR pediatric static generated bundle smoke: Local Vite/browser evidence now shows `openclinxrScenarioId=peds_asthma_parent_anxiety_v1` renders Pediatric Asthma content from the static generated learner bundle and no longer displays ED Chest Pain, while the UI still shows generated learner-use blocked boundaries. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-static-generated-bundle-smoke-2026-05-26.png`; `docs/openclinxr/ui-xr-peds-static-generated-bundle-smoke-2026-05-26.json`. Verification: generated artifacts, generated station bundle CLI, copied learner bundle to `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json`, local Vite browser smoke.

2026-05-26 Worker 9 UI-XR static generated visual-review loading: UI-XR now accepts `openclinxrScenarioId` and loads matching static generated bundles for visual review even when learner runtime use is blocked by evidence gates, preventing scenario-selected product views from silently reverting to ED fallback. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 11 generated station bundle CLI scenario alias: `asset:generated-station-bundle -- --scenario <id>` now works as an alias for `--scenario-id`, preventing local smoke commands from accidentally producing ED bundles. Verification: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`.

2026-05-26 Worker 11 case-definition-driven runtime manifest slice: Generated station runtime bundles now derive scenario context and dialogue turns from the scenario fixture, and pediatric asthma coverage asserts pediatric actor IDs, all pediatric equipment needs, scenario-required trace tags, and scenario-definition dialogue text. Verification: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts tools/openclinxr/publish-generated-learner-runtime-bundle.test.ts`.

2026-05-26 Worker 11 runtime publication source traceability: Generated learner runtime bundle publication reports now preserve `sourceBundleReportPath` for `--bundle-report` driven publication plans, keeping scenario-selectable publication metadata traceable to the generated bundle report. Verification: `pnpm exec vitest run tools/openclinxr/publish-generated-learner-runtime-bundle.test.ts`.

2026-05-26 Worker 11/9 scenario-selectable runtime publication seam: `publish-generated-learner-runtime-bundle` now accepts injected learner bundles and CLI `--bundle-report`, preserving pediatric asthma scenario/station metadata through local publication planning instead of rebuilding ED chest pain internally. Verification: `pnpm exec vitest run tools/openclinxr/publish-generated-learner-runtime-bundle.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`.

2026-05-26 Worker 11 pediatric generated runtime bundle alignment: Generated station runtime bundle presets now derive pediatric asthma actor IDs and equipment IDs from the scenario bank and place all pediatric equipment needs, replacing the previous two-item placeholder. Verification: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts tools/openclinxr/encounter-publication-payloads.test.ts`.

2026-05-26 Worker 4/11 pediatric asthma case-definition-driven factory coverage: Encounter publication payloads now include `caseDefinitionDrivenFactoryCoverage`, and the pediatric asthma publication test proves the second scenario carries pediatric actor roles, required trace tags, pediatric urgent-care station context, equipment placements, asset/work-order coverage, and non-readiness caveats from case definition to learner bundle publication. Verification: `pnpm exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts tools/openclinxr/encounter-asset-generation-queue.test.ts`; `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/capability-gateway typecheck`; `pnpm --filter @openclinxr/shared-schemas test -- schemas.test.ts`.

2026-05-26 Worker 9/11 adversarial equipment/clutter realism guard: Visual QA and runtime-realism evidence now prove generic generated-scene overview cues cannot substitute for explicit equipment-necessity and scene-decluttering review/runtime signals. Verification: `pnpm exec vitest run tools/openclinxr/visual-qa-evidence-check.test.ts tools/openclinxr/runtime-realism-evidence-check.test.ts`.

2026-05-26 Shared Asset Library Lead LRU reuse regression: Cache evidence now proves `hit_reused` preserves the original stored asset ref, skips generation, promotes the hit to the most-recent slot, and does not evict the reused key on the next constrained-cache miss. Verification: `pnpm exec vitest run tools/openclinxr/shared-asset-library-cache-evidence.test.ts`; `pnpm --filter @openclinxr/capability-gateway test -- asset-generation-jobs.test.ts`.

2026-05-26 Asset Pipeline Lead external AI provider preflight guard: Hunyuan3D local, Meshy cloud, Tripo cloud, and VLM adversarial-review candidates are explicitly covered in metadata-only preflight tests with execution disabled, no external network, no paid API use, and approval/credential gates before execution. Verification: `pnpm exec vitest run tools/openclinxr/external-ai-asset-provider-preflight.test.ts`; `pnpm --filter @openclinxr/capability-gateway test -- capability-gateway.test.ts asset-generation-jobs.test.ts`.

2026-05-26 Worker 9 structured examinee locomotion evidence copy: UI-XR copied/manual evidence now includes `examineeLocomotionEvidence`, preserving structured path cue IDs such as `structured_examinee_locomotion_path_evidence` while explicitly not claiming Quest readiness, clinical validity, scoring validity, or motion-comfort validation. Verification: `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 runtime-realism locomotion checker guard: Runtime-realism evidence checker now has explicit test coverage that browser capture `examineeLocomotionEvidence` satisfies `examinee_locomotion_observed` while preserving `quest_readiness` in `notEvidenceFor`. Verification: `pnpm exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts`.

2026-05-26 Worker 4/2 pediatric asthma runtime handoff generalization: Projection-artifact CLI publication now has focused coverage showing `peds_asthma_parent_anxiety_v1` carries case-defined humanoid runtime handoff metadata for patient/family/nurse through report and scene manifest output. Verification: `pnpm exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts`; `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts`.

2026-05-26 Worker 7/8 review-safe humanoid runtime handoff: Review replay readiness now carries case-defined humanoid runtime handoff metadata from scene-generation actor work orders into API/client/admin review UI. The panel surfaces `caseDefinedHumanoidRuntimeHandoff`, actor roles, required runtime signal IDs, blockers, and explicit non-readiness caveats as faculty/admin context only. Verification: `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/ui-admin test -- ReviewReplayReadinessSummaryPanel.test.tsx api-client.test.ts`; `pnpm --filter @openclinxr/ui-admin typecheck`.

2026-05-26 Worker 9 UI-XR scene-manifest humanoid runtime handoff preservation: Copied/manual XR evidence now carries sanitized case-defined humanoid runtime handoff metadata from loaded scene manifests so adversarial/runtime review can inspect actor-level humanoid runtime expectations without treating them as generated asset, animation quality, Quest, runtime, clinical, or scoring readiness. Verification: `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-24 Worker 7/8 review-safe evidence boundary slice: Admin completed-station review-safe boundary now displays patient-note attachment/timing and latest replay timeline second from existing review packet fields, preserving summary-only faculty review posture.

2026-05-24 Worker 7/8 faculty-review posture slice: Admin completed-station review handoff now exposes reviewer decision posture metrics: faculty draft status/reviewer, draft comments, patient-note evidence timing, and trace-quality missing-tag/provenance posture. This advances the faculty/admin review lane without schema or persistence refactor.

2026-05-24 generated-human rig report eyelid contract: Generated-human rigging reports now require `eyelidBlinkControlsPresent: true`, tying generated eyelid blink controls into the asset-pipeline validation contract.

2026-05-24 autonomy/agent activation review: Heartbeat XML responses are platform turn boundaries, not completion. Repo-defined agents under `agents/**` are active as file-backed memory and through `pnpm agent:*` tooling, but no always-on OpenClaw daemon auto-spawns them. Long autonomous batches should explicitly use `local_role_consultation`, `live_subagents`, or `agent_loop_artifact`; after two evidence/gate-only slices, consult coordinator, implementation-planning, gap-attacker, and VP-engineering-delivery roles before choosing the next product slice.

2026-05-24 live subagent discovery update: Codex live subagent tooling can be lazy-loaded as `multi_agent_v1`. Future long-running batches should search for multi-agent/subagent tools before assuming repo agents are file-backed only, then map live `explorer`/`worker` prompts to repo-defined roles when Patrick has requested OpenClaw-style agent use and the work is independent enough to delegate.

2026-05-24 generated eyelid first-class signal: Runtime realism and humanoid visual QA now require `generated_eyelid_blink_control_cue` explicitly, ensuring the generated eyelid rig control is evaluated as its own evidence signal.

2026-05-24 generated eyelid runtime-gate connection: Runtime realism now requires the generated eyelid blink control cue, plus numeric blink/saccade metrics, before accepting blink/micro-saccade evidence; UI-XR copied speech evidence preserves that cue.

2026-05-24 generated eyelid controls slice: Generated humanoid rigging now names left/right upper eyelid blink controls, and UI-XR dialogue playback drives them from the blink metric with `generated_eyelid_blink_control_cue` metadata.

2026-05-24 runtime eye-motion plausibility gate: Runtime realism evidence now rejects out-of-range blink intensity or micro-saccade yaw/pitch metrics before accepting blink/micro-saccade evidence.

2026-05-24 runtime eye-motion metric gate: Runtime realism evidence now requires numeric blink intensity and micro-saccade yaw/pitch metrics before accepting `dialogue_eye_micro_saccade_blink_cue`.

2026-05-24 copied eye-motion metrics: UI-XR humanoid speech evidence now includes numeric blink intensity and micro-saccade yaw/pitch values, and copied runtime/Quest evidence tests preserve them for downstream review.

2026-05-24 copied runtime evidence cue contract: UI-XR copied Quest/manual evidence payloads now have a test-level contract that active humanoid speech evidence preserves `dialogue_eye_micro_saccade_blink_cue`, active viseme/phoneme, and mouth openness for downstream visual/runtime review.

2026-05-24 temporal video MIME/path guard: Visual QA now blocks mismatched video artifact extension and MIME metadata before accepting temporal humanoid evidence.

2026-05-24 temporal video frame-rate guard: Visual QA video artifacts now require duration and frame count to imply 6-120 fps before temporal blink/micro-saccade pass claims are accepted.

2026-05-24 temporal video frame-count guard: Visual QA video artifacts now require `frameCount >= 12` for temporal humanoid review, preventing blink/micro-saccade pass claims from metadata-only or too-few-frame clips.

2026-05-24 temporal video duration guard: Visual QA video artifacts now require `durationMs >= 1000` for temporal humanoid review, keeping blink/micro-saccade pass claims tied to actual time-based evidence rather than a single frame.

2026-05-24 temporal video anti-placeholder guard: Visual QA now rejects video artifacts under 1024 bytes as too small for temporal review, so blink/micro-saccade pass claims cannot ride on tiny placeholder files.

2026-05-24 temporal video evidence path: Visual QA evidence now accepts `video/webm` and `video/mp4` artifacts under `docs/openclinxr/videos/`, allowing blink/micro-saccade temporal readability to pass only from video evidence instead of screenshots.

2026-05-24 temporal eye-evidence guard: Humanoid visual QA now rejects still screenshot artifacts that claim `pass` for eye blink/micro-saccade readability. Use short video or headset evidence before marking temporal ocular realism as passing.

2026-05-24 visual QA eye-analysis slice: Humanoid-focused visual QA now requires `eye_blink_micro_saccade_readability` and the current mouth/gaze/pose evidence records the blink/micro-saccade cue as still-image concern. Next evidence should prefer short video or headset capture for temporal eye realism instead of treating a still screenshot as proof.

2026-05-24 eye realism gate slice: Runtime realism evidence now requires and recognizes `dialogue_eye_micro_saccade_blink_cue`, and UI-XR speech evidence includes it in active expression cues. Future humanoid visual QA should verify blink/micro-saccade readability instead of accepting generic gaze cues alone.

2026-05-24 eye realism slice: UI-XR generated humanoid dialogue playback now adds deterministic eye micro-saccade and blink transforms to the generated eye rig controls, with reset behavior after speech and `dialogue_eye_micro_saccade_blink_cue` evidence metadata. Next visual evidence should check whether this reads as more lifelike without reintroducing floating gaze overlays or overclaiming production ocular animation.

2026-05-24 mouth/gaze/pose capture fix: UI-XR actor-pose/mouth-gaze review captures now keep dialogue playback alive for 45 seconds and reapply the relaxed clinical idle posture during capture review. This is a targeted screenshot-driven improvement from the blocked 2026-05-24 mouth/pose analysis, not a production lip-sync or biomechanics claim.

2026-05-24 mouth/gaze/pose framing fix: `mouth-gaze-pose` captures now use actor-pose deocclusion so humanoid face, gaze, mouth, and pose review is not obscured by bed/equipment clutter.

2026-05-24 mouth/gaze cue refinement: active eye-focus cue geometry is smaller and more transparent, while the mouth cue is larger and mouth-local. Continue moving toward mesh/morph-driven facial animation, but this improves current evidence capture without reintroducing persistent floating gaze overlays.

2026-05-24 clinical idle posture refinement: generated humanoid runtime posture assist now lowers arms/forearms and softens hand rotations to reduce the stiff mannequin read observed in the 2026-05-24 mouth/gaze/pose screenshots.

2026-05-24 alignment note: visual QA evidence now blocks known rejected humanoid visual-regression cues (`persistent_gaze_readability_cue`, `floating_eye_focus_overlay_after_dialogue`, `broad_face_material_contrast_patch`). Future Worker 9/11 realism slices should improve actual humanoid mesh/material/facial/gaze quality rather than reintroducing overlays or broad material patches that earlier screenshots rejected.

2026-05-24 humanoid evidence gate: visual QA artifacts marked `visualQaFocus: "humanoid_realism"` must include explicit runtime realism signal IDs for animation playback, authored clinical idle pose, visible mouth/eye expression cues, and dialogue viseme/gaze mapping. Keep using this link between screenshot review and runtime evidence before claiming a humanoid realism iteration is ready for adversarial review.

2026-05-24 shared signal contract: the humanoid visual QA checklist now consumes the runtime realism gate's exported required signal IDs, excluding only scenario-panel and locomotion signals that are not face/actor-specific screenshot signals. Update the runtime realism contract first when adding new evidence requirements.

2026-05-24 bundle evidence gates: encounter runtime asset bundles now include evidence gate references so admin-generated scene bundles can explicitly carry pending or attached runtime-realism, visual-QA, Quest-runtime, and asset-review evidence. The local fixture bundle starts with pending runtime-realism and visual-QA gates rather than implying readiness.

2026-05-24 storage publication evidence gates: blob-compatible encounter bundle writes now preserve attached `evidenceGateRefs` in the stored JSON bundle. This keeps Azurite/Azure publication aligned with the evidence-gated scene-generation pipeline rather than leaving runtime realism proof in loose side documents.

2026-05-24 admin publication evidence gates: the scene-generation publication-readiness API and admin queue panel now expose asset-review, runtime-realism, and visual-QA evidence gate refs. "Publisher ready" remains only a local bundle-publisher gate; runtime realism and visual QA stay visibly pending until attached evidence exists.

2026-05-24 admin client evidence-gate contract: the UI admin API-client contract test now verifies publication-readiness `evidenceGateRefs` survive fetch/typing into the admin layer, reducing risk that generated encounter bundle gate state is dropped before the operator sees it.

2026-05-24 worker execution evidence gates: encounter asset-generation worker executions now include pending gate refs for asset production review, runtime realism, visual QA, and Quest runtime evidence. This makes durable queue/job state carry the same evidence-gated posture as admin publication readiness and frozen learner bundles.

2026-05-24 Mongoose job evidence gates: encounter asset-generation job records now persist and reload worker `evidenceGateRefs` with defensive array copies. Queue workers can therefore pause/resume with the same asset-review, runtime-realism, visual-QA, and Quest evidence posture instead of recomputing or losing it.

2026-05-24 executable encounter prerequisites: encounter asset-generation plans now require runtime-realism evidence, humanoid visual QA evidence, and Quest runtime evidence before executable encounter readiness, in addition to scene manifest, blob asset, learner bundle, and human-review gates. Publication alone must not be interpreted as learner/runtime readiness.

2026-05-24 learner-use gate separation: scene-generation publication readiness now distinguishes running the generated bundle publisher from using that bundle in learner runtime. Admin UI shows learner runtime use blocked while runtime-realism, visual-QA, and Quest evidence gates remain unattached.

2026-05-24 bundle learner-use evaluator: asset-registry now derives generated-bundle learner-use readiness directly from `evidenceGateRefs`, reporting pending/attached gates and blockers. Prefer this evaluator over app-local readiness booleans when wiring generated bundles into learner runtime.

2026-05-24 API learner-use evaluator wiring: the scene-generation publication-readiness route now derives learner runtime use blockers from asset-registry's bundle learner-use evaluator. This keeps admin/API readiness aligned with the generated bundle evidence-gate contract.

2026-05-24 Quest gate in learner bundle: the local generated learner bundle now carries a pending `quest_runtime_evidence` gate in addition to runtime-realism and visual-QA gates. Learner-use readiness should continue to block until Quest/WebXR evidence is attached, even if desktop/runtime evidence passes.

2026-05-24 structured humanoid screenshot analysis: humanoid-focused visual QA now requires explicit face, mouth, gaze, pose, and hand/arm analysis checks. Blocked checks become machine-readable blockers, so screenshot capture loops should feed concrete rigging, facial, gaze, and pose improvements rather than vague realism notes.

Date: 2026-05-03
Status: code-phase handoff companion

Latest autonomous slice (2026-05-26): Worker 11 scene-manifest publication payloads now freeze case-defined humanoid runtime handoff metadata from actor-specific humanoid/animation work orders into generated scene manifests. Focused verification passed with `pnpm exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts`, `pnpm --filter @openclinxr/asset-registry typecheck`, and `pnpm --filter @openclinxr/ui-admin typecheck`.

Latest autonomous slice (2026-05-26): Worker 11/7 scene-generation actor work orders now include metadata-only humanoid runtime readiness handoff requirements and UI-admin surfaces them in the 3D Environment Generation Queue for the featured scene pipeline. Focused verification passed with `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts`, `pnpm --filter @openclinxr/asset-registry typecheck`, `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx App.test.tsx`, and `pnpm --filter @openclinxr/ui-admin typecheck`.

Latest autonomous slice (2026-05-26): Worker 11 queue validation now checks per-work-order humanoid performance flags against the case-defined contract role arrays and planning booleans, preventing drift between encounter definition and actor work orders. Focused verification passed with `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts`.

Latest autonomous slice (2026-05-26): Worker 7 UI-admin API-client contract coverage now verifies review replay readiness summaries preserve case-defined humanoid performance contract metadata across the REST client boundary. Focused verification passed with `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts` and `pnpm --filter @openclinxr/ui-admin typecheck`.

Latest autonomous slice (2026-05-26): Worker 5/7 API review replay readiness summaries now include scenario-bank-derived case-defined humanoid performance contract metadata for the replay packet scenario. Focused verification passed with `pnpm --filter @openclinxr/api test -- app.test.ts` and `pnpm --filter @openclinxr/api typecheck`.

Latest autonomous slice (2026-05-26): Worker 7/8 review route now passes optional case-defined humanoid performance contract metadata from review replay readiness summaries into review replay and faculty decision panels. Focused verification passed with `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx ReviewReplayReadinessSummaryPanel.test.tsx FacultyReviewDecisionPanel.test.tsx` and `pnpm --filter @openclinxr/ui-admin typecheck`.

Latest autonomous slice (2026-05-26): Worker 11 queue validation now requires per-work-order case-defined humanoid performance metadata for actor-specific humanoid GLB and animation work orders whenever a projection humanoid contract is present. Focused verification passed with `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts` and `pnpm --filter @openclinxr/capability-gateway typecheck`.

Latest autonomous slice (2026-05-26): Worker 11/capability-gateway actor-specific humanoid and animation work orders now receive case-defined humanoid performance requirements from projection queue reports, including locomotion/expression/gaze/lip-sync/interactivity flags and metadata-only caveats. Focused verification passed with `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts` and `pnpm --filter @openclinxr/capability-gateway typecheck`.

Latest autonomous slice (2026-05-26): Worker 11 queue reports now carry validated case-defined humanoid performance work-order coverage, mapping contract actor roles to humanoid GLB and animation work orders plus required realism signals. Focused verification passed with `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts`.

Latest autonomous slice (2026-05-26): Worker 7/8 admin review surfaces can now render optional case-defined humanoid performance contract metadata in review replay and faculty decision panels without changing readiness gates. Focused verification passed with `pnpm --filter @openclinxr/ui-admin test -- ReviewReplayReadinessSummaryPanel.test.tsx FacultyReviewDecisionPanel.test.tsx` and `pnpm --filter @openclinxr/ui-admin typecheck`.

Latest autonomous slice (2026-05-26): Worker 11 queue-report humanoid contract validation now rejects projection queue reports that omit or weaken the case-defined humanoid performance contract. Focused verification passed with `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts`.

## Purpose

This document translates the architecture into worker-owned build slices. It complements the exhaustive implementation plan and should be kept current while code is being written.

Repo-level autonomous continuation and agent-use rules live in [AGENTS.md](../../AGENTS.md). Re-read that file after context compaction and before deciding whether to stop.

Coordinator-facing task selection, sub-agent control, and anti-toil rules live in [PROJECT_COORDINATION_INDEX.md](../../PROJECT_COORDINATION_INDEX.md).

Nonblocking operator suggestions that should be remembered but not implemented immediately live in [operator-suggestion-backlog.md](../../operator-suggestion-backlog.md).

## Global Rules

- No cloud APIs, paid services, or third-party model calls in default setup.
- Patrick approved local tooling installs when needed for asset-generation or 3D-environment progress. Prefer already installed tools first, record any new install with license/provenance posture, and do not treat install permission as approval for paid/cloud APIs, hosted services, production deployment, or runtime dependency changes.
- No model or voice downloads during install, test, or dev startup.
- Optional local runtimes must report `not_configured` instead of failing.
- `mongodb-memory-server` may download a `mongod` binary for local integration tests; this must be pinned, documented, and skippable until cached.
- MongoDB schema, repository, query, index, and search/AI slices should consult the MongoDB Agent Skills installed from `mongodb/agent-skills` before design or implementation work; this is advisory workflow guidance, not approval for Atlas/cloud services.
- Every package gets unit tests before downstream UI depends on it.
- Every user-facing assessment phrase must avoid licensure, diagnosis, and exam-equivalence claims.
- Every asset record must carry provenance, license, optimization target, and QA status.
- XR and UI slices should capture browser screenshots and, when tooling supports it, short videos as review artifacts; adversarial agents must label the evidence source and critique scene fidelity, readability, actor/equipment realism, interaction affordances, occlusion, scale, and clinical safety cues before visual-readiness claims.
- Do not treat a completed worker slice, focused verification pass, benchmark smoke, or backlog update as a stopping point. Record it here, then continue to the next approved local deterministic slice unless a true stop condition is reached.
- Do not emit chat progress updates, status updates, checkpoint summaries, file-change summaries, test summaries, "what changed" summaries, or final responses during autonomous continuation. Checkpoints are file updates only.
- A blocker on one worker lane should produce an operator question/proposal with a recommended default, then an immediate pivot to another worker lane that can demonstrate product progress. Stop only when every approved worker lane is blocked.
- Do not toil on evidence refreshes. Evidence-only slices must either verify just-touched code, capture a newly available runtime/hardware fact, or unblock a named implementation decision. If two consecutive slices only refresh reports or confirm known blockers, switch to a product-shaping worker slice and use the repo-defined Chief Coordinator plus Implementation Plan Gap Attacker posture to select it.
- Prefer slices that complete a learner, faculty, scenario-author, reviewer, XR-runtime, persistence, provider-facade, or asset-production path over slices that only make dashboards fresher.
- For multi-hour or multi-day unattended work, rely on repo-file rehydration rather than chat memory. `AGENTS.md` is the source of truth for stop conditions, heartbeat handling, plugin/skill approval gates, and the no-checkpoint autonomy loop.
- Do not let optional methodology or plugin review gates stop already-approved local deterministic work. Use those gates only for new scope, destructive operations, paid/cloud/API use, production deployment, credentials, physical hardware action, or runtime dependency changes.

## Agent Factory Alignment

Use the repo-native agent system as persistent memory for focus, not merely as generated artifacts.

Before major task selection, drift recovery, or a suspected evidence loop, consult:

- `docs/agent-factory/README.md`
- `docs/agent-factory/operating-loop.md`
- `docs/agent-factory/rubric.md`
- `docs/agent-factory/model-assignment-policy.md`
- Latest `iterations/iteration-*/07-final-synthesis.md`
- Relevant `agents/**/charter.md` and `agents/**/memory.md`

Productive slice test:

- A slice is productive when it advances implementation readiness, architecture coherence, UX/workflow fit, clinical-simulation fidelity, Quest/WebXR interaction, persistence safety, provider safety, or asset realism.
- A slice is toil when it only repeats a known blocked result, refreshes source/cache evidence without a dependent implementation decision, or reruns aggregate gates after no meaningful product change.

## Active Product Advancement Order

Use this order when choosing new work:

1. Worker 7 plus Worker 8 completed-station faculty review path.
2. Worker 9 XR trace interaction or locomotion instrumentation, with IWSDK considered as sidecar support.
3. Worker 4 plus Worker 2 scenario-bank expansion backed by shared schemas.
4. Worker 11 reviewed asset-production evidence ladder for one named artifact.
5. Worker 5 plus Worker 12 replayable station evidence inside approved persistence boundaries.

Workers not in this list can still be used when they unblock one of these lanes, but they should not become standalone evidence or hardening loops.

Current Worker 9 XR/runtime scene evidence:

- 2026-05-21: `apps/ui-xr` now serves the generated humanoid fixture at `public/xr-assets/humanoids/neutral-generated-human.glb` and loads it into the patient, nurse, and spouse scene slots while retaining primitive actor fallbacks. The GLB is provenance-documented as a local fixture and does not claim production asset, Quest, clinical-validity, or scoring readiness. Focused `@openclinxr/ui-xr` test/typecheck passed.
- 2026-05-21: `apps/ui-xr` now serves generated ECG cart and IV pole/pump fixtures from `public/xr-assets/medical-equipment/` and loads them into named scene slots included in the IWSDK scene hierarchy contract. Primitive equipment fallbacks remain available if GLB loading fails, and provenance documents the local fixture boundary. Focused `@openclinxr/ui-xr` test/typecheck passed.
- 2026-05-21: `apps/ui-xr` manual evidence payloads now include `sceneAssetEvidence` so headset/IWSDK captures can report generated humanoid/equipment asset load status, fallback activation, and scene-slot names without making Quest-readiness or production-asset claims. Focused `@openclinxr/ui-xr` test/typecheck passed.
- 2026-05-21: IWSDK scene hierarchy targets now include generated GLB child object names for all loaded humanoid/equipment fixtures, letting sidecar/agent review detect missing generated assets rather than only confirming primitive fallback slots. Focused `@openclinxr/ui-xr` test/typecheck/build passed.
- 2026-05-21: The in-headset Quest Evidence panel now displays generated scene asset load status with loaded/expected counts, failures, and fallback count, so operators can see humanoid/equipment GLB posture before copying evidence. Focused `@openclinxr/ui-xr` test/typecheck/build passed.
- 2026-05-21: Static asset tests now hash-check served generated humanoid/equipment GLBs against their local provenance files, preventing silent public-asset drift from the generated fixture evidence. Focused `@openclinxr/ui-xr` test/typecheck passed.
- 2026-05-21: Generated humanoid fixtures are now role-tinted at runtime for patient, nurse, and spouse slots so the VR scene has distinguishable actors while still using the same local fixture and fallback boundary. Focused `@openclinxr/ui-xr` test/typecheck/build passed.
- 2026-05-21: Generated humanoid scene slots now include in-scene role/name plates for patient, nurse, and spouse so headset visual QA can identify actors directly in the VR bay. Focused `@openclinxr/ui-xr` test/typecheck/build passed.
- 2026-05-21: Generated equipment scene slots now include in-scene labels for the 12-lead ECG cart and IV pump so headset visual QA can identify local fixture props directly. Focused `@openclinxr/ui-xr` test/typecheck/build passed.
- 2026-05-23: Generated humanoid dialogue behavior now adds visible eye-focus cues and bounded speaker-facing yaw toward the current learner/actor gaze target. This turns the prior phoneme/gaze evidence into more readable in-scene behavior while preserving non-production lip-sync and eye-tracking caveats. Focused `@openclinxr/ui-xr` test/typecheck passed.
- 2026-05-23: Remote actor-response text now feeds the generated humanoid dialogue path instead of only the local mock line. Successful API actor responses update the in-scene dialogue panel and trigger phoneme/viseme, eye-focus, and gaze-target behavior on the corresponding generated humanoid before optional voice synthesis. Focused `@openclinxr/ui-xr` test/typecheck passed.
- 2026-05-23: The generated patient humanoid now starts the initial ED chest-pain dialogue playback when its GLB loads, giving desktop/headset visual QA an immediate speaking/gazing patient cue before any trace action is selected. Focused `@openclinxr/ui-xr` test/typecheck passed.

Current Worker 11 asset-generation evidence:

- 2026-05-21: Generated-human-rigging now has a repo-authored, local Blender-scripted generator at `tools/openclinxr/generated-human-rigging-artifacts.ts`. It materializes `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb`, `canonical-skeleton-binding.json`, and `skin-weight-quality.json` with a canonical humanoid armature, required joint names, skinned mesh inventory, and explicit non-production caveats. No new install was introduced because Blender was already available locally. Focused verification passed with `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:human-rigging:validate`, and `pnpm asset:production:artifact-evidence:validate`.
- 2026-05-23: Generated-human-rigging now uses Anny `0.3.1`, the previously identified preferred permissive humanoid generator, for the neutral source body mesh before the OpenClinXR canonical Blender rig/export step. The local tool runtime is isolated under `.openclinxr/tool-runtimes/anny-py311`; generated source artifacts include `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/anny-neutral-generated-human.obj` and `anny-source-generator-manifest.json`; the served XR GLB provenance/hash now reflects the Anny-derived mesh. Current blocker remains deformation/character-art quality review because skinning is heuristic and evidence-gated. Focused verification passed with `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts` and `pnpm asset:human-rigging:validate`.
- 2026-05-23: The Anny-derived GLB now includes fixture hair, eyes, scrub tunic, scrub pants, and shoes, and runtime scene evidence records `generated_humanoid_hair_clothing_eye_detail_cue` with generated humanoid fallback inactive. Screenshot review still shows the actors reading as primitive silhouettes, so next Worker 11/9 asset slice should improve mesh/material/camera presentation before any realistic-humanoid claim. Focused generated-human, ui-xr, asset-registry, and ui-admin checks passed.
- 2026-05-23: Asset-registry now defines an admin-initiated full scene generation pipeline work order that starts after scenario configuration and covers humanoids, hair/clothing/skin, rigging, animation, equipment, environment assets, Azurite/Azure blob publication, runtime bundle binding, and review/Quest evidence gates. The admin environment-generation panel surfaces the same operational boundary. Focused asset-registry and ui-admin checks passed.
- 2026-05-23: The admin-initiated scene generation pipeline now has a REST/control-plane route, API client method, and admin panel visibility. The seed bank exposes 9 pending pipeline stages per scenario while preserving the `scene_generation_pipeline_queue_not_asset_production` boundary. Focused rest, asset-registry, api, and ui-admin checks passed.
- 2026-05-21: Skin/clothing provenance now has a repo-authored local fixture generator at `tools/openclinxr/skin-clothing-provenance-artifacts.ts`. It materializes `.openclinxr/asset-production/ed-chest-pain/skin-clothing-provenance/skin-texture-provenance.json`, `clothing-mesh-provenance.json`, and `runtime-safe-materials.json`, tying procedural skin/scrub/shoe material posture back to the generated humanoid without external textures, third-party clothing meshes, cloud APIs, paid APIs, production-readiness claims, or new installs. Focused verification passed with `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/skin-clothing-provenance-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:skin-clothing:validate`, and `pnpm asset:production:artifact-evidence:validate`.
- 2026-05-21: Medical-equipment library now has a repo-authored local Blender fixture generator at `tools/openclinxr/medical-equipment-artifacts.ts`. It materializes `.openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb`, `iv-pole-with-pump.glb`, and `equipment-provenance.json` for ED station environment cues without external assets, cloud APIs, paid APIs, production-readiness claims, or new installs. Focused verification passed with `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/skin-clothing-provenance-artifacts.test.ts tools/openclinxr/medical-equipment-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:medical-equipment:validate`, and `pnpm asset:production:artifact-evidence:validate`.
- 2026-05-21: Asset-production support artifacts now materialize the remaining required local fixture slots for animation retargeting, LOD/texture/collider budgets, and Quest bundle/multi-actor/frame-pacing evidence through `tools/openclinxr/asset-production-support-artifacts.ts`. All required artifact file paths in `docs/openclinxr/asset-production-artifact-evidence-2026-05-21.json` are now materialized locally, but production readiness remains blocked because evidence is still fixture-tier and review reports are not complete. Focused verification passed with `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/skin-clothing-provenance-artifacts.test.ts tools/openclinxr/medical-equipment-artifacts.test.ts tools/openclinxr/asset-production-support-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:production:support-artifacts:validate`, and `pnpm asset:production:artifact-evidence:validate`.

## Worker 0: Security Posture Steward

Owned paths:

- `docs/openclinxr/security-audit-exceptions.md`
- `docs/openclinxr/security-audit-cadence.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `operator-suggestion-backlog.md` (audit cadence suggestion entry)

Tasks:

- Run recurring high-severity point-in-time audit snapshots.
- Keep the latest snapshot references current in `docs/openclinxr/security-audit-exceptions.md`.
- Validate audit evidence with `pnpm security:audit-policy`.

Current implementation evidence:

- Latest audit snapshot: `docs/openclinxr/security-audit-2026-05-21.json`.
- Latest policy report: `docs/openclinxr/security-audit-policy-2026-05-21.json`.
- `fast-uri` is pinned through a documented package-manager override at `3.1.2` to resolve GHSA-q3j6-qgpj-74h6 and GHSA-v39h-62p7-jpjc while `ajv@8.20.0` remains pinned.

Validation:

- `pnpm security:audit --audit-level=high`
- `pnpm security:audit-policy -- --audit-json docs/openclinxr/security-audit-YYYY-MM-DD.json --output docs/openclinxr/security-audit-policy-YYYY-MM-DD.json`

Done when:

- `security-audit-exceptions.md` contains a current snapshot reference and policy result link.
- `operator-suggestion-backlog.md` marks this cadence item as promoted/tracked.
- No unresolved high/critical exceptions are in `pnpm verify` posture.

## Worker 1: Workspace Steward

Owned paths:

- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`
- `vitest.config.ts`
- `.npmrc`

Tasks:

- Create workspace.
- Add root verification scripts.
- Pin dependency versions.
- Document optional dependency gates.

Validation:

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`

Done when:

- Empty workspace or first package verifies without optional runtimes.

## Worker 2: Schema Steward

Owned paths:

- `packages/openclinxr/shared-schemas`

Schemas:

- `ExamBlueprint`
- `Scenario`
- `ActorCard`
- `CommunicationProfile`
- `EnvironmentManifest`
- `AssetManifest`
- `StationRun`
- `TraceEvent`
- `PatientNote`
- `ReviewPacket`
- `ModelProviderAudit`
- `VoiceProviderAudit`
- `ProviderHealth`

Validation:

- Valid ED chest pain scenario passes.
- Missing review gates fail.
- Trace event without sequence fails.
- Asset without license fails.
- Provider audit without provider ID fails.

Current evidence:

- 2026-05-21: Shared schemas now include asset manifest validation, provider audit-record validation, and station-run validation. Domain station-run typing now aliases the shared schema contract. Focused shared-schemas, asset-registry, domain, model-gateway, and voice-gateway verification passed for the touched slices.
- 2026-05-21: Shared schemas now expose backlog-named `ModelProviderAuditSchema` and `VoiceProviderAuditSchema` aliases plus validators, with coverage that missing provider identity fails. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Shared provider audit validators now reject whitespace-only required identity and policy fields, and named model/voice audit validators reuse that semantic guard. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Shared schemas now expose `ExamBlueprintSchema`, timing/slot schemas, and `validateExamBlueprint`; `@openclinxr/exam-assembly` aliases blueprint types to the shared schema contract. Focused shared-schemas and exam-assembly test/typecheck passed.
- 2026-05-21: `@openclinxr/exam-assembly` timing windows now sort deterministically by station order then slot ID, and break checkpoints sort chronologically. Focused exam-assembly test/typecheck passed.
- 2026-05-21: `@openclinxr/exam-assembly` now deduplicates blueprint required trace and safety-critical trace tags before coverage and issue reporting, preventing repeated blueprint config from duplicating missing-coverage blockers. Focused exam-assembly test/typecheck passed.
- 2026-05-21: `@openclinxr/exam-assembly` now deduplicates repeated `breakAfterStationOrders` before deriving timing-plan break checkpoints. Focused exam-assembly test/typecheck passed.
- 2026-05-21: `@openclinxr/exam-assembly` now assigns scenarios against blueprint station slots sorted by station order, preventing unsorted blueprint input from rotating scenario-to-station references. Focused exam-assembly test/typecheck passed.
- 2026-05-21: Shared schemas now expose `CommunicationProfileSchema` plus a validator and optional actor-card linkage for bounded style, mood, escalation, de-escalation, adverse response, and cultural/language notes. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Provider-health validation now rejects `ready` records that still carry blockers, keeping optional runtime posture semantically consistent. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Provider-health validation now rejects whitespace-only provider IDs in addition to contradictory ready-with-blockers records. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Shared schemas now expose `EnvironmentManifestSchema` plus a validator over the existing scenario environment, equipment, and asset-need contract. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Shared schemas now bound scenario asset needs to the same asset-kind vocabulary used by asset manifests, preventing unknown asset need types in environment manifests; scenario-bank helpers now use the bounded asset-need type. Focused shared-schemas and scenario-fixtures test/typecheck passed.
- 2026-05-21: Shared `validateStationRun` now rejects embedded patient notes whose `stationRunId` differs from the station run. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Shared review-packet validation now rejects mismatched patient-note station IDs and blank faculty reviewer IDs, aligning schema validation with review-workflow guards. Focused shared-schemas and review-workflow test/typecheck passed.
- 2026-05-21: Shared review-packet validation now checks trace-quality counters against timeline length, unsafe-event count, missing-required count, and patient-note presence. Focused shared-schemas, review-workflow, and test-harness test/typecheck passed.
- 2026-05-21: Shared review-packet validation now checks model-generated, model-failed, and voice-audio trace-quality counters against timeline event types. Focused shared-schemas, review-workflow, and test-harness test/typecheck passed.
- 2026-05-21: Shared review-packet validation now rejects `hasModelProvenance: true` when no model-generated timeline events exist. Focused shared-schemas, review-workflow, and test-harness test/typecheck passed.
- 2026-05-21: Shared review-packet validation now rejects duplicate replay timeline sequence values so externally supplied packets cannot create ambiguous replay ordering or UI keys. Focused shared-schemas and review-workflow test/typecheck passed.
- 2026-05-21: Shared patient-note validation now rejects blank station run IDs and blank note text, and the same semantic guard is reused by station-run and review-packet validators. Focused shared-schemas, domain, and review-workflow test/typecheck passed.
- 2026-05-21: Shared trace-event validation now rejects whitespace-only station run IDs, event types, sources, actor IDs, and tags, closing the semantic gap left by structural `minLength` checks. Focused shared-schemas test/typecheck passed.
- 2026-05-21: Shared scenario validation now rejects blank required trace tags and blank safety-critical trace tags before safety-critical set membership checks. Focused shared-schemas and scenario-fixtures test/typecheck passed.

Done when:

- Schema package has passing positive and negative tests.

## Worker 3: Domain Steward

Owned paths:

- `packages/openclinxr/domain`

Tasks:

- Implement station state transitions.
- Implement command validation.
- Implement event schedule evaluation.
- Implement required trace tag evaluation.
- Implement claim-language constants for safe UI copy.

Current evidence:

- 2026-05-21: Station command validation rejects impossible timestamps and empty patient notes while preserving valid doorway-to-encounter-to-note-to-review transitions. Focused `@openclinxr/domain` test/typecheck passed.
- 2026-05-21: Scheduled event evaluation now returns due events in deterministic `atSecond` then `eventId` order. Focused `@openclinxr/domain` test/typecheck passed.
- 2026-05-21: Architecture rules now enforce that `@openclinxr/domain` depends only on shared schemas and does not import API, React, MongoDB, model, voice, REST, or app layers. Focused architecture-rule test and typecheck passed.
- 2026-05-21: Required trace-tag evaluation now deduplicates required tags and ignores unmapped observed runtime probes, preventing duplicate config entries from overstating observed behavior counts. Focused domain test/typecheck passed.
- 2026-05-21: Station-run creation now rejects blank scenario or learner IDs before constructing run IDs. Focused domain test/typecheck passed.

Validation:

- Doorway to encounter to note to review passes.
- Note submission before encounter end fails.
- Nurse interruption appears at configured time.
- Missing ECG request is detected.

Done when:

- Domain package has no dependency on API, React, MongoDB, model, or voice packages.

## Worker 4: Scenario Fixture Steward

Owned paths:

- `packages/openclinxr/scenario-fixtures`

Tasks:

- Encode ED chest pain station.
- Add patient, spouse, and nurse actors.
- Add environment needs.
- Add equipment needs.
- Add required trace tags.
- Add dialogue fixture seeds.
- Add review rubric IDs.

Current evidence:

- 2026-05-21: ED chest pain fixture exports deterministic dialogue seeds for patient history, nurse escalation, spouse communication, and hidden-truth guardrail probing. Focused scenario-fixtures test/typecheck passed.
- 2026-05-21: Scenario-fixtures tests now verify dialogue seed actor IDs exist, expected trace tags align with required/guardrail vocabulary, and review rubric IDs are unique. Focused scenario-fixtures test/typecheck passed.
- 2026-05-21: ED chest pain patient, spouse, and nurse actors now carry bounded communication profiles for style, mood, adverse response, de-escalation, escalation, and cultural/language notes. Focused scenario-fixtures test/typecheck passed.
- 2026-05-21: Scenario-bank tests now validate every scenario's environment, equipment, and asset needs through the shared `EnvironmentManifest` contract. Focused scenario-fixtures test/typecheck passed.
- 2026-05-21: Learner-facing scenario views now deep-clone the redacted public payload, preventing UI/API consumers from mutating fixture actor communication profiles or nested source state. Focused scenario-fixtures test/typecheck passed.
- 2026-05-21: Pediatric asthma now has deterministic dialogue and hidden-fact guardrail seeds for patient work-of-breathing, parent trigger/medication history, nurse oxygen/escalation, and hidden-truth probing. Tests verify actor linkage, trace-tag alignment, visible/hidden fact presence, and guardrail expectation. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.
- 2026-05-21: Psychiatric safety now has deterministic dialogue and hidden-fact guardrail seeds for direct safety questioning, confidentiality boundary-setting, nurse safety observation/escalation, and hidden-truth probing. Tests verify actor linkage, trace-tag alignment, visible/hidden fact presence, and guardrail expectation. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.
- 2026-05-21: Scenario-bank maturity now reports dialogue-seed coverage, missing seed scenarios, and hidden-truth guardrail probe coverage so future case-bank work can target the next unseeded stations. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.
- 2026-05-21: Ward delirium now has deterministic dialogue and hidden-fact guardrail seeds for orientation/infection questioning, daughter collateral medication reconciliation, nurse fall-risk planning, and hidden-truth probing. Scenario dialogue coverage now marks the station as seeded. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.
- 2026-05-21: Telehealth diabetes now has deterministic dialogue and hidden-fact guardrail seeds for medication reconciliation/access barriers, hypoglycemia teach-back, daughter-supported shared planning, and hidden-truth probing. Scenario dialogue coverage now marks the station as seeded. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.
- 2026-05-21: OB preeclampsia triage now has deterministic dialogue and hidden-fact guardrail seeds for pregnancy red flags, nurse BP/escalation, partner explanation, and hidden-truth probing. Scenario dialogue coverage now marks the station as seeded. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.
- 2026-05-21: ED stroke alert now has deterministic dialogue and hidden-fact guardrail seeds for last-known-well family history, focused neuro/medication/glucose assessment, consultant oral handoff, and hidden-truth probing. Scenario dialogue coverage now marks the station as seeded. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Validation:

- Fixture validates against schemas.
- Actor IDs referenced by dialogue and trace expectations exist.
- Required trace tags align with review packet expectations.

Done when:

- Test harness can load the fixture without file-system guessing.

## Worker 4A: Session State Steward

Owned paths:

- `packages/openclinxr/session-state`
- `packages/openclinxr/architecture-rules`

Tasks:

- Maintain the promoted multi-actor actor/session state contract.
- Preserve per-actor visible/private memory boundaries.
- Record text and final voice-transcript interaction provenance without raw audio.
- Track clinical trace tags, orders, findings, and spatial actor transforms.
- Keep WebSocket session-state messages design-only until implementation is explicitly scoped.
- Keep the superseded `multi-actor-state-spike` package out of production imports.

Validation:

- `pnpm --filter @openclinxr/session-state test`
- `pnpm --filter @openclinxr/session-state typecheck`
- `pnpm --filter @openclinxr/architecture-rules test`

Current implementation evidence:

- `packages/openclinxr/scenario-runtime` creates a promoted `MultiActorClinicalSession` per station run and uses `@openclinxr/session-state` for routed actor turns, final voice-transcript routing, clinical actions, open-order context, and actor model context.
- `packages/openclinxr/model-gateway` actor-response requests now carry safe clinical state context (`completedTraceTags` and `openOrders`) while `hiddenFacts` remains empty for model calls.
- `apps/api` exposes `POST /sessions/:stationRunId/clinical-actions` for explicit clinical action updates and `POST /sessions/:stationRunId/actor-response` can route through session-state when `actorId` is omitted.
- Verification evidence as of 2026-05-05: `pnpm typecheck`, `pnpm test`, `pnpm security:audit-policy`, `pnpm security:licenses`, and high-severity `pnpm security:audit` passed after these slices; `pnpm security:audit` still reports one moderate advisory below the configured fail level.
- 2026-05-21: `@openclinxr/scenario-runtime` now passes explicit provider request IDs into model and voice gateway calls and asserts request ID, model runtime name, and safety status in trace provenance. Focused scenario-runtime test/typecheck passed.
- 2026-05-21: `@openclinxr/scenario-runtime` now validates provider-health records before exposing the runtime provider-health snapshot, failing closed on contradictory ready-with-blockers records. Focused scenario-runtime test/typecheck passed.
- 2026-05-21: `@openclinxr/capability-gateway` now clones in-memory asset-generation job records on save/get/list so returned records cannot mutate stored lifecycle history or artifacts. Focused capability-gateway test/typecheck passed.
- 2026-05-21: `@openclinxr/capability-gateway` now fails asset-generation jobs whose returned manifest `capabilityId` does not match the requested capability. Focused capability-gateway test/typecheck passed.
- 2026-05-21: `@openclinxr/capability-gateway` now rejects blank generated asset-job IDs before lifecycle persistence. Focused capability-gateway test/typecheck passed.
- 2026-05-21: Durable clinical-event persistence now deep-clones nested private payload fields before in-memory storage and Mongo handoff, preventing caller mutation from altering stored redaction inputs. Focused session-state and data-mongodb test/typecheck passed.
- 2026-05-21: The in-memory durable clinical-event store now rejects non-`database_source_of_truth` store posture at runtime, matching the Mongo durable-store boundary guard. Focused session-state test/typecheck passed.
- 2026-05-21: Durable clinical-event review projection now rejects non-`database_source_of_truth` records, so direct projection and websocket design-message helpers preserve the durable-store boundary. Focused session-state test/typecheck passed.
- 2026-05-21: Architecture-rules verification stayed green after shared-schema and Mongo validation hardening. Focused architecture-rules test/typecheck passed.
- 2026-05-21: Architecture-rules verification stayed green after Quest/IWSDK evidence refreshes and durable persistence identity hardening. Focused architecture-rules test/typecheck passed.

Done when:

- Scenario runtime consumes `@openclinxr/session-state` for actor model context.
- `@openclinxr/session-state` has no Redis, Redka, MongoDB, Colyseus, bitECS, or WebSocket runtime dependency.
- The spike package remains evidence-only and superseded for production-shaped contracts.

## Worker 5: Trace And Review Steward

Owned paths:

- `packages/openclinxr/trace-ledger`
- `packages/openclinxr/review-workflow`

Tasks:

- Add append-only in-memory trace ledger.
- Add replay API.
- Add review packet builder.
- Add observed/missing/late behavior classification.
- Add human faculty score draft shape.

Current evidence:

- 2026-05-21: `@openclinxr/trace-ledger` clones events on append and replay so the in-memory ledger remains append-only from caller mutation. Focused trace-ledger test/typecheck passed.
- 2026-05-21: `@openclinxr/review-workflow` now classifies late trace tags from the earliest observed event for each tag rather than input order. Focused review-workflow test/typecheck passed.
- 2026-05-21: `@openclinxr/review-workflow` now sorts review timeline entries deterministically across sequence ties and sequence-less events. Focused review-workflow test/typecheck passed.
- 2026-05-21: `@openclinxr/review-workflow` now preserves source timeline sequence values only when all events have unique explicit finite sequences; duplicate or sequence-less inputs are normalized to dense replay order after deterministic sorting. Focused review-workflow test/typecheck passed.
- 2026-05-21: The shared review-packet schema validator now rejects duplicate replay timeline sequence values, complementing builder-side dense-sequence normalization for non-canonical packet inputs. Focused shared-schemas and review-workflow test/typecheck passed.
- 2026-05-21: `@openclinxr/review-workflow` now rejects patient notes whose `stationRunId` differs from the reviewed station run. Focused review-workflow test/typecheck passed.
- 2026-05-21: `@openclinxr/review-workflow` now clones patient-note and faculty-score-draft inputs into review packets, preventing caller mutation from altering validated review evidence. Focused review-workflow test/typecheck passed.
- 2026-05-21: `@openclinxr/review-workflow` now classifies `unsafe_` trace tags and `safety.*` event types as unsafe review events, preserving faculty safety signals beyond the older `unsafe.*` namespace. Focused review-workflow test/typecheck passed.
- 2026-05-21: Scenario publication readiness now blocks when asset readiness evidence belongs to a different scenario ID, preventing cross-scenario readiness leakage into learner-publication gates. Focused review-workflow test/typecheck passed.
- 2026-05-21: Scenario publication readiness now requires reviewer evidence references to contain nonblank strings, preventing placeholder refs from satisfying required reviewer roles. Focused review-workflow test/typecheck passed.
- 2026-05-21: Scenario publication readiness now deduplicates repeated required reviewer roles before reporting missing approval evidence, avoiding duplicate governance blocker output. Focused review-workflow test/typecheck passed.

Validation:

- Sequence ordering enforced.
- Replay is deterministic.
- Missing required tag is flagged.
- Human score draft cannot be generated without reviewer identity.

Done when:

- A synthetic trace can produce a faculty review packet.

## Worker 6: Test Harness Steward

Owned paths:

- `packages/openclinxr/test-harness`

Tasks:

- Build deterministic station runner.
- Emit trace fixture.
- Submit patient note.
- Generate review packet.
- Emit JSON summary for CI.
- Report optional runtime skip status.

Current evidence:

- 2026-05-21: Deterministic simulation and mock benchmark reports now include `optionalRuntimeSkips` for local model/voice providers that are intentionally `not_configured`. Focused test-harness test/typecheck passed, and `bench:mock` emitted the field in JSON output.
- 2026-05-21: Mock benchmark reports now use `traceQuality.unsafeEventCount` as the authoritative unsafe-event review signal, preventing undercounting when unsafe evidence is summarized rather than enumerated. Focused test-harness benchmark-report test/typecheck passed.
- 2026-05-21: First-sprint mock benchmark smoke after validation hardening emitted a deterministic ED chest-pain run with 20 events, zero missing required trace tags, ready mock providers, and local model/voice optional-runtime skips.
- 2026-05-21: First-sprint mock benchmark smoke remained green after Quest evidence refreshes plus persistence/schema/asset hardening, with 20 events, zero missing required trace tags, ready mock providers, local model/voice optional-runtime skips, and passing adversarial hidden-fact probes.
- 2026-05-21: Leadership benchmark rollup refreshed `.agent-factory/benchmark-gate-report.json`; local mock/evidence gates `evidence-leadership-0008-002`, `0008-003`, and `0008-004` are true, while Quest/manual, stale local runtime/voice/model/asset evidence, IWSDK agent-tooling, and production asset readiness gates remain honestly blocked.
- 2026-05-21: Local runtime probe refreshed `docs/openclinxr/local-runtime-probe-2026-05-21.json`; Quest USB and foreground preflight are ready with the attached Quest 3, asset pipeline is ready, and API Bun/local model/local voice remain blocked pending their own benchmark lanes.
- 2026-05-21: Benchmark rollup refreshed again after the local runtime probe; leadership gate pass/fail posture is unchanged, but the local runtime probe is now fresh for aggregate evidence.
- 2026-05-21: Asset source smokes refreshed and validated: `docs/openclinxr/gltf-pipeline-smoke-2026-05-21.json` and `docs/openclinxr/blender-asset-bake-smoke-2026-05-21.json`.
- 2026-05-21: Asset production evidence ladder artifacts refreshed and validated: `asset-capability-job-evidence`, `asset-production-readiness-benchmark`, `asset-production-evidence-ladder`, and `asset-production-artifact-evidence` for 2026-05-21. These are evidence artifacts only, not production-readiness claims.
- 2026-05-21: Benchmark rollup refreshed after asset evidence updates; production asset readiness remains false by design because refreshed artifacts still record placeholder/fixture limits and missing reviewed production artifact lanes.
- 2026-05-21: Local provider benchmark evidence refreshed and validated at `docs/openclinxr/local-provider-benchmark-2026-05-21.json` without enabling optional local model/voice runtimes or cloud calls.
- 2026-05-21: Local model cache/source evidence refreshed without inference or downloads. `docs/openclinxr/local-model-cache-evidence-2026-05-21.json` and `docs/openclinxr/local-model-source-currentness-2026-05-21.json` were generated; cache validation passed and source-currentness validation compared the latest metadata record against the fresh cache evidence.
- 2026-05-21 realignment: pause further routine evidence refreshes unless tied to a concrete implementation decision. The next Worker 6 contribution should be a product-facing harness improvement, such as making the first-sprint ED chest-pain run easier to consume by faculty/admin/XR flows, rather than another aggregate refresh.

Validation:

- `pnpm --filter @openclinxr/test-harness bench:mock`
- Simulation completes under local-only constraints.
- Output includes station run ID, event count, missing required tags, and provider health.

Done when:

- This harness is the first sprint completion gate.

## Worker 7: API Steward

Owned paths:

- `apps/api`

Endpoints:

- `GET /health`
- `GET /scenarios/ed-chest-pain`
- `POST /sessions`
- `POST /sessions/:id/events`
- `POST /sessions/:id/note`
- `POST /sessions/:id/actor-response`
- `GET /sessions/:id/review-packet`
- `GET /providers/health`

Validation:

- Contract tests run against in-memory repositories.
- No environment variable is required for default tests.
- Provider health returns mock ready and optional runtimes not configured.

Current evidence:

- 2026-05-21: `@openclinxr/rest` route matching now ignores query strings and hash fragments before segment matching. Focused rest test/typecheck passed.
- 2026-05-21: `@openclinxr/rest` session-route URL building now rejects whitespace-only station run IDs before encoding scoped paths. Focused rest test/typecheck passed.
- 2026-05-21: `@openclinxr/api` downstream test/typecheck passed after REST and runtime contract updates.
- 2026-05-21: Persisted admin scenario-review decisions now sort deterministically by reviewed time, scenario ID, version, reviewer role, and reviewer ID so tied timestamps do not replay in storage-return order. Focused `apps/api` app test/typecheck passed.
- 2026-05-21: `POST /sessions` now returns `learner_id_required` for blank learner IDs instead of surfacing a runtime exception, while preserving omitted-learner defaults. Focused `apps/api` test/typecheck passed.
- 2026-05-21: Station lifecycle routes now map invalid domain transition commands to `station_command_invalid` 400 responses instead of generic runtime errors. Focused `apps/api` test/typecheck passed.
- 2026-05-21 realignment: Worker 7 is the first active product-advancement lane with Worker 8. Next API work should help faculty inspect a completed ED station through review-safe endpoints rather than adding another isolated guard unless the guard directly protects that flow.

Done when:

- API can drive the same station lifecycle as the test harness.

## Worker 8: Admin UX Steward

Owned paths:

- `apps/ui-admin`

Screens:

- Scenario bank.
- ED station detail.
- Actor card view.
- Review gate panel.
- Trace replay.
- Faculty review packet.

Validation:

- Storybook stories for review gate and trace replay.
- Playwright smoke loads ED station.
- Review approval cannot bypass missing role.
- Text fits desktop and mobile breakpoints.

Current evidence:

- 2026-05-21: Scenario detail clinical approval now stays disabled when governance lacks a clinical reviewer role, shows a governance warning, and does not submit the approval mutation. Focused `apps/ui-admin` App test and typecheck passed.
- 2026-05-21: Review replay now surfaces late-behavior tags and safety flag trace events alongside missing required tags so faculty can inspect completed-station concerns without exposing hidden facts. Focused `apps/ui-admin` App test and typecheck passed.
- 2026-05-21: Admin cards, metrics, rows, compact lists, and station-run input now wrap long clinical IDs/tags inside desktop and mobile grids. Focused `apps/ui-admin` production build passed.
- 2026-05-21: Review Replay now requests review-packet `unsafeEvents` and merges them with raw trace-derived safety labels, preserving faculty safety flags when raw trace events are unavailable. Focused graphql and ui-admin test/typecheck passed.
- 2026-05-21 realignment: Worker 8 should pair with Worker 7 on completed-station faculty review usability before more routine UI hardening. The next UI slice should expose missing review-safe completed-station evidence, improve decision posture, or make the existing replay flow more faculty-actionable.
- 2026-05-21: Review Replay now includes a faculty review posture panel that turns review-safe completed-station evidence into an actionable changes-requested/readiness summary across missing required tags, safety flags, late behaviors, patient-note availability, and provider evidence posture. Focused `@openclinxr/ui-admin` test/typecheck passed.
- 2026-05-21: The admin "Create seed replay" path now records ECG request, urgent escalation, team communication, and a patient note before opening the replay, making the local completed-station faculty workflow more representative. Focused `@openclinxr/ui-admin` test/typecheck passed.

Done when:

- Faculty can inspect a completed station and see missing required behaviors.

## Worker 9: XR Runtime Steward

Owned paths:

- `apps/ui-xr`

Runtime elements:

- Desktop fallback.
- Feature-detected XR entry.
- Doorway instructions.
- Encounter timer.
- Placeholder ED room.
- Patient, spouse, nurse actor slots.
- Simulated EHR/note panel.
- Mock dialogue feed.
- Trace controls.
- IWSDK sidecar evidence/tooling consideration before XR input, locomotion, spatial UI, or browser-evidence slices.

Validation:

- Browser smoke loads desktop runtime.
- WebGL canvas is nonblank.
- Browser screenshot evidence is captured with route, viewport, scenario ID, XR mode, camera pose if available, and artifact path.
- Adversarial visual review records whether the ED room, actors, equipment, simulated EHR/note surfaces, text, controls, scale, occlusion, and clinical safety cues match the intended scenario.
- Latest manual Quest visual posture: Full VR was manually entered, text was readable, primitive box-style hands were visible but non-realistic, comfort was good, trace interaction did not pass, `framesObserved` and `sampleWindowSize` were 0, and no locomotion event was observed; Patrick later reported a smooth in-headset demo with locomotion still absent. The hand-tracking locomotion path now uses thumb-tip/index-tip joint-distance pinch inference instead of a non-standard `hand.inputState.pinching` flag, and the copied Quest Evidence payload now includes `captureSummary.locomotionProbeSummary` reason codes. The next worn-headset validation should explicitly retry hand-pinch dolly/turn while still capturing frame, trace, locomotion, latency evidence, and the movement probe reason if locomotion remains blocked.
- Core UI text does not overlap at desktop and mobile widths.
- XR feature detection does not throw when WebXR is unavailable.
- Quest 3 USB-C smoke loads the local Vite app through Quest Browser port forwarding after `adb devices -l` reports the headset as `device`.
- DevTools screencasting is disabled during comfort observations.

Current evidence:

- 2026-05-21: IWSDK was not used in the immediate live Quest/CDP smoke attempt because the slice was physical-device USB authorization, Quest Browser foreground/CDP exposure, and manual readiness gate evidence. Future Worker 9 XR slices must explicitly consider the approved IWSDK sidecar for supporting input, locomotion, spatial UI, emulation, or agent-debugging evidence, while keeping physical Quest proof as the readiness source.
- 2026-05-21: Quest attached USB preflight is resolved for local CDP shell evidence. After in-headset USB debugging approval, `adb devices -l` reported `Quest_3 device`, Quest Browser exposed CDP on `127.0.0.1:9222`, and the local XR server on port `5173` was reachable.
- 2026-05-21: Foreground Quest CDP shell evidence was refreshed. The first authorized smoke wrote `docs/openclinxr/quest-cdp-smoke-foreground-2026-05-21.json` but stayed blocked by a dirty-browser WebGL context failure and frame-sample timeout. A clean Quest Browser restart produced `docs/openclinxr/quest-cdp-smoke-foreground-clean-2026-05-21.json`, and validation wrote `.agent-factory/quest-cdp-smoke-foreground-clean-2026-05-21-check.json` with `classification=foreground_ready`, shell loaded, trace advanced, visible page, complete frame sample, and required text/input/frame-quality telemetry present. This is not Quest readiness: `immersiveFramesObserved=0`, `isPresenting=false`, about `33.3` FPS, and `p95FrameMs=41.7`.
- 2026-05-21: Clean CDP Full VR activation succeeded for supporting evidence. `docs/openclinxr/quest-cdp-smoke-enter-vr-clean-2026-05-21.json` validated through `.agent-factory/quest-cdp-smoke-enter-vr-clean-2026-05-21-check.json` with `classification=foreground_ready`, `immersiveEntryOutcome=session_started`, `isPresenting=true`, and `immersiveFramesObserved=74` in the short frame sample. This is still below manual readiness requirements because it lacks operator audit fields, trace headset input, locomotion, controller/hand-select latency, comfort, battery, and the required long immersive-frame window.
- 2026-05-21: CDP-assisted manual harvest diagnostic reached long-frame thresholds but remained blocked as readiness evidence. `docs/openclinxr/quest-cdp-manual-harvest-diagnostic-2026-05-21.json` has text metadata, fresh frame stats, `immersiveFramesObserved=7913`, and `sampleWindowSize=180`; `.agent-factory/quest-cdp-manual-harvest-diagnostic-2026-05-21-check.json` reports `readyToClaimFramePacing=false` because headset select trace latency, locomotion delta, gamepad/hand-joint evidence, 10-minute operator observation, comfort, heat, battery, and audit fields are still missing.
- 2026-05-21: IWSDK sidecar consideration for the Worker 9 shell-evidence slice is recorded. IWSDK was not injected into `apps/ui-xr` because physical Quest Browser evidence was the source of truth, but `@openclinxr/iwsdk-spike` test/typecheck passed as supporting sidecar health evidence.
- 2026-05-21: IWSDK aggregate evidence gate was rechecked and failed closed as expected. `pnpm iwsdk:evidence` still reports the sidecar as phase-1 install-backed and sidecar-install ready, but not ready for agent tooling or production runtime because Phase 2 devtools have a Vite peer mismatch, adapter sync/MCP smoke evidence is not recorded, scene/ECS tooling is not queryable, bundle/metric thresholds are not met, and controller-select latency is missing.
- 2026-05-21: Local Quest evidence validation stayed honestly blocked: `pnpm xr:quest:smoke:validate -- --output .agent-factory/quest-cdp-smoke-check.json` reported `classification=blocked`, and `pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-2026-05-04.json --output .agent-factory/quest-manual-performance-check-current.json` reported `readyToClaimFramePacing=false`.
- 2026-05-21: XR trace readiness now counts only required trace tags, ignoring duplicate completed tags and unmapped runtime probes so completion status cannot be overstated. Focused `apps/ui-xr` runtime-state test/typecheck passed.
- 2026-05-21: XR station clock now clamps negative or non-finite elapsed seconds to `00:00`, preventing malformed timer text in desktop fallback or headset evidence. Focused `apps/ui-xr` runtime-state test/typecheck passed.
- 2026-05-21: Desktop fallback status text, runtime-panel copy, and trace buttons now wrap long labels/IDs on narrow viewports, with a static CSS guard. Focused `apps/ui-xr` static-assets test and production build passed.
- 2026-05-21: XR trace-readiness summaries now deduplicate repeated required trace tags before counting observed and missing behavior, matching domain trace-evaluation semantics. Focused `apps/ui-xr` runtime-state test/typecheck passed.
- 2026-05-21: XR hand-select trace instrumentation now exports hand-select status, dwell time, fired count, and blocker reason into copied Quest `captureSummary`, and the live Quest Evidence trace row mirrors those fields. IWSDK was considered but not used because this was production runtime instrumentation rather than sidecar scene/emulation evidence. Focused `@openclinxr/ui-xr` test/typecheck passed.

Done when:

- A learner can complete the station in desktop fallback with mock interactions, and the Quest 3 manual smoke checklist is either passed or recorded as blocked with a concrete reason.

Optional isolated spike:

- `packages/openclinxr/iwsdk-spike` now contains the source-backed planning contract for Meta Immersive Web SDK package posture, adoption gates, and Codex-oriented agent verification. It is intentionally dependency-free.
- `apps/ui-xr-iwsdk-spike` now evaluates Meta Immersive Web SDK Phase 1 for controller input, scene parity, package weight, and browser smoke evidence.
- IWER/MCP/browser screenshots and videos can support adversarial visual QA, but their evidence must be labeled as emulation or managed-browser evidence and cannot replace physical Quest foreground observations. Patrick's latest manual Quest report is the current human observation baseline, not a production readiness pass.
- Phase 2 IWSDK devtools are now approved for sidecar-only use when useful; keep `@iwsdk/reference`, `@meta-quest/hzdb`, optimizer packages, and production adoption gated separately.
- Before any install-backed sidecar change, run the proposed dependencies through the planning package's pre-install policy. The first slice allows only exact-versioned `@iwsdk/core` and `@iwsdk/xr-input`; `@iwsdk/vite-plugin-dev` requires the explicit `--approved-phase2-devtools` gate; `@iwsdk/locomotor` and `@iwsdk/vite-plugin-gltf-optimizer` still require extra review and are not unattended-ready; `@iwsdk/reference`, production use of `@meta-quest/hzdb`, blocked copyleft/unknown license expressions, and any native `@img/sharp-libvips-*` transitive variant remain blockers.
- IWSDK agent-tooling readiness now requires more than a smoke sequence: record `iwsdk adapter sync`, the 32-tool MCP inventory, exact observed tool names, category coverage for session/transforms/input mode/select trigger/gamepad/device state/browser/scene/ECS, scored browser-mode evidence from `pnpm iwsdk:browser:evidence`, and optional MCP server policy for `iwsdk-reference` and `hzdb`; use `evaluateIwsdkAgentToolingEvidence()` as the aggregate gate before claiming the sidecar agent lane is ready.
- The planning package now exposes machine-readable metric thresholds: max 300 MB installed footprint, max 1200 KB IWSDK injected dev runtime, max 550 KB spike app JS bundle, max 100 KB bundle delta versus `apps/ui-xr`, zero console errors, at least 72 FPS, p95 frame time at or below 25 ms, and controller-select latency at or below 150 ms.
- Keep IWSDK out of `apps/ui-xr` and shared production packages until the local scratch blockers are resolved: Vite 8 peer mismatch, explicit Node 22 execution path, Rolldown native binding setup, install/runtime weight, physical Quest 3 behavior, Phase 2 devtool dependency review, native `@img/sharp-libvips-*` LGPL path, and full transitive license evidence.
- Do not add IWSDK commands to `pnpm verify`, install hooks, or default dev startup until the spike has a committed source record and legal/license review path.

Validation:

- `pnpm iwsdk:preinstall`
- `pnpm iwsdk:browser:evidence -- --input path/to/iwsdk-browser-evidence.json`
- `pnpm iwsdk:compatibility:evidence -- --input path/to/iwsdk-compatibility-evidence.json`
- `pnpm iwsdk:metadata-drift:evidence -- --input path/to/iwsdk-metadata-drift-evidence.json`
- `pnpm iwsdk:evidence`
- `pnpm iwsdk:verify`
- `pnpm --filter @openclinxr/iwsdk-spike test`
- `pnpm --filter @openclinxr/iwsdk-spike typecheck`
- `pnpm --filter @openclinxr/architecture-rules test`
- `pnpm --filter @openclinxr/architecture-rules typecheck`
- `pnpm agent:sources`
- A committed spike report comparable to `docs/openclinxr/immersive-web-sdk-evaluation-2026-05-04.md`

## Worker 10: Provider Gateway Steward

Owned paths:

- `packages/openclinxr/model-gateway`
- `packages/openclinxr/voice-gateway`

Tasks:

- Add `MockModelProvider`.
- Add `MockVoiceProvider`.
- Add provider health contracts.
- Add provider audit records.
- Add local adapter stubs for MLX/llama.cpp/Ollama and VibeVoice.

Validation:

- Mock responses are deterministic.
- Local adapters return `not_configured` until explicitly enabled.
- Audit records include provider ID, model/runtime name, request ID, latency, and safety status.

Current evidence:

- 2026-05-21: `@openclinxr/model-gateway` and `@openclinxr/voice-gateway` mock provenance now carries explicit request IDs, provider/model identity, model runtime name, latency, and safety status while preserving deterministic local-only mock behavior. Focused verification passed for both packages' test and typecheck scripts.
- 2026-05-21: Named local stubs now exist for MLX, llama.cpp, Ollama, and VibeVoice. Each reports `not_configured` by default and remains local-only until a future approved runtime-configuration slice enables it. Focused verification passed for both gateway packages' test and typecheck scripts.
- 2026-05-21: `@openclinxr/shared-schemas` now provides `ProviderAuditRecordSchema` plus a validator, and both model/voice provenance types use the shared audit-record contract. Focused verification passed for shared schemas and both gateway packages' test/typecheck scripts.
- 2026-05-21: `@openclinxr/model-gateway` now validates provider health before selecting a ready adapter, skipping contradictory `ready` records that still carry blockers. Focused model-gateway test/typecheck passed.
- 2026-05-21: `@openclinxr/voice-gateway` now validates provider health before selecting transcription or synthesis adapters, skipping contradictory `ready` records that still carry blockers. Focused voice-gateway test/typecheck passed.
- 2026-05-21: `@openclinxr/model-gateway` now falls back to deterministic station/actor/turn request IDs when a caller supplies a blank model request ID. Focused model-gateway test/typecheck passed.
- 2026-05-21: `@openclinxr/voice-gateway` now falls back to deterministic transcription/synthesis request IDs when a caller supplies a blank voice request ID. Focused voice-gateway test/typecheck passed.
- 2026-05-21: Local model and voice adapter health checks now return fresh blocker arrays so caller-side mutation cannot alter subsequent optional-runtime health posture. Focused model-gateway and voice-gateway test/typecheck passed.

Done when:

- Switching provider implementation does not change domain contracts.

## Worker 11: Asset Registry Steward

Owned paths:

- `packages/openclinxr/asset-registry`

Tasks:

- Add asset manifest schema consumption.
- Add ED room, bed, monitor, ECG, IV stand, patient, spouse, nurse placeholder records.
- Add license/provenance status.
- Add optimization target fields.
- Add Quest QA status.

Current evidence:

- 2026-05-21: Asset manifests carry explicit Quest QA status. Manifest evaluation now blocks missing license status, missing optimization targets, missing Quest QA status, and placeholder records without explicit placeholder/simulation QA posture. Focused `@openclinxr/asset-registry` test/typecheck passed.
- 2026-05-21: ED chest pain placeholder inventory now includes patient, spouse, nurse, ED room, stretcher bed, bedside monitor, ECG cart, and IV stand records. The extra planning records do not change the scenario's required runtime `assetNeeds`, and placeholder records remain production-blocked. Focused `@openclinxr/asset-registry` test/typecheck passed.
- 2026-05-21: `@openclinxr/shared-schemas` now exposes `AssetManifestSchema` and validation, and `@openclinxr/asset-registry` rejects structurally invalid manifests before upsert. Focused shared-schemas and asset-registry test/typecheck passed.
- 2026-05-21: Shared asset-manifest validation now rejects whitespace-only asset identity, provenance source refs, Quest QA limitations, pipeline stage notes, tags, generation-evidence IDs, and optimization-evidence IDs/LOD tiers. Focused shared-schemas and asset-registry test/typecheck passed.
- 2026-05-21: `InMemoryAssetRegistry.listByScenario` now returns scenario assets sorted by `assetId`, avoiding insertion-order-dependent planning output. Focused asset-registry test/typecheck passed.
- 2026-05-21: `InMemoryAssetRegistry` now clones manifests on upsert, get, and scenario listing so caller mutation cannot alter stored readiness inputs after validation. Focused asset-registry test/typecheck passed.
- 2026-05-21: `InMemoryAssetRegistry.evaluateScenarioReadiness` now deduplicates repeated scenario asset IDs before readiness and station-budget evaluation, avoiding duplicate blockers or budget double-counting from repeated config entries. Focused asset-registry test/typecheck passed.
- 2026-05-21: Asset readiness diagnostics now report missing provenance/license posture as blockers instead of throwing when directly evaluating malformed planning input; registry upsert continues to reject structurally invalid manifests. Focused asset-registry test/typecheck passed.
- 2026-05-21: Asset generation-evidence scoring now requires at least one nonblank source ref before counting approved non-placeholder manifests as production-source evidence. Focused asset-registry test/typecheck passed.
- 2026-05-21: Asset readiness now production-blocks non-placeholder local fixture assets when Quest QA limitations explicitly disclaim production clinical-realism approval. `patient_robert_hayes_character` remains dev-ready with local generation/optimization evidence but not production-ready. Focused `@openclinxr/asset-registry` test/typecheck passed.

Validation:

- Missing license fails validation.
- Missing optimization target fails simulation QA.
- Placeholder assets are allowed only with explicit QA status.

Done when:

- Asset production can start from a validated manifest rather than free-form notes.

## Worker 12: MongoDB Steward

Owned paths:

- `packages/openclinxr/data-mongodb`

Tasks:

- Define repository interfaces shared with in-memory API.
- Add collection names and indexes.
- Add repository contract tests.
- Add `mongodb-memory-server` local tests.
- Use `MongoMemoryServer` for CRUD/index contract tests.
- Use `MongoMemoryReplSet` for transaction-sensitive repository tests.
- Gate production-URI tests behind `OPENCLINXR_MONGO_URI`.
- Print whether Mongo memory tests ran, skipped due missing binary, or used a cached binary.

Current evidence:

- 2026-05-21: `MongoTraceRepository` clones trace events before insert/upsert so Mongo driver metadata cannot mutate caller-owned trace objects. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo trace persistence now validates trace events with the shared trace-event validator before append or replay upsert, preventing whitespace-only identity records from being stored. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo API persistence sink now rejects trace-event batches containing events whose `stationRunId` differs from the sink path station run, preventing cross-run trace writes. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo review packets now declare an index on `facultyScoreDraft.status` plus `scenarioId`, covering review-status query posture. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo review-packet persistence now validates packets with the shared review-packet validator before upsert, preventing inconsistent trace-quality or identity records from being stored. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo API persistence sink now rejects review packets whose packet `stationRunId` differs from the sink path station run, preventing cross-run review packet writes. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo scenarios now declare an index on `governance.sourceIds` plus `status`, covering source-ID query posture. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo scenario persistence now validates scenarios with the shared scenario validator before upsert, preventing invalid review-gate/governance records from being stored. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo scenario-review decisions now replay deterministically by reviewed time, scenario ID, version, reviewer role, and reviewer ID, matching API startup reconstruction ordering for tied timestamps. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Mongo scenario-review decision persistence now rejects blank scenario/reviewer identities, blank reviewed timestamps, and missing or blank evidence refs before upsert. Focused data-mongodb test/typecheck passed.
- 2026-05-21: API persistence-sink integration remained green after Mongo repository validation hardening. Focused data-mongodb integration test passed.
- 2026-05-21: API persistence-sink integration remained green after station-scope guards for trace and review-packet writes. Focused data-mongodb integration test passed.
- 2026-05-21: Mongo durable clinical-event handoff now deep-clones nested private payload fields before persistence, aligning with session-state private-payload immutability. Focused data-mongodb test/typecheck passed.
- 2026-05-21: Durable clinical-event records now reject blank identity fields, blank optional routing/status fields, unknown event kinds, and non-finite/negative `atSecond` before session-state persistence, Mongo upsert, or review projection. Focused session-state and data-mongodb test/typecheck passed.
- 2026-05-21: Mongo durable conversation turns and emotional-state timeline records now reject blank identity/content fields, blank trace/provenance refs, unknown conversation source kind, raw-audio persistence, and non-finite/negative `atSecond` before upsert. Focused data-mongodb test/typecheck passed.
- 2026-05-21: The Phase 2 persistence note now records the durable-record semantic guards for clinical events, conversation turns, and emotional-state timelines.

Validation:

- In-memory repository contracts pass by default.
- Mongo memory repository contracts pass after the binary is available.
- Tests skip cleanly without production Mongo URI.
- Production repository contracts pass when `OPENCLINXR_MONGO_URI` is provided.
- Index declarations cover scenario version, station run trace sequence, review status, and source IDs.

Done when:

- MongoDB can replace in-memory repositories without API contract changes, with local Mongo behavior covered by `mongodb-memory-server`.

## First Sprint Completion Command

Target command after implementation:

```bash
pnpm verify && pnpm --filter @openclinxr/test-harness bench:mock
```

Expected evidence:

- Typecheck passes.
- Unit and contract tests pass.
- Deterministic station simulation produces a review packet.
- Mongo memory tests pass or report a clear first-run binary/cache skip.
- Optional local model, voice, Bun, and Quest gates are reported as skipped, not configured, blocked, or passed.

## Development Stop Conditions

- A live API key becomes required for tests.
- A model download becomes required for startup.
- Review packet can be generated without trace evidence.
- Scenario can be approved without required reviewer roles.
- UI says or implies licensure, diagnosis, ECFMG replacement, or validated high-stakes scoring.
- XR app renders a blank canvas or inaccessible controls.
- Asset manifest accepts missing license or provenance.



## Historical Validation Ledger Compacted On 2026-05-27

The detailed chronological validation matrix that previously followed this point was compacted during the OpenClaw documentation realignment. Source control preserves the full pre-compaction history in cleanup checkpoints including `c30995c`, `9285713`, `3ee468e`, and `46c6210`.

Durable worker guidance remains above this section: global rules, agent-factory alignment, active product advancement order, worker ownership lanes, first-sprint completion command, and development stop conditions.

Current protected cleanup/coordination entries:

| Date | Lane | Status | Evidence | Next |
| --- | --- | --- | --- | --- |
| 2026-05-27 | Codex/OpenClaw alignment cleanup | Implemented | `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md`; `PROJECT_COORDINATION_INDEX.md`; `AGENTS.md`; focused alignment check `pnpm agent:alignment` | Continue repo-native OpenClaw execution; do not create scattered one-off status artifacts. |
| 2026-05-27 | Blueprint-factory drift guardrails | Implemented protected policy | `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` linked from `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, and `AUTONOMOUS_WORK_PLAN.md`; `tools/agent-factory/check-coordination-alignment.ts` fails if guardrails are missing or unlinked | Future slices must pass the blueprint-to-runtime/conversation-tooling slice gate before asset or screenshot work continues. |
| 2026-05-27 | Documentation authority registry | Implemented | `pnpm docs:authority` generated `docs/openclinxr/doc-authority-registry-2026-05-27.md`/`.json`; `pnpm agent:alignment` checks 10 files | Use the registry before treating old plans, syntheses, proposals, evidence, temporary notes, or handoffs as active instructions. |
| 2026-05-27 | Markdown cleanup | In progress | Removed stale temporary/handoff docs and scratchpads after source-control checkpoints; compacted oversized historical ledgers in `AUTONOMOUS_WORK_PLAN.md` and this file | Continue classifying archive candidates before deletion; do not delete templates, protected policy, current references, proposals, or evidence records without explicit classification. |

Historical ledger usage rule:

- Treat pre-compaction validation details as history available through git, not as active execution instructions.
- Use current worker definitions above plus `PROJECT_COORDINATION_INDEX.md` for execution selection.
- Record new durable validation outcomes only when they materially change worker guidance, product readiness posture, or protected coordination policy.
- Prefer concise rows over long running journals; detailed evidence belongs in purpose-built reports under `docs/openclinxr/`.

| 2026-05-28 | Worker 9 / Worker 11 pediatric runtime-proof slice | Implemented blueprint-driven runtime evidence and ED fallback suppression | UI-XR now surfaces active bundle station context, actor roster, equipment IDs, dialogue trace tags, room props, and scenario match/mismatch evidence; asset-registry omitted scene manifests now generate scenario/station-keyed manifests instead of silently using ED Chest Pain defaults | Verification passed: `pnpm exec biome check apps/ui-xr/src/main.ts apps/ui-xr/src/runtime-state.ts apps/ui-xr/src/static-assets.test.ts packages/openclinxr/asset-registry/src/runtime-bundles.ts packages/openclinxr/asset-registry/src/runtime-bundles.test.ts`; `pnpm exec vitest run apps/ui-xr/src/runtime-state.test.ts apps/ui-xr/src/static-assets.test.ts packages/openclinxr/asset-registry/src/runtime-bundles.test.ts` (3 files, 81 tests). Next: harden generated-station materialization contracts for shared neutral humanoid/equipment reuse. |
