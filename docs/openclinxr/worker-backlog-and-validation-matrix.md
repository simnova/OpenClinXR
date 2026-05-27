# Worker Backlog And Validation Matrix

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

### 2026-05-21 autonomous validation update - Worker 4 full dialogue seed coverage
- Worker 4 scenario-bank dialogue seed coverage is complete for all twelve canonical stations.
- Current evidence: `scenarioDialogueSeedBank` includes deterministic multi-actor dialogue seeds, visible/hidden fact checks, expected trace tags, and hidden-truth guardrail probes for every scenario in `scenarioBank`.
- Validation passed: `pnpm --filter @openclinxr/scenario-fixtures test` and `pnpm --filter @openclinxr/scenario-fixtures typecheck`.
- Follow-on lane: wire this completed seed bank into downstream station evaluation, review, or model-gateway scoring so the expanded case bank advances product behavior rather than remaining documentation-only.

### 2026-05-21 autonomous validation update - Worker 4/10 dialogue seed replay evidence
- Worker 4 scenario dialogue seeds now feed Worker 10 model-gateway replay evidence instead of remaining static fixtures.
- Current evidence: `buildActorResponseRequestsForDialogueSeeds` maps each scenario seed to an auditable actor-response request; model-gateway tests replay all 48 seeds through the offline mock provider and verify trace tags, hidden-truth blocking, provenance, and hidden-fact canary non-disclosure.
- Validation passed: `pnpm --filter @openclinxr/model-gateway test` and `pnpm --filter @openclinxr/model-gateway typecheck`.
- Follow-on lane: expose replay counts/guardrail pass rates in benchmark or review evidence for higher-level coordination dashboards.

### 2026-05-21 autonomous validation update - Worker 5/10 benchmark dialogue replay evidence
- Worker 5/10 replay evidence now includes full-bank dialogue seed replay in the unattended benchmark harness.
- Current evidence: `runDialogueSeedReplayEvidence` executes all 48 dialogue seeds across 12 scenarios through the offline mock model path; `buildMockBenchmarkReport` exposes pass/fail counts for guardrail blocking, hidden-fact leakage, and trace-tag mismatches.
- Validation passed: `pnpm --filter @openclinxr/test-harness test` and `pnpm --filter @openclinxr/test-harness typecheck`.
- Follow-on lane: expose the benchmark dialogue replay summary in admin/review readiness surfaces or make it part of scenario activation gating.

### 2026-05-21 autonomous validation update - Worker 4/5 activation gate for replayable dialogue seeds
- Worker 4 dialogue seed coverage now participates in Worker 5 learner-launch readiness gates.
- Current evidence: `evaluateBlueprintScenarioReadiness` and `createExamStationRunQueue` block otherwise-approved scenarios when replayable dialogue/guardrail seeds are missing or misaligned; ED seed remains activation-ready, while missing-seed approved scenarios become governance-blocked.
- Validation passed: `pnpm --filter @openclinxr/exam-assembly test` and `pnpm --filter @openclinxr/exam-assembly typecheck`.
- Follow-on lane: expose dialogue-seed readiness blockers in admin readiness/review surfaces and API docs.

### 2026-05-21 autonomous validation update - Worker 7/8 admin visibility for dialogue replay blockers
- Worker 7/8 admin review surfaces now expose dialogue replay readiness blockers in readable operator language.
- Current evidence: seed exam readiness displays draft/governance blocked counts and maps `dialogue_seed_replay_not_ready` to `Dialogue replay seeds not ready` in station queue rows.
- Validation passed: `pnpm --filter @openclinxr/ui-admin test` and `pnpm --filter @openclinxr/ui-admin typecheck`.
- Follow-on lane: make the same readiness signal available through schema/API or scenario detail contracts if downstream clients need structured fields beyond station queue blockers.

### 2026-05-21 autonomous validation update - Worker 4 scenario maturity aligned to dialogue replay gate
- Worker 4 scenario maturity now shares the same replay-ready dialogue seed activation rule as Worker 5 exam assembly.
- Current evidence: `evaluateScenarioBankMaturity` blocks otherwise-approved scenarios with `dialogue_seed_not_ready` when replayable dialogue/guardrail seeds are missing or misaligned.
- Validation passed: `pnpm --filter @openclinxr/scenario-fixtures test` and `pnpm --filter @openclinxr/scenario-fixtures typecheck`.
- Follow-on lane: structured API/admin visibility if downstream operator workflows need more than station queue blocker strings.

### 2026-05-21 autonomous validation update - Worker 9 structured XR locomotion/hand-select posture
- Worker 9 XR runtime posture now exposes locomotion and hand-select fields in structured Quest evidence lane details.
- Current evidence: runtime posture includes active locomotion source, last movement timestamp, movement distance, turn radians, hand-select status, dwell, fired count, and blocker reason without changing readiness claims.
- Validation passed: `pnpm --filter @openclinxr/ui-xr test` and `pnpm --filter @openclinxr/ui-xr typecheck`.
- Follow-on lane: use these structured fields from scripts or review surfaces when checking Quest evidence; do not refresh hardware evidence just to restate existing blockers.

### 2026-05-21 autonomous validation update - Worker 11 asset pipeline source-ref hardening
- Worker 11 asset pipeline evidence now rejects blank/whitespace source references at the tool-readiness layer.
- Current evidence: `evaluateAssetPipelineTool` requires at least one nonblank source ref; recommended tool contracts verify nonblank source refs, output evidence requirements, and prohibited uses.
- Validation passed: `pnpm --filter @openclinxr/asset-registry test` and `pnpm --filter @openclinxr/asset-registry typecheck`.
- Follow-on lane: persist or expose asset/readiness blockers only where it helps operators choose concrete asset-production next steps.

### 2026-05-21 autonomous validation update - Worker 5/12 in-memory durable actor-turn identity guard
- Worker 5/12 durable actor-turn replay safety now applies to the in-memory session-state store as well as Mongo persistence.
- Current evidence: malformed conversation-turn and emotional-state timeline records are rejected before in-memory persistence, including blank identities, blank evidence refs, raw-audio persistence, invalid source/routing values, invalid store posture, and non-finite/negative timestamps.
- Validation passed: `pnpm --filter @openclinxr/session-state test` and `pnpm --filter @openclinxr/session-state typecheck`.
- Follow-on lane: use the same guard standard for any future API-facing actor-turn ingest before adding runtime wiring.

### 2026-05-21 autonomous validation update - Worker 10 provider health gate alignment
- Worker 10 capability routing now shares the validated provider-health gate used by model and voice gateways.
- Current evidence: `RuntimeCapabilityFacade` skips providers whose health is contradictory, such as `status=ready` with blockers, before selecting an adapter for execution.
- Validation passed: `pnpm --filter @openclinxr/capability-gateway test` and `pnpm --filter @openclinxr/capability-gateway typecheck`.

### 2026-05-21 active queue completion checkpoint
- Current approved active queue lanes have completed verified product slices: review/admin, XR instrumentation, scenario dialogue-bank expansion, asset evidence hardening, replay/persistence hardening, and provider-gate alignment.
- Next worker should not refresh Quest/model/asset evidence unless it unlocks a new product slice or verifies newly touched code.

## 2026-05-21 Agent-led active worker lane reset

Repo-defined agent lenses were applied to prevent Iteration 9 from drifting into repeated evidence review. The active queue is now product-path first, evidence-refresh second.

Active lane order:

1. Worker 7/8: completed-station faculty/admin review path for ED chest-pain station timeline, missing behaviors, unsafe/late signals, note evidence, reviewer posture, and formative-only score-use language.
2. Worker 4/2: multi-station scenario-bank expansion beyond the first deterministic station with actors, environments, equipment, rubrics, trace tags, communication profiles, and asset needs.
3. Worker 5/12: replayable station evidence and persistence/review safety for traces, actor turns, emotional-state timelines, review packets, and approved clinical events.
4. Worker 11: asset production readiness ladder for one named clinical artifact in `packages/openclinxr/asset-registry`, covering provenance, license, optimization target, Quest QA status, visual critique, and production blockers.
5. Worker 9: XR runtime readiness surface using Quest/WebXR/IWSDK evidence only where it informs product decisions; no IWSDK primary-runtime promotion before phase-2 review.
6. Provider gateway lanes: deterministic model/voice/provider replay readiness in product surfaces, with local model and voice runtimes gated/non-default until reliability, consent/disclosure, misuse, and target-hardware evidence improve.

Validation posture:

- Run focused verification only for touched packages/apps.
- Run `pnpm agent:alignment` after coordination/doc changes.
- Do not rerun Quest, IWSDK, model, voice, asset, benchmark, or cache evidence unless it unlocks a named lane above or verifies changed code.

Stop posture:

- Checkpoints are not stop conditions.
- Stop only for credentials, paid/cloud/API use, hardware action, destructive operation, production deployment, explicit operator pause, or scope outside approved boundaries.

### 2026-05-21 Worker 7/8 slice result: assessment-use boundary

Status: complete.

Product advancement: the admin Review Replay workbench now includes an Assessment Use Boundary for completed-station faculty review. This keeps faculty score drafts framed as local formative practice and debrief preparation until approved score-use evidence is complete.

Touched files:

- `apps/ui-admin/src/App.tsx`
- `apps/ui-admin/src/App.test.tsx`

Verification:

- `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
- `pnpm --filter @openclinxr/ui-admin typecheck` passed.

Next Worker 7/8 slice: add a compact review action/disposition surface if it can be derived from existing ReviewPacketReplay fields without API/runtime widening; otherwise proceed to Worker 4/2 scenario-bank expansion.

### 2026-05-21 Worker 7/8 slice result: faculty action checklist

Status: complete.

Product advancement: the admin Review Replay workbench now includes a Faculty Action Checklist derived from existing ReviewPacketReplay fields. Faculty/admin users can see concrete next actions for missing behaviors, unsafe flags, late time-critical behaviors, and patient-note use.

Touched files:

- `apps/ui-admin/src/App.tsx`
- `apps/ui-admin/src/App.test.tsx`

Verification:

- `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
- `pnpm --filter @openclinxr/ui-admin typecheck` passed.

Next lane: Worker 4/2 scenario-bank expansion beyond the first deterministic station, with learner launch claims kept blocked until governance/replay/readiness gates are satisfied.

### 2026-05-21 Worker 4/2 slice result: pediatric communication profiles

Status: complete.

Product advancement: pediatric asthma now has schema-valid communication profiles for patient, parent, and nurse actors. The scenario bank therefore has behavior-model depth beyond the first deterministic ED chest-pain station while remaining blocked from learner launch until review/readiness gates are satisfied.

Touched files:

- `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
- `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`

Verification:

- `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
- `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.

Next lane slice: expose actor communication-profile coverage in the scenario-bank maturity report, then continue expanding draft station depth one station at a time.

### 2026-05-21 Worker 4/2 slice result: communication-profile maturity coverage

Status: complete.

Product advancement: scenario-bank maturity now reports communication-profile coverage, including complete scenario IDs, actor IDs missing profiles, and actor profile counts. This keeps station-depth expansion visible for the top-level coordinator and future agents.

Touched files:

- `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
- `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`

Verification:

- `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
- `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.

Next lane: Worker 5/12 replayable station evidence and persistence/review safety.

### 2026-05-21 Worker 5/12 slice result: durable clinical-event review summary

Status: complete.

Product advancement: durable clinical-event review projections now include a summary helper for faculty/admin replay use. The summary reports event counts, redaction counts, event-kind counts, trace tags, status counts, latest event time, durable-store posture, and safe-for-faculty-review posture without exposing private payload data.

Touched files:

- `packages/openclinxr/session-state/src/index.ts`
- `packages/openclinxr/session-state/src/session-state.test.ts`

Verification:

- `pnpm --filter @openclinxr/session-state test -- session-state.test.ts` passed.
- `pnpm --filter @openclinxr/session-state typecheck` passed.

Next lane: Worker 11 asset production readiness ladder for one named clinical artifact.

### 2026-05-21 Worker 11 slice result: asset production readiness ladder

Status: complete.

Product advancement: asset-registry now exposes `evaluateAssetProductionReadinessLadder` for a named clinical artifact. The ladder shows evidence and blockers for provenance/license, generation evidence, optimization evidence, Quest QA, visual clinical critique, and production release. The local ED patient fixture remains explicitly blocked from production readiness.

Touched files:

- `packages/openclinxr/asset-registry/src/index.ts`
- `packages/openclinxr/asset-registry/src/asset-registry.test.ts`

Verification:

- `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
- `pnpm --filter @openclinxr/asset-registry typecheck` passed.

Next lane: Worker 9 XR/runtime readiness or provider/runtime readiness, product-surface only and no evidence refresh.

### 2026-05-21 Provider/runtime slice result: readiness surface

Status: complete.

Product advancement: capability-gateway now exposes a runtime provider readiness surface that distinguishes deterministic replay readiness from live interactive provider readiness. Local-development mocks remain useful for replay and tests, while local-production Qwen/DeepSeek/VibeVoice-style paths remain visible as not-configured until controls and benchmarks improve.

Touched files:

- `packages/openclinxr/capability-gateway/src/index.ts`
- `packages/openclinxr/capability-gateway/src/capability-gateway.test.ts`

Verification:

- `pnpm --filter @openclinxr/capability-gateway test -- capability-gateway.test.ts` passed.
- `pnpm --filter @openclinxr/capability-gateway typecheck` passed.

Next lane: Worker 9 XR/runtime readiness surface with existing structured evidence only.

## 2026-05-21 Worker 9 slice result: XR runtime readiness decision surface

- Package: `@openclinxr/ui-xr`.
- Touched files:
  - `apps/ui-xr/src/runtime-state.ts`
  - `apps/ui-xr/src/runtime-state.test.ts`
- Product advancement: converted existing runtime posture evidence into an explicit decision object for learner launch readiness.
- Alignment guard: no Quest evidence refresh, no new runtime/provider claims, no cloud/API use, and IWSDK is represented as an evidence gate rather than assumed ready.
- Verification:
  - `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-xr typecheck` passed.


## 2026-05-21 Worker 4/2 slice result: ward delirium communication profiles

- Package: `@openclinxr/scenario-fixtures`.
- Touched files:
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Product advancement: upgraded the ward delirium station from fixture-complete to communication-profile complete across patient, family, nurse, and physician actors.
- Alignment guard: no approval-status promotion, no active-form readiness claim, and no summative-use claim.
- Verification:
  - `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
  - `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.


## 2026-05-21 Worker 4/2 slice result: telehealth diabetes communication profiles

- Package: `@openclinxr/scenario-fixtures`.
- Touched files:
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Product advancement: upgraded the telehealth diabetes station to communication-profile complete across patient, family-support, and platform actors.
- Alignment guard: no approval-status promotion, no score-use claim, and no telehealth runtime claim.
- Verification:
  - `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
  - `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.


## 2026-05-21 Worker 4/2 slice result: OB triage communication profiles

- Package: `@openclinxr/scenario-fixtures`.
- Touched files:
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Product advancement: upgraded the OB headache/preeclampsia station to communication-profile complete across patient, partner, and OB nurse actors.
- Alignment guard: no approval-status promotion, no validated score-use claim, and no obstetric decision-support claim.
- Verification:
  - `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
  - `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.


## 2026-05-21 Worker 4/2 slice result: communication profiles through abdominal interpreter station

- Package: `@openclinxr/scenario-fixtures`.
- Touched files:
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Product advancement: upgraded psychiatric safety, stroke alert, stepdown sepsis, and abdominal-pain/interpreter stations to communication-profile complete.
- Alignment guard: no approval-status promotion, no active-form readiness claim, and no validated-score claim.
- Verification:
  - `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
  - `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.


## 2026-05-21 Worker 4/2 slice result: full scenario-bank communication-profile coverage

- Package: `@openclinxr/scenario-fixtures`.
- Touched files:
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Product advancement: all 12 scenario-bank stations now include schema-valid actor communication profiles, improving multi-actor virtual patient behavior readiness across XR exam scenarios.
- Alignment guard: all newly profiled stations remain draft/formative-only unless separately approved by review workflow gates.
- Verification:
  - `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
  - `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.


## 2026-05-21 Worker 11 slice result: station-level asset production readiness ladder

- Package: `@openclinxr/asset-registry`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Product advancement: station-level asset readiness can now be reviewed as a single ladder across required scenario assets, not only one artifact at a time.
- Alignment guard: local fixture evidence remains blocked from release by Quest production limitations and missing visual/clinical critique.
- Verification:
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.


## 2026-05-21 Worker 7/8 slice result: behavior-profile review visibility

- Packages: `@openclinxr/graphql`, `@openclinxr/ui-admin`.
- Touched files:
  - `packages/openclinxr/graphql/src/schema.graphql`
  - `packages/openclinxr/graphql/src/documents/scenario-bank.graphql`
  - `packages/openclinxr/graphql/src/documents/scenario-detail.graphql`
  - `packages/openclinxr/graphql/src/documents/submit-scenario-review.graphql`
  - `packages/openclinxr/graphql/src/generated/*`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: faculty/admin review surfaces now expose actor behavior-profile coverage and detail without promoting draft scenarios or profile completeness to learner-use readiness.
- Alignment guard: UI copy says behavior profiles support faculty review only; scenario status and score-use gates still control learner use.
- Verification:
  - `pnpm --filter @openclinxr/graphql generate:check` passed.
  - `pnpm --filter @openclinxr/graphql typecheck` passed.
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 4/12 slice result: communication profiles in model-gateway requests

- Package: `@openclinxr/model-gateway`.
- Touched files:
  - `packages/openclinxr/model-gateway/src/index.ts`
  - `packages/openclinxr/model-gateway/src/model-gateway.test.ts`
- Product advancement: completed scenario-bank actor profiles are now available to model-provider request construction for dialogue behavior, not just stored in fixtures/admin surfaces.
- Alignment guard: deterministic mock behavior still avoids hidden facts and does not claim live provider readiness.
- Verification:
  - `pnpm --filter @openclinxr/model-gateway test -- model-gateway.test.ts` passed.
  - `pnpm --filter @openclinxr/model-gateway typecheck` passed.


## 2026-05-21 Worker 4/10/12 slice result: safe actor communication-profile prompt context

- Package: `@openclinxr/model-gateway`.
- Touched files:
  - `packages/openclinxr/model-gateway/src/index.ts`
  - `packages/openclinxr/model-gateway/src/model-gateway.test.ts`
- Product advancement: actor communication profiles now have a safe provider prompt-context projection for future model adapters, without exposing hidden facts or claiming live provider readiness.
- Alignment guard: context includes an explicit hidden-fact boundary and deterministic mock replay remains the only verified provider path.
- Verification:
  - `pnpm --filter @openclinxr/model-gateway test -- model-gateway.test.ts` passed.
  - `pnpm --filter @openclinxr/model-gateway typecheck` passed.


## 2026-05-21 Worker 4/10/12 slice result: live-provider-safe actor response projection

- Package: `@openclinxr/model-gateway`.
- Touched files:
  - `packages/openclinxr/model-gateway/src/index.ts`
  - `packages/openclinxr/model-gateway/src/model-gateway.test.ts`
- Product advancement: future local/live model adapters can use a safe provider prompt projection that excludes hidden-fact canaries while preserving communication-profile guidance.
- Alignment guard: no live provider was enabled; deterministic mock remains the verified path and hidden facts remain excluded from provider-facing prompt input.
- Verification:
  - `pnpm --filter @openclinxr/model-gateway test -- model-gateway.test.ts` passed.
  - `pnpm --filter @openclinxr/model-gateway typecheck` passed.


## 2026-05-21 Worker 5/7/12 slice result: durable clinical-event summary in review replay

- Packages: `@openclinxr/graphql`, `@openclinxr/api`, `@openclinxr/ui-admin`.
- Touched files:
  - `packages/openclinxr/graphql/src/schema.graphql`
  - `packages/openclinxr/graphql/src/documents/review-packet-replay.graphql`
  - `packages/openclinxr/graphql/src/index.ts`
  - `packages/openclinxr/graphql/src/generated/*`
  - `apps/api/src/app.ts`
  - `apps/api/src/app.test.ts`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `apps/ui-admin/src/api-client.test.ts`
- Product advancement: completed-station replay now exposes a faculty-safe durable clinical-event summary alongside trace packet replay, without raw/private payload display or new runtime-event wiring.
- Alignment guard: summary is read-only, optional persistence-backed, and defaults safely when no durable projections are available.
- Verification:
  - `pnpm --filter @openclinxr/graphql generate:check` passed.
  - `pnpm --filter @openclinxr/api test -- app.test.ts` passed.
  - `pnpm --filter @openclinxr/api typecheck` passed.
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/11/12 slice result: seed exam readiness boundary in admin

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: the Exam Forms workbench now gives faculty/operators a clear readiness boundary between development placeholder scenes, station-queue blockers, learner launch, Quest readiness, provider readiness, and production asset release.
- Alignment guard: the slice uses existing asset and station-queue summaries only; it does not refresh evidence or claim runtime/provider readiness.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/11/12 slice result: typed asset production ladder in admin review

- Packages: `@openclinxr/asset-registry`, `@openclinxr/graphql`, `@openclinxr/api`, `@openclinxr/ui-admin`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/graphql/src/schema.graphql`
  - `packages/openclinxr/graphql/src/documents/scenario-detail.graphql`
  - `packages/openclinxr/graphql/src/documents/exam-form-workbench.graphql`
  - `packages/openclinxr/graphql/src/generated/*`
  - `apps/api/src/app.ts`
  - `apps/api/src/app.test.ts`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `apps/ui-admin/src/api-client.test.ts`
- Product advancement: faculty/admin Scenario Detail now shows a typed station-level asset release ladder with blocked release steps, station budget status, and evidence blockers.
- Alignment guard: release-ladder copy says it supports faculty/operator review only and does not establish Quest runtime readiness or learner launch.
- Verification:
  - `pnpm --filter @openclinxr/graphql generate:check` passed.
  - `pnpm --filter @openclinxr/graphql typecheck` passed.
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.
  - `pnpm --filter @openclinxr/api test -- app.test.ts` passed.
  - `pnpm --filter @openclinxr/api typecheck` passed.
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/10/12 slice result: provider readiness boundary in admin

- Packages: `@openclinxr/rest`, `@openclinxr/api`, `@openclinxr/ui-admin`.
- Touched files:
  - `packages/openclinxr/rest/src/index.ts`
  - `packages/openclinxr/rest/src/rest-routes.test.ts`
  - `apps/api/src/app.ts`
  - `apps/api/src/app.test.ts`
  - `apps/ui-admin/src/api-client.ts`
  - `apps/ui-admin/src/api-client.test.ts`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: admin users can now see runtime-provider gate posture from the capability-routing matrix directly on the Exam Forms readiness boundary.
- Alignment guard: deterministic replay readiness and live interactive provider readiness are displayed separately; no live provider, cloud, or Quest claim was enabled.
- Verification:
  - `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts` passed.
  - `pnpm --filter @openclinxr/rest typecheck` passed.
  - `pnpm --filter @openclinxr/api test -- app.test.ts` passed.
  - `pnpm --filter @openclinxr/api typecheck` passed.
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/10/12 slice result: runtime protocol posture in admin readiness boundary

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/api-client.ts`
  - `apps/ui-admin/src/api-client.test.ts`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: the Exam Forms readiness boundary now displays existing runtime protocol posture, including Bun/Hono target, fallback target, WebSocket contract status, runtime-ready protocol count, and evidence-gated media-lane count.
- Alignment guard: runtime protocol copy preserves contract-only/evidence-gated wording and does not claim Quest/WebXR media readiness.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/10/12 slice result: realtime voice posture in admin readiness boundary

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/api-client.ts`
  - `apps/ui-admin/src/api-client.test.ts`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: the Exam Forms readiness boundary now surfaces the existing realtime voice posture contract, including selected media lane, Python proxy status, cloud API posture, and rejected lane count.
- Alignment guard: the slice did not enable cloud APIs, paid APIs, model downloads, live providers, or Quest evidence refresh; it displays posture only.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## Standing code-organization guidance: SOLID for agentic context

- Prefer cohesive, intention-revealing modules when continuing product slices in long files.
- Extract panels, route handlers, summary/projection functions, and readiness surfaces when doing so reduces future read scope.
- Avoid speculative abstraction or generic framework layers that hide product behavior and increase context chasing.


## 2026-05-21 Worker 7/10/12 slice result: extracted seed readiness boundary panel

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`
- Product advancement: future admin readiness work can now inspect and extend the launch/runtime/provider/voice boundary in a focused component instead of reading the full admin shell.
- Alignment guard: extraction preserved existing behavior and avoided speculative framework abstraction.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/11 slice result: seed-bank release-ladder aggregate in readiness boundary

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.test.tsx`
- Product advancement: the Exam Forms readiness boundary now aggregates release-ladder asset counts and blocked release asset counts across the seed bank.
- Alignment guard: the aggregate remains asset-release review context and does not promote runtime, Quest, or learner-launch readiness.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- SeedExamReadinessBoundaryPanel.test.tsx App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Coordination slice result: SOLID guidance rehydration

- Touched files:
  - `AGENTS.md`
  - `PROJECT_COORDINATION_INDEX.md`
  - `AUTONOMOUS_WORK_PLAN.md`
  - `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- Product advancement: future agents now have durable instructions to manage long-file complexity without drifting into abstraction-only toil.
- Alignment guard: guidance explicitly says every extraction should protect a recently touched surface, unlock a product slice, or reduce repeated read scope.
- Verification:
  - `pnpm agent:alignment` passed.


## 2026-05-21 Worker 7/8 slice result: review-safe evidence boundary for completed-station replay

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `apps/ui-admin/src/ReviewReplaySafetyPanel.tsx`
- Product advancement: the Review Replay workbench now has a focused review-safe evidence boundary that summarizes completed-station replay evidence for faculty without raw/private payload display.
- Alignment guard: the panel frames evidence as local faculty review, debrief preparation, and scenario iteration support only.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 9 slice result: learner XR launch decision surfaced in runtime posture

- Package: `@openclinxr/ui-xr`.
- Touched files:
  - `apps/ui-xr/src/main.ts`
  - `apps/ui-xr/src/static-assets.test.ts`
- Product advancement: the learner XR runtime now exposes the already-computed launch readiness decision in the runtime posture panel and on `window.__openClinXrRuntimeReadinessDecision`.
- Alignment guard: IWSDK smoke readiness is explicitly not attached, and the UI continues to block learner launch until approved evidence is present.
- Verification:
  - `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-xr typecheck` passed.


## 2026-05-21 Worker 4/2/7 slice result: scenario-bank maturity panel

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`
- Product advancement: the Scenario Bank route now has a focused maturity panel that helps faculty/operators prioritize authoring and review gates across the bank.
- Alignment guard: the panel explicitly keeps scenario status and score-use gates in control of learner use and does not claim readiness from profile coverage alone.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 5/7/12 slice result: durable status counts in review-safe replay boundary

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/ReviewReplaySafetyPanel.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: Review Replay now exposes redacted durable clinical-event status counts inside the review-safe evidence boundary.
- Alignment guard: status counts remain summary-only and do not expose raw/private payloads.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 11 slice result: asset release blocker-type aggregation

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.test.tsx`
- Product advancement: the seed readiness boundary now aggregates asset release blockers by blocker type across production-readiness ladders.
- Alignment guard: blocker aggregation remains an asset-release review aid and does not promote production, Quest, or learner-launch readiness.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- SeedExamReadinessBoundaryPanel.test.tsx App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 7/8/12 slice result: faculty review decision handoff panel

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `docs/superpowers/specs/2026-05-21-faculty-review-decision-panel-design.md`
  - `docs/superpowers/plans/2026-05-21-faculty-review-decision-panel.md`
- Product advancement: the completed-station Review Replay workbench now gives faculty/operators a concise decision handoff for whether the replay is ready for local debrief, needs scenario iteration, or is blocked by missing review-safe evidence.
- Alignment guard: the handoff uses existing summary-only replay and durable-event fields, does not display raw/private payloads, and does not make scoring, clinical-validity, Quest-readiness, provider-readiness, or production-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.



## 2026-05-21 Worker 9 slice result: XR trace action handoff evidence export

- Package: `@openclinxr/ui-xr`.
- Touched files:
  - `apps/ui-xr/src/runtime-state.ts`
  - `apps/ui-xr/src/main.ts`
  - `apps/ui-xr/src/runtime-state.test.ts`
  - `apps/ui-xr/src/static-assets.test.ts`
- Product advancement: headset/desktop trace actions now produce a review-safe handoff export that records action source, trace tag, event type, actor ID, timing, next missing trace tag, and IWSDK sidecar scene targets for future runtime inspection.
- Alignment guard: the handoff is supporting runtime evidence only; it does not refresh Quest evidence, adopt IWSDK in production, enable providers, or claim Quest/production readiness.
- Verification:
  - `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts runtime-state.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-xr typecheck` passed.



## 2026-05-21 Worker 4/2 slice result: ordered scenario-bank exam-sequence projection

- Package: `@openclinxr/scenario-fixtures`.
- Touched files:
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`
  - `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`
- Product advancement: the scenario bank now exposes an ordered exam-sequence projection that helps exam assembly/admin agents consume the 12-station bank without re-deriving station order, review status, actor-role coverage, asset needs, dialogue seed posture, or activation boundaries.
- Alignment guard: draft scenarios remain review-only; only activation-ready scenarios are marked eligible for local formative station queue assembly.
- Verification:
  - `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts` passed.
  - `pnpm --filter @openclinxr/scenario-fixtures typecheck` passed.



## 2026-05-21 Worker 11 slice result: named asset production review packet

- Package: `@openclinxr/asset-registry`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Product advancement: a named clinical artifact can now produce an operator-facing production review packet with next evidence step, blockers, attached refs, and recommended actions from the existing readiness ladder.
- Alignment guard: the packet is explicitly `review_packet_not_release_approval`; it does not turn local fixture evidence into production readiness or Quest readiness.
- Verification:
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.



## 2026-05-21 Worker 5/12 slice result: review replay readiness summary in GraphQL/API

- Packages: `@openclinxr/graphql`, `@openclinxr/api`.
- Touched files:
  - `packages/openclinxr/graphql/src/schema.graphql`
  - `packages/openclinxr/graphql/src/documents/review-packet-replay.graphql`
  - `packages/openclinxr/graphql/src/index.ts`
  - `packages/openclinxr/graphql/src/generated/*`
  - `apps/api/src/app.ts`
  - `apps/api/src/app.test.ts`
- Product advancement: completed-station replay now has a reusable readiness summary that combines review packet, trace-event, and durable clinical-event projection posture for admin/faculty surfaces.
- Alignment guard: the summary is read-only, summary-only, and keeps raw/private payloads, new runtime wiring, clinical-validity claims, and score-use claims out of scope.
- Verification:
  - `pnpm --filter @openclinxr/graphql generate:check` passed.
  - `pnpm --filter @openclinxr/graphql typecheck` passed.
  - `pnpm --filter @openclinxr/api test -- app.test.ts` passed.
  - `pnpm --filter @openclinxr/api typecheck` passed.



## 2026-05-21 Worker 11 slice result: ED bay environment generation packet

- Package: `@openclinxr/asset-registry`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Product advancement: the ED chest pain station now has a deterministic 3D environment-generation packet that identifies spatial zones, required and optional assets, Quest budget posture, authoring-tool posture, blocked tools, review gates, and the next evidence action for the ED exam bay.
- Alignment guard: the packet is explicitly `environment_generation_plan_not_generated_asset`; it does not generate assets, add runtime dependencies, refresh Quest/IWSDK evidence, or claim production/Quest readiness.
- Verification:
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.


## 2026-05-21 Worker 11 slice result: seed-bank environment generation queue

- Package: `@openclinxr/asset-registry`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Product advancement: environment-generation planning now has a seed-bank queue that aggregates packet count, blocked scenarios, generation-review-ready scenarios, and next review-gate counts for future admin/API surfacing.
- Alignment guard: the queue is planning/review evidence only; it does not promote placeholder scenes, generate assets, refresh Quest/IWSDK evidence, or claim runtime/production readiness.
- Verification:
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.


## 2026-05-21 Worker 11/7 slice result: environment generation queue surfaced in API and admin boundary

- Packages: `@openclinxr/rest`, `@openclinxr/api`, `@openclinxr/ui-admin`.
- Touched files:
  - `packages/openclinxr/rest/src/index.ts`
  - `packages/openclinxr/rest/src/rest-routes.test.ts`
  - `apps/api/src/app.ts`
  - `apps/api/src/app.test.ts`
  - `apps/ui-admin/src/api-client.ts`
  - `apps/ui-admin/src/api-client.test.ts`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`
  - `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.test.tsx`
- Product advancement: operators can now see seed-bank 3D environment generation queue posture directly in the Exam Forms readiness boundary, including packet count, generation-review blockers, ready count, and next gate counts.
- Alignment guard: the surface states this is planning evidence only and does not mean assets were generated, Quest/IWSDK evidence was refreshed, runtime dependencies were added, or production readiness was achieved.
- Verification:
  - `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts` passed.
  - `pnpm --filter @openclinxr/rest typecheck` passed.
  - `pnpm --filter @openclinxr/api test -- app.test.ts` passed.
  - `pnpm --filter @openclinxr/api typecheck` passed.
  - `pnpm --filter @openclinxr/ui-admin test -- SeedExamReadinessBoundaryPanel.test.tsx App.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 11/7 slice result: focused 3D environment generation queue panel

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: Exam Forms now has a dedicated 3D environment generation queue panel that previews blocked environment packets and spatial-zone context, moving the asset/environment lane from hidden package data to operator-visible planning work.
- Alignment guard: the panel remains planning/review-only and explicitly avoids generated-asset, Quest runtime, IWSDK, production-readiness, or release claims.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx App.test.tsx SeedExamReadinessBoundaryPanel.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 11 slice result: ED bay environment authoring work order

- Package: `@openclinxr/asset-registry`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Product advancement: the ED bay 3D environment packet now produces a deterministic authoring work order with concrete tasks, evidence outputs, asset bundle summary, spatial-zone counts, selected authoring tool, and prohibited actions.
- Alignment guard: work order remains planning/review-only and explicitly avoids generated-asset, Quest runtime, production runtime dependency, and release-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.


## 2026-05-21 Worker 11/7 slice result: environment work-order task summary in admin queue panel

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`
- Product advancement: operators can now see the derived 3D authoring work-order summary for featured blocked environment packets, including task count, first task, authoring tool, and claim boundary.
- Alignment guard: summary remains planning/review-only; no generated assets, runtime dependencies, Quest evidence, or production readiness are implied.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 11 slice result: seed-bank environment work-order queue

- Package: `@openclinxr/asset-registry`.
- Touched files:
  - `packages/openclinxr/asset-registry/src/index.ts`
  - `packages/openclinxr/asset-registry/src/asset-registry.test.ts`
- Product advancement: the seed-bank environment lane now has an aggregate work-order queue with blocked work-order count, pending task count, ready work-order IDs, next evidence-gate counts, and prohibited-action counts.
- Alignment guard: projection remains `work_order_queue_not_asset_production` planning data and makes no generated-asset, Quest runtime, production dependency, or release-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts` passed.
  - `pnpm --filter @openclinxr/asset-registry typecheck` passed.


## 2026-05-21 Worker 11/7 slice result: environment work-order queue aggregate in admin panel

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`
- Product advancement: the 3D Environment Generation Queue panel now surfaces aggregate work-order posture: pending authoring task count, blocked work-order count, and queue-level claim boundary.
- Alignment guard: UI continues to frame work orders as planning/review-only, with no generated-asset, Quest runtime, production runtime dependency, or release-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 11 slice result: environment work-order queue REST/API endpoint

- Packages: `@openclinxr/rest`, `@openclinxr/api`.
- Touched files:
  - `packages/openclinxr/rest/src/index.ts`
  - `packages/openclinxr/rest/src/rest-routes.test.ts`
  - `apps/api/src/app.ts`
  - `apps/api/src/app.test.ts`
- Product advancement: control-plane clients can now fetch the seed-bank 3D environment work-order queue directly at `GET /scenario-bank/environments/work-orders`.
- Alignment guard: endpoint is planning/review-only, with no generated-asset, Quest runtime, production dependency, or release-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts` passed.
  - `pnpm --filter @openclinxr/rest typecheck` passed.
  - `pnpm --filter @openclinxr/api test -- app.test.ts` passed.
  - `pnpm --filter @openclinxr/api typecheck` passed.


## 2026-05-21 Worker 11/7 slice result: admin client method for environment work-order queue

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/api-client.ts`
  - `apps/ui-admin/src/api-client.test.ts`
  - `apps/ui-admin/src/App.test.tsx`
- Product advancement: admin/control-plane consumers can now fetch the direct seed-bank 3D environment work-order queue through the typed client instead of hardcoding the REST path.
- Alignment guard: client method preserves the planning-only work-order queue boundary and makes no generated-asset, Quest runtime, production dependency, or release-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts App.test.tsx` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.


## 2026-05-21 Worker 11/7 slice result: admin workbench consumes direct environment work-order queue

- Package: `@openclinxr/ui-admin`.
- Touched files:
  - `apps/ui-admin/src/App.tsx`
  - `apps/ui-admin/src/App.test.tsx`
  - `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`
- Product advancement: the Exam Forms workbench now consumes the direct 3D environment work-order queue endpoint and displays endpoint-backed pending task totals and work-order queue boundary.
- Alignment guard: UI remains planning/review-only, with no generated-asset, Quest runtime, production runtime dependency, or release-readiness claims.
- Verification:
  - `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx EnvironmentGenerationQueuePanel.test.tsx api-client.test.ts` passed.
  - `pnpm --filter @openclinxr/ui-admin typecheck` passed.

### 2026-05-21 - Worker 11 asset work-order evidence checklist

- Product advancement: Admin 3D environment queue now exposes required work-order evidence outputs and prohibited-generation guardrails instead of only aggregate queue counts.
- Files touched: `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: planning/review packet only; no generated asset, Quest readiness, production runtime dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 11 review blocker visibility

- Product advancement: 3D environment packet previews now show the active review-gate blocker, giving operators a concrete missing-evidence cue before generation review.
- Files touched: `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: blocker visibility only; no asset generation, Quest readiness, production dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 11 environment work-order operator handoff

- Product advancement: environment work orders now include a deterministic operator handoff with next action, missing evidence IDs, review blockers, and a non-generation claim boundary.
- Files touched: `packages/openclinxr/asset-registry/src/index.ts`, `packages/openclinxr/asset-registry/src/asset-registry.test.ts`.
- Verification: `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`.
- Boundary preserved: handoff metadata only; no asset generation, Quest readiness, production runtime dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 11/7 admin operator handoff surface

- Product advancement: the admin 3D environment queue now displays work-order next action and missing evidence IDs from the domain handoff model.
- Files touched: `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: operator guidance only; no generated asset, Quest readiness, production dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 7/8/12 faculty review blocker IDs

- Product advancement: faculty review decision handoff now displays deterministic blocker IDs for missing evidence, missing/late required behaviors, safety signals, and durable-summary redaction status.
- Files touched: `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- FacultyReviewDecisionPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: local review/debrief preparation only; no score-use, clinical-validity, Quest-readiness, provider-readiness, or production-readiness claim.

### 2026-05-21 - Worker 7/10 provider gate warning IDs

- Product advancement: seed exam readiness now displays profile-scoped provider warning IDs so deterministic replay remains visibly separated from live provider readiness.
- Files touched: `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`, `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- SeedExamReadinessBoundaryPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: no live provider enablement, no paid/cloud/API use, no runtime dependency change, and no provider-readiness or production-readiness claim.

### 2026-05-21 - Worker 4/7 scenario station review blocker IDs

- Product advancement: scenario-bank ordered exam projection now includes deterministic station-level review blocker IDs for draft, governance, and dialogue-seed gates.
- Files touched: `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`.
- Verification: `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts`; `pnpm --filter @openclinxr/scenario-fixtures typecheck`.
- Boundary preserved: blocker IDs only; no learner-launch, score-use, clinical-validity, Quest-readiness, provider-readiness, or production-readiness claim.

### 2026-05-21 - Worker 4/7 admin station queue blocker IDs

- Product advancement: Admin Exam Forms station queue now displays raw blocker IDs alongside human-readable station queue blockers.
- Files touched: `apps/ui-admin/src/App.tsx`, `apps/ui-admin/src/App.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: blocker visibility only; no learner-launch, score-use, clinical-validity, provider-readiness, Quest-readiness, or production-readiness claim.

### 2026-05-21 - Worker 11 environment work-order missing evidence aggregation

- Product advancement: environment work-order queues now include aggregate missing evidence counts, giving asset operators a seed-bank-level view of the evidence types blocking generation review.
- Files touched: `packages/openclinxr/asset-registry/src/index.ts`, `packages/openclinxr/asset-registry/src/asset-registry.test.ts`, `apps/ui-admin/src/App.test.tsx`, `apps/ui-admin/src/api-client.test.ts`.
- Verification: `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/ui-admin typecheck`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx api-client.test.ts`.
- Boundary preserved: evidence aggregation only; no asset generation, Quest readiness, production dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 11/7 admin missing evidence aggregate visibility

- Product advancement: the admin 3D environment queue now displays aggregate missing evidence counts from the environment work-order queue.
- Files touched: `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: evidence visibility only; no generated asset, Quest readiness, production dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 5/7/12 review replay readiness summary panel

- Product advancement: completed-station Review Replay admin path now displays the canonical replay readiness summary with blocker IDs and recommended next action.
- Files touched: `apps/ui-admin/src/App.tsx`, `apps/ui-admin/src/App.test.tsx`, `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: summary-only local faculty review/debrief preparation; no raw/private payload display, score-use, clinical-validity, provider-readiness, Quest-readiness, or production-readiness claim.

### 2026-05-21 - Worker 4/7 scenario maturity blocker IDs in admin

- Product advancement: Scenario Bank Maturity panel now displays deterministic scenario review blocker IDs for status, review gates, and validation-stage blockers.
- Files touched: `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`, `apps/ui-admin/src/App.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: authoring/review prioritization only; no learner-launch, score-use, clinical-validity, provider-readiness, Quest-readiness, or production-readiness claim.

### 2026-05-21 - Worker 7/10 provider capability gate counts

- Product advancement: Seed Exam Readiness Boundary now displays planned, blocked, and not-configured provider capability counts across runtime, asset pipeline, and persistence provider surfaces.
- Files touched: `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.tsx`, `apps/ui-admin/src/SeedExamReadinessBoundaryPanel.test.tsx`.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- SeedExamReadinessBoundaryPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.
- Boundary preserved: no live provider enablement, no cloud/API use, no dependency change, and no provider/Quest/production readiness claim.

### 2026-05-21 - Worker 11/7 missing evidence API contract

- Product advancement: environment work-order control-plane endpoint now has focused API test coverage for aggregate missing evidence counts.
- Files touched: `apps/api/src/app.test.ts`.
- Verification: `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/api typecheck`.
- Boundary preserved: contract coverage only; no asset generation, Quest readiness, production dependency, clinical validity, or scoring claim.

### 2026-05-21 - Worker 11/7 operator handoff API contract

- Product advancement: environment work-order control-plane endpoint now has focused API test coverage for operator handoff next action, missing evidence IDs, and non-generation boundary.
- Files touched: `apps/api/src/app.test.ts`.
- Verification: `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/api typecheck`.
- Boundary preserved: contract coverage only; no asset generation, Quest readiness, production dependency, clinical validity, or scoring claim.

## 2026-05-21 - Worker 9/12 XR trace handoff posture
- Lane: Quest/WebXR runtime evidence + IWSDK sidecar observability.
- Change: runtime posture Quest lane now exposes trace-action handoff progress and IWSDK sidecar smoke-plan metadata from the existing handoff evidence object.
- Evidence boundary: supporting observability only; does not claim Quest readiness, production readiness, clinical validity, or scoring readiness.
- Verification: `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`.

## 2026-05-21 - Worker 11/7 environment work-order handoff preview
- Lane: asset generation and 3D environment operator workflow.
- Change: admin packet previews now expose the domain operator handoff summary, review blocker IDs, and non-generation handoff boundary so asset operators can act without inferring from raw gate data.
- Evidence boundary: planning/review metadata only; no asset generation, Quest readiness, production dependency, clinical validity, or scoring readiness claim.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.

## 2026-05-21 - Worker 4/7 scenario-bank maturity report route and admin wiring
- Lane: scenario-bank maturity and reviewer/operator authoring workflow.
- Change: the canonical scenario-bank maturity report is now available through a stable control-plane route and admin client, and the Scenario Bank maturity panel surfaces target station, activation, blocked-gate, clinical-setting, actor-role, dialogue-seed, and guardrail-probe posture without agents/operators re-deriving it.
- Evidence boundary: maturity/reporting only; no learner-launch, clinical-validity, score-use, provider-readiness, Quest-readiness, or production-readiness claim.
- Verification: `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts App.test.tsx`; `pnpm --filter @openclinxr/rest typecheck`; `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/ui-admin typecheck`.

## 2026-05-21 - Worker 4/7 scenario-bank exam-sequence route and admin wiring
- Lane: multi-station scenario-bank and exam assembly readiness.
- Change: the ordered scenario-bank exam-sequence projection is now available through a stable control-plane route and admin client, and the Scenario Bank maturity panel displays ordered station, activation-ready, draft-review, and dialogue-replay-gate posture.
- Evidence boundary: ordered sequence/readiness projection only; draft stations stay blocked and no learner-launch, clinical-validity, score-use, provider-readiness, Quest-readiness, or production-readiness claim.
- Verification: `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts App.test.tsx`; `pnpm --filter @openclinxr/rest typecheck`; `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/ui-admin typecheck`.

## 2026-05-21 - Worker 7/8/12 faculty handoff canonical replay-readiness
- Lane: completed-station faculty review and replay-safety workflow.
- Change: Faculty Review Decision Handoff now includes the canonical replay-readiness recommended action and blocker IDs, so faculty/admin surfaces share one replay posture instead of requiring operators to compare panels manually.
- Evidence boundary: local faculty review/debrief preparation only; no score-use, clinical-validity, provider-readiness, Quest-readiness, learner-launch, or production-readiness claim.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- FacultyReviewDecisionPanel.test.tsx App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`.

## 2026-05-21 - Worker 5/7/12 station replay-readiness REST route
- Lane: replayable station evidence and persistence/review safety.
- Change: station-scoped REST consumers can now fetch canonical summary-only replay-readiness posture at `GET /sessions/:stationRunId/review-replay-readiness`, derived from review packet, trace events, and durable clinical-event review projections.
- Evidence boundary: summary-only metadata; no raw/private payload display, score-use, clinical-validity, provider-readiness, Quest-readiness, learner-launch, or production-readiness claim.
- Verification: `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/rest typecheck`; `pnpm --filter @openclinxr/api typecheck`.

## 2026-05-21 - Worker 5/7/12 admin client replay-readiness REST helper
- Lane: replayable station evidence and admin/tooling review workflow.
- Change: admin/control-plane tooling now has a typed `getReviewReplayReadinessSummary(...)` helper for the station-scoped REST route.
- Evidence boundary: summary-only replay/readiness metadata; no raw/private payload display, score-use, clinical-validity, provider-readiness, Quest-readiness, learner-launch, or production-readiness claim.
- Verification: `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts`; `pnpm --filter @openclinxr/ui-admin typecheck`.

### 2026-05-21 checkpoint: generated scene asset manual-evidence gate

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | Quest manual checker recognizes `sceneAssetEvidence` from copied UI payloads and blocks fallback-active/incomplete generated humanoid or equipment asset loads. | Complete | `pnpm exec vitest run tools/openclinxr/quest-manual-performance-check.test.ts` | Evidence remains runtime visual-presence support only; no production/Quest/clinical/scoring readiness claim is inferred. |

### 2026-05-21 checkpoint: CDP harvest preserves generated scene assets

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | Quest CDP manual-evidence harvest includes `sceneAssetEvidence` plus sanitized scene asset counts in `harvestSummary.signalSnapshot`. | Complete | `pnpm exec vitest run tools/openclinxr/quest-cdp-smoke.test.ts tools/openclinxr/quest-manual-performance-check.test.ts` | Supports headset-visible humanoid/equipment audit without converting it into readiness or clinical/scoring evidence. |

### 2026-05-21 checkpoint: generated scene assets in benchmark gate output

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | Benchmark gate output preserves Quest manual harvest scene-asset signal snapshots and allows `generated_scene_assets_loaded` to flow into the manual evidence gate. | Complete | Targeted vitest for copied UI payload, generated scene asset evidence, and CDP harvest summary cases. | Broader benchmark suite has unrelated fixture expectation drift; address only if it blocks product advancement or hides real gate regressions. |

### 2026-05-21 checkpoint: benchmark gate fixture alignment

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Coordination / Evidence leadership | Removed stale benchmark-gate fixture expectations after generated asset materialization and current Quest evidence semantics changed. | Complete | `pnpm exec vitest run tools/agent-factory/benchmark-gate-report.test.ts` | Keeps benchmark signal useful without refreshing evidence or making readiness claims. |

### 2026-05-21 checkpoint: UI runtime scene-asset payload guard

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | UI runtime tests now guard copied `sceneAssetEvidence` for generated humanoid/equipment GLB visibility. | Complete | `pnpm --filter @openclinxr/ui-xr test` | Prevents future refactors from dropping asset visibility evidence from manual Quest payloads. |

### 2026-05-21 checkpoint: generated scene asset evidence schema aligned

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 / Evidence leadership | Aligned UI, CDP harvest, manual checker, and benchmark fixtures on the generated scene asset evidence schema. | Complete | UI typecheck/test plus Quest manual, CDP smoke, and benchmark-gate vitest files. | Prevents humanoid/equipment runtime visibility evidence from being dropped due to field-name drift. |

### 2026-05-21 checkpoint: operator checklist for generated scene assets

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / QA evidence | Quest smoke checklist documents how to capture generated humanoid/equipment scene asset evidence from the headset Assets row. | Complete | `pnpm agent:alignment` | Keeps operator validation concrete while preserving non-readiness claim boundaries. |

### 2026-05-21 checkpoint: checker scene asset contract naming

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Evidence leadership | Quest manual checker type definitions now reflect the current UI scene asset evidence contract. | Complete | `pnpm exec vitest run tools/openclinxr/quest-manual-performance-check.test.ts` | Keeps future agent/code readers aligned on field names while retaining backward-compatible normalization. |

### 2026-05-21 checkpoint: UI build after generated scene asset work

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | VR UI build remains healthy after generated scene asset payload/schema alignment. | Complete | `pnpm --filter @openclinxr/ui-xr build` | Existing `three-vendor` chunk warning remains an optimization cue, not a current blocker. |

### 2026-05-21 checkpoint: ED bay environment evidence bundle

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 11 | Added local ED bay environment layout, equipment-placement, and Quest-budget evidence bundle plus validation scripts. | Complete | `pnpm exec vitest run tools/openclinxr/environment-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`; `pnpm asset:environment:generate`; `pnpm asset:environment:validate`; `pnpm asset:production:artifact-evidence:validate` | Advances the 3D environment lane from planning-only work order to materialized local evidence without claiming generated mesh, production, Quest, clinical, or scoring readiness. |
| Worker 11 / Evidence leadership | Asset-production artifact evidence now includes the `environmentShell` lane and current report was regenerated. | Complete | Targeted benchmark-gate artifact evidence test passed. | Coordination gates can now see ED bay environment evidence alongside humanoid, equipment, animation, optimization, and Quest-budget lanes. |

### 2026-05-21 checkpoint: ED bay shell GLB available to WebXR

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 11 / Worker 9 | Deterministic ED bay shell GLB is generated locally and copied into the WebXR public asset tree with provenance. | Complete | Environment/artifact-evidence tests; artifact-evidence validation; `pnpm --filter @openclinxr/ui-xr build` | Follow-on slice should load `/xr-assets/environment/ed-exam-bay-shell.glb` into the scene and include it in scene asset evidence once code touch is safe. |

### 2026-05-21 checkpoint: generated ED bay shell loaded into VR scene

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | WebXR runtime now loads `/xr-assets/environment/ed-exam-bay-shell.glb` as a named environment shell scene object and records scene asset evidence. | Complete | `pnpm --filter @openclinxr/ui-xr test`; `pnpm --filter @openclinxr/ui-xr typecheck`; `pnpm --filter @openclinxr/ui-xr build` | Advances from public static asset to visible scene-load path; does not claim Quest or production readiness. |

### 2026-05-21 checkpoint: ED bay shell provenance guard

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | Generated ED bay shell GLB has static SHA-256/provenance drift coverage in the UI package. | Complete | `pnpm --filter @openclinxr/ui-xr test` | Keeps local environment fixture drift auditable without claiming production environment readiness. |

### 2026-05-21 checkpoint: copied evidence fixtures include ED bay shell

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 / Evidence leadership | Quest manual, CDP harvest, and benchmark fixtures now model six generated scene assets including the ED bay shell. | Complete | Quest manual checker, Quest CDP smoke, and benchmark-gate vitest files. | Keeps evidence tests aligned with the runtime scene asset set. |

### 2026-05-21 checkpoint: agent verify includes environment artifacts

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Coordination / Worker 11 | Top-level agent verification now validates generated environment artifacts. | Complete | Environment/artifact-evidence tests; `pnpm asset:environment:validate`; `pnpm agent:alignment` | Reduces drift risk for ED bay shell/layout/placement/budget evidence in future autonomous runs. |

### 2026-05-21 checkpoint: operator asset count updated

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| QA evidence / Worker 9 | Quest checklist now calls out the current six generated scene assets expected in copied evidence. | Complete | `pnpm agent:alignment` | Prevents stale five-asset payloads after adding the ED bay shell. |

### 2026-05-21 checkpoint: asset-generation docs reflect ED bay shell

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 11 | Asset-generation pipeline docs now capture the generated ED bay shell and environment evidence bundle. | Complete | `pnpm agent:alignment` | Prevents future agents from treating the ED environment lane as planning-only. |

### 2026-05-22 checkpoint: animated humanoids, richer room props, GLB affordances

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | Generated humanoids now have GLTF clip playback with procedural idle fallback; ED room props and visible GLB affordance markers were added to the WebXR scene. | Complete | `pnpm --filter @openclinxr/ui-xr test`; `pnpm --filter @openclinxr/ui-xr typecheck`; `pnpm --filter @openclinxr/ui-xr build` | Advances the sample VR scene visually and behaviorally without production/Quest/clinical/scoring readiness claims. |

### 2026-05-22 checkpoint: humanoid dialogue phoneme/viseme mapping

| Worker | Slice | Status | Verification | Notes |
| --- | --- | --- | --- | --- |
| Worker 9 / Worker 11 | Dialogue trace lines now map to patient/nurse/spouse humanoids with deterministic phoneme and viseme mouth cues. | Complete | `pnpm --filter @openclinxr/ui-xr test`; `pnpm --filter @openclinxr/ui-xr typecheck`; `pnpm --filter @openclinxr/ui-xr build` | Adds visual humanoid speech behavior while explicitly avoiding production lip-sync, clinical speech-quality, voice-synthesis, or scoring claims. |

### 2026-05-22 validation checkpoint - humanoid gaze target cues
- Product lane: asset generation / 3D environment / humanoid dialogue embodiment.
- Slice completed: local humanoid speech playback now includes eye-gaze target cue rendering and evidence fields for recipient targeting.
- Files touched: `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`.
- Validation: `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and `pnpm --filter @openclinxr/ui-xr build` passed.
- Boundary note: no production gaze/eye-tracking claim; cue is deterministic local WebXR scene evidence for review and iteration.

### 2026-05-22 validation checkpoint - dynamic session asset bundles
- Product lane: Worker 11 asset-production evidence ladder plus Worker 9 XR runtime scene loading.
- Slice completed: generated humanoid/equipment/environment GLB paths are now resolved through an encounter runtime asset bundle instead of direct UI-XR generated-asset constants.
- Storage posture: runtime bundle contracts support `app_public_fixture`, `azurite_blob`, and `azure_blob` URL resolution without making cloud calls from the learner XR runtime.
- Files touched: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `packages/openclinxr/asset-registry/src/index.ts`, `packages/openclinxr/asset-registry/src/asset-registry.test.ts`, `packages/openclinxr/asset-registry/package.json`, `apps/ui-xr/package.json`, `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/dynamic-session-asset-strategy.md`.
- Validation: `pnpm --filter @openclinxr/asset-registry test`, `pnpm --filter @openclinxr/asset-registry typecheck`, `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and `pnpm --filter @openclinxr/ui-xr build` passed.
- Boundary note: this is local/runtime contract and URL resolution evidence only; no production asset readiness, Quest readiness, clinical validity, scoring validity, Azure deployment, or SAS/access-control claim is made.

### 2026-05-22 validation checkpoint - generated asset registration helpers
- Product lane: Worker 11 asset-production pipeline toward dynamic session bundles.
- Slice completed: asset registry now has generic generated-asset reference registration and encounter bundle construction helpers for Blob/Azurite-backed artifacts.
- Files touched: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `packages/openclinxr/asset-registry/src/asset-registry.test.ts`.
- Validation: `pnpm --filter @openclinxr/asset-registry test`, `pnpm --filter @openclinxr/asset-registry typecheck`, and `pnpm --filter @openclinxr/ui-xr typecheck` passed.
- Boundary note: helpers register reviewed references and deterministic URLs only; upload/auth/SAS generation and production access-control remain server/tooling responsibilities.

### 2026-05-22 validation checkpoint - generated humanoid bundle reference
- Product lane: Worker 11 generated humanoid asset pipeline into dynamic session bundles.
- Slice completed: generated-human-rigging reports now produce bundle-ready runtime asset references for Blob/Azurite-backed humanoid GLBs.
- Files touched: `tools/openclinxr/generated-human-rigging-artifacts.ts`, `tools/openclinxr/generated-human-rigging-artifacts.test.ts`.
- Validation: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts packages/openclinxr/asset-registry/src/asset-registry.test.ts` and `pnpm --filter @openclinxr/asset-registry typecheck` passed.
- Boundary note: this connects generated local rigging evidence to session asset resolution; it does not upload to Azure, issue SAS URLs, or claim production avatar readiness.

### 2026-05-22 validation checkpoint - Azurite object-store adapter
- Product lane: Worker 11 asset-production storage path for dynamic session bundles.
- Slice completed: asset registry now exposes a server/tooling-side Azurite-compatible object-store adapter for generated runtime assets.
- Files touched: `packages/openclinxr/asset-registry/src/object-store.ts`, `packages/openclinxr/asset-registry/src/object-store.test.ts`, `packages/openclinxr/asset-registry/package.json`, `docs/openclinxr/dynamic-session-asset-strategy.md`.
- Validation: `pnpm --filter @openclinxr/asset-registry test`, `pnpm --filter @openclinxr/asset-registry typecheck`, and `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts` passed.
- Boundary note: tests use a fetch adapter and do not require a running emulator. Live Azurite writes are now supported by contract but not required for default verification. No Azure production storage, SAS issuing, deployment, or access-control claim is made.

### 2026-05-22 validation checkpoint - multi-agent dynamic asset pipeline iteration
- Product lane: Worker 11 asset-production storage/bundle path plus Worker 9 learner XR asset loading.
- Agents leveraged: Asset Pipeline Lead/Solution Architect explorer, Security/Supply-Chain adversarial explorer, and Asset Pipeline worker for equipment/environment bundle references.
- Slice completed: dynamic asset pipeline now includes runtime bundle contracts, learner-safe bundle view, Azurite object-store adapter with local-only guard, asset writer for bytes/manifests/frozen bundles, generated humanoid/equipment/environment bundle references, optional Azurite upload smoke, and generated ED station bundle assembly.
- Files touched include: `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `packages/openclinxr/asset-registry/src/object-store.ts`, `packages/openclinxr/asset-registry/src/asset-writer.ts`, `tools/openclinxr/azurite-asset-upload-smoke.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.ts`, generated asset artifact helpers/tests, `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, and root package scripts.
- Validation: focused asset-registry tests/typecheck passed; focused UI-XR test/typecheck/build passed; generated station bundle and Azurite smoke tests passed. Vite still reports the known Three vendor chunk-size warning.
- Boundary note: all live storage behavior remains local Azurite/emulator-only unless separately configured by the operator. No production Azure storage, SAS issuing, deployment, production asset readiness, Quest readiness, clinical validity, or scoring validity is claimed.
- Next product slice: add API/server retrieval of frozen bundle records with offline UI-XR fallback, then add review-status promotion workflow so generated assets become visible to learner runtime only after explicit review approval.

## 2026-05-22 Worker 12 Runtime Asset Bundle Checkpoint

- `apps/api` now exposes a persistence-preferred learner runtime asset bundle retrieval path through optional `ApiPersistenceSink.getLearnerRuntimeAssetBundle(bundleId)`, while preserving the local fixture fallback and learner-safe opaque bundle contract.
- This is API-local wiring only; it does not claim production storage, Quest readiness, cloud blob readiness, clinical validity, or scoring readiness.
- Focused verification passed: `pnpm --filter @openclinxr/api test` and `pnpm --filter @openclinxr/api typecheck`.

## 2026-05-22 Worker 12 Mongo Runtime Asset Bundle Store

- `@openclinxr/data-mongodb` now persists learner-safe runtime asset bundles through `MongoRuntimeAssetBundleRepository` and exposes them through `MongoApiPersistenceSink` for the API runtime bundle route.
- The store rejects identity-field leakage and keeps generated session assets behind the learner-safe opaque bundle contract.
- Focused verification passed: `pnpm --filter @openclinxr/data-mongodb test` and `pnpm --filter @openclinxr/data-mongodb typecheck`.

## 2026-05-22 Worker 11/12 Learner-Safe Generated Bundle Output

- Generated ED station runtime bundle reports now include a learner-safe `learnerBundle` payload ready for local persistence/API retrieval, while retaining the private encounter bundle for tooling and review.
- The validator enforces learner opaque identity scope and rejects identity fields in the learner bundle.
- Focused verification passed: `vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`, `pnpm asset:generated-station-bundle`, and `pnpm asset:generated-station-bundle:validate`.

## 2026-05-22 Worker 11/12 Generated Report Publisher

- `saveLearnerRuntimeAssetBundleFromGeneratedReport` now promotes only bundle-ready generated station reports into Mongo learner runtime asset bundle storage.
- The publisher extracts the already-sanitized `learnerBundle` and rejects blocked reports, keeping asset-generation review gates ahead of learner visibility.
- Focused verification passed: `pnpm --filter @openclinxr/data-mongodb test` and `pnpm --filter @openclinxr/data-mongodb typecheck`.

## 2026-05-22 Worker 9 XR GLB Affordance Evidence

- Generated scene asset evidence now includes GLB-level affordance cue IDs and animation playback posture for humanoids, equipment, and environment assets.
- Manual/headset evidence can now distinguish loaded meshes from loaded meshes with dialogue, phoneme, gaze, selectable-equipment, workflow, and spatial-orientation affordances.
- Focused verification passed: `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and `pnpm --filter @openclinxr/ui-xr build`.

## 2026-05-22 Worker 9 Humanoid Speech Evidence Payload

- Manual Quest/WebXR evidence payloads now carry humanoid speech, phoneme, viseme, and gaze-target evidence from the generated humanoid runtime cues.
- This makes copied headset evidence useful for reviewing whether dialog and phoneme mapping are connected to humanoids while preserving non-production speech/lip-sync/eye-tracking caveats.
- Focused verification passed: `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and the prior focused `pnpm --filter @openclinxr/ui-xr build`.

## 2026-05-22 Worker 9 Dynamic XR Bundle Selection

- XR boot now accepts a dynamic runtime asset bundle ID via URL/localStorage instead of hardcoding only the default ED chest-pain encounter ID.
- This supports session-specific generated assets while preserving local fallback behavior when no API bundle is available.
- Focused verification passed: `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and `pnpm --filter @openclinxr/ui-xr build`.

## 2026-05-22 Worker 9 Runtime Bundle ID Evidence

- Manual Quest/WebXR evidence payloads now include the selected runtime asset bundle ID, tying headset captures back to dynamic generated/session asset selection.
- Focused verification passed: `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and `pnpm --filter @openclinxr/ui-xr build`.

## 2026-05-22 Worker 9/12 Learner Runtime Bundle Discovery

- Added learner-safe runtime bundle discovery through REST/API and Mongo sink list support.
- Discovery summaries include bundle ID, identity scope, actor/equipment counts, and retrieval mode, while preserving local fallback and no-production/no-Quest/no-clinical-validity boundaries.
- Focused verification passed: `pnpm --filter @openclinxr/rest test/typecheck`, `pnpm --filter @openclinxr/api test/typecheck`, and `pnpm --filter @openclinxr/data-mongodb test/typecheck`.

## 2026-05-22 Worker 9 XR Client Bundle Discovery

- XR client code now has a typed `listLearnerRuntimeAssetBundles()` method for the learner-safe runtime bundle discovery route.
- The dynamic generated/session asset path now spans generated report -> learner bundle -> Mongo sink -> API discovery/retrieval -> XR client selection/fetch.
- Focused verification passed: `pnpm --filter @openclinxr/ui-xr test`, `pnpm --filter @openclinxr/ui-xr typecheck`, and `pnpm --filter @openclinxr/ui-xr build`.

## 2026-05-22 Worker 9 Screenshot/Headset Evidence Pass

- Local browser evidence found the dev API bundle fetch needed CORS; API CORS/preflight is now covered by `@openclinxr/api` tests.
- The XR UI now surfaces WebGL/headset-render failure with an explicit overlay instead of a silent black canvas.
- Software-WebGL screenshot evidence rendered the current scene with 6/6 generated assets loaded and 18 affordance cues, but this is desktop/headless evidence only.
- `adb devices` did not list the Quest, so Quest operational status remains unverified. Required next evidence: authorized device visibility, Quest Browser load, screenshot/manual evidence payload, and input/latency capture.

## 2026-05-22 Worker 7/11 Admin Scene Generation Request Initiation

- Admin users can initiate a local scene-generation request from the 3D environment generation queue once a scenario pipeline work order is visible.
- The request path flows through the typed admin client to the control-plane POST route and returns a request ID plus the scenario work order while preserving `scene_generation_pipeline_queue_not_asset_production` and no-production/no-Quest/no-clinical-validity/no-scoring boundaries.
- Focused verification passed: targeted REST/asset-registry/API/ui-admin vitest coverage plus `@openclinxr/ui-admin`, `@openclinxr/api`, `@openclinxr/rest`, and `@openclinxr/asset-registry` typechecks.
- Next lane: add request persistence/listing or connect approved request records into the generated bundle/session-selection path so administrative configuration can operationally trigger generated assets without hardcoded runtime constants.

## 2026-05-22 Worker 7/11 Scene Generation Request Queue Listing

- Local scene-generation request records are now listable through a stable control-plane route and typed admin client method.
- Records preserve the selected scenario, accepted status, request ID, creation timestamp, work order, and non-production asset boundary so operators can audit pipeline initiation without implying generated assets or headset readiness.
- Focused verification passed: targeted REST/API/ui-admin tests plus `@openclinxr/rest`, `@openclinxr/api`, and `@openclinxr/ui-admin` typechecks.
- Next lane: make the request queue operator-visible in the admin workbench, then connect approved request records into generated bundle publication and session/runtime bundle selection.

## 2026-05-22 Worker 7/11 Admin Scene Generation Request Queue Visibility

- The admin Exam Forms workbench now shows scene-generation request queue counts and claim boundaries beside the pipeline stage summary.
- Creating a request updates the visible queue count locally, making the scenario-configuration-to-generation-request loop demonstrable without asset production, Quest readiness, clinical validity, or scoring claims.
- Focused verification passed: targeted ui-admin tests and `@openclinxr/ui-admin` typecheck.
- Next lane: attach request records to generated bundle publication/review promotion so only accepted and reviewed generated assets become selectable by session/runtime flows.

## 2026-05-22 Worker 11/12 Runtime Bundle Local Review Promotion Gate

- Encounter runtime bundles now have a bundle-level local promotion gate across all generated environment, humanoid, animation/phoneme, equipment, and UI-surface assets.
- Promotion requires asset-pipeline and security/privacy approval evidence for each generated asset and returns explicit blockers instead of learner-ready bundles when evidence is missing.
- Focused verification passed: asset-registry vitest coverage and `@openclinxr/asset-registry` typecheck.
- Next lane: use this gate in generated-report publication/admin request review before persisting learner-safe runtime bundles into Mongo or selecting them in XR.

## 2026-05-22 Worker 11/12 Generated Report Publisher Promotion Gate

- Mongo learner-bundle publication now invokes the runtime bundle local promotion gate for full generated station reports before persisting learner-safe bundles.
- This prevents accepted/admin-generated requests from becoming learner-visible generated assets unless asset-pipeline and security/privacy review evidence is present for the generated runtime assets.
- Focused verification passed: data-mongodb repository tests and `@openclinxr/data-mongodb` typecheck.
- Next lane: expose request-level review status in admin or embed runtime asset review decisions into generated report publishing workflows.

## 2026-05-22 Worker 7/11 Scene Generation Request Review Status Visibility

- Scene-generation request records now expose a pending runtime-asset-review status and explicit next action for attaching review decisions.
- The admin environment queue shows the latest request status, reducing the risk that accepted scene-generation requests are mistaken for published learner assets or Quest/production readiness.
- Focused verification passed: targeted API/ui-admin tests plus `@openclinxr/api` and `@openclinxr/ui-admin` typechecks.
- Next lane: add runtime asset review decision submission for scene-generation requests and carry those decisions into generated bundle promotion/publishing.

## 2026-05-22 Worker 7/11 Scene Generation Request Runtime Asset Review Submission

- Scene-generation requests now accept runtime asset review decisions through a stable control-plane route and typed admin client method.
- Accepted requests remain non-production/non-Quest/non-clinical-validity/non-scoring evidence, but they can now advance to a review-attached state with an explicit next action to run the generated bundle publisher.
- Focused verification passed: targeted REST/API/ui-admin tests plus `@openclinxr/rest`, `@openclinxr/api`, and `@openclinxr/ui-admin` typechecks.
- Next lane: surface a local admin action for attaching review decisions, then route those decisions into generated bundle publication/promotion.

## 2026-05-22 Worker 7/11 Admin Runtime Asset Review Attachment Action

- Admin users can now attach local runtime asset review decisions to the latest scene-generation request from the environment queue panel.
- The UI submits asset-pipeline and security/privacy decisions, then updates request status to `runtime_asset_review_attached` with `run_generated_bundle_publisher` as the next action.
- Focused verification passed: `@openclinxr/ui-admin` test and typecheck.
- Next lane: connect request-attached review decisions into generated report publishing and learner bundle persistence status.

## 2026-05-22 Worker 7/11 Scene Generation Request Publication Readiness Gate

- Scene-generation requests now have an explicit publication-readiness route and typed admin client method.
- The readiness gate distinguishes reviewed requests that may run the generated bundle publisher from requests still missing runtime asset review decisions, without implying persistence or learner/Quest/production readiness.
- Focused verification passed: targeted REST/API/ui-admin client tests plus `@openclinxr/rest`, `@openclinxr/api`, and `@openclinxr/ui-admin` typechecks.
- Next lane: expose this readiness in the admin panel and/or carry request review decisions into generated report publishing.

## 2026-05-22 Worker 7/11 Admin Publication Readiness Visibility

- The admin environment queue now displays the scene-generation request publication-readiness gate after review decisions attach.
- Operators can see when a reviewed request may run the generated bundle publisher, with the explicit `publication_readiness_not_learner_bundle_persistence` boundary.
- Focused verification passed: `@openclinxr/ui-admin` test and typecheck.
- Next lane: connect generated bundle publishing status to request records, or return to XR scene quality/runtime bundle selection fidelity.

## 2026-05-22 Worker 9/11 XR Humanoid Framing And Front-Fidelity Cues

- XR camera framing now targets the generated humanoid cluster more closely, and humanoid detail cues are placed on the camera-facing side for screenshot/headset review.
- Added visible face, hair, eyes, scrubs, shoes, and a front-fidelity badge so loaded generated humanoids should read less like primitive stand-ins in local evidence captures.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains an optimization cue.
- Next lane: capture updated Quest/manual evidence when available, then continue replacing cue overlays with higher-fidelity generated mesh/material output.

## 2026-05-23 Worker 11/12 Generated Bundle Report Carries Runtime Asset Reviews

- Runtime asset review decisions can now travel with generated ED station runtime bundle reports via CLI/file input.
- The generated report -> Mongo publisher path can enforce local runtime asset promotion against those decisions before learner-safe bundle persistence.
- Focused verification passed: generated station bundle tests, Mongo repository tests, and `@openclinxr/data-mongodb` typecheck.
- Next lane: export request-attached review decisions into the CLI-consumable JSON artifact, then publish only promotion-gated learner bundles.

## 2026-05-23 Worker 9/11 XR Scene Fidelity Evidence In Manual Payload

- Manual Quest/WebXR evidence now carries camera-framing and humanoid visual-fidelity cue IDs.
- This makes future screenshots/evidence payloads auditable for the improved close humanoid framing and front-facing detail cues while preserving no-production/no-Quest/no-clinical/no-scoring boundaries.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: capture updated Quest/manual evidence or continue generated request review -> bundle publishing integration.

## 2026-05-23 Worker 7/11/12 Scene Generation Review Decision Export Tool

- Scene-generation request review decisions can now be exported into the CLI-consumable runtime asset review decision JSON artifact.
- The local pipeline can flow admin request review state -> review-decision export -> generated station bundle report -> promotion-gated learner bundle publication.
- Focused verification passed: review decision export tests, generated station bundle tests, and `pnpm agent:alignment`.
- Next lane: add an end-to-end local publication smoke for the artifact chain or capture updated headset/manual scene evidence.

## 2026-05-23 Worker 11/12 Promotion-Gated Full Generated Report Publication

- Full generated station reports now have positive and negative Mongo publisher coverage around the local runtime asset promotion gate.
- Learner-safe bundle persistence succeeds only after all runtime assets have required asset-pipeline and security/privacy review evidence; missing decisions remain blocked.
- Focused verification passed: Mongo repository tests and `@openclinxr/data-mongodb` typecheck.
- Next lane: expose reviewed request publication status to admins or chain the local artifacts through export -> generated report -> Mongo publisher.

## 2026-05-23 Worker 11/12 Generated Bundle Review Decision Validation

- Generated station bundle reports now validate runtime asset review decision shape, nonempty evidence refs, and parseable review timestamps.
- Malformed review artifacts are rejected before they can reach promotion-gated learner bundle persistence.
- Focused verification passed: generated station bundle tests and scene-generation review-decision export tests.
- Next lane: local artifact-chain smoke coverage or admin workbench publication/promotion status.

## 2026-05-23 Worker 7/11 Admin Publication Readiness Refresh Action

- Admin users can explicitly refresh publication readiness for the latest scene-generation request from the environment queue panel.
- The action keeps generated bundle publisher readiness visible without conflating review attachment, learner bundle persistence, Quest readiness, or production readiness.
- Focused verification passed: `@openclinxr/ui-admin` test and typecheck.
- Next lane: local publication/persistence chain integration or updated Quest/manual evidence capture.

## 2026-05-23 Worker 11/12 Local Generated Learner Bundle Publisher CLI

- Generated station runtime bundle reports can now be promoted into local Mongo learner-safe bundle storage through a CLI when local Mongo is configured.
- Missing Mongo configuration reports `not_configured` rather than failing, and publication remains local/non-production with promotion gates enforced by the data-mongodb publisher.
- Focused verification passed: publisher CLI tests, Mongo repository tests, and `@openclinxr/data-mongodb` typecheck.
- Next lane: admin publisher status or end-to-end artifact chain smoke.

## 2026-05-23 Worker 9/11 ED Environment Realism Expansion

- ED room realism advanced with additional clinical/safety/ambient props across both generated environment artifacts and visible XR runtime props.
- Environment GLB was regenerated and public WebXR provenance/hash coverage was updated.
- Focused verification passed: environment artifact tests, environment generate/validate scripts, UI-XR tests/typecheck/build. Known Three vendor chunk warning remains.
- Next lane: richer equipment/bedside monitor detail, alarms/audio cues, and scenario-specific clinical clutter/notes.

## 2026-05-23 Worker 9/11 Bedside Clinical Detail Props

- XR runtime now includes bedside clinical detail props: ECG leads, blanket, notes clipboard, monitor waveform card, and call-light remote.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: monitor/alarm state changes and trace-tied environmental stress cues.

## 2026-05-23 Worker 9/11 Trace-Tied Environment State Evidence

- XR scene evidence now records trace-tied environment state: monitor state, alarm state, and stress cue IDs for vitals/ECG/escalation progression.
- Manual evidence includes this room-state payload without making clinical monitoring, scoring, Quest, or clinical-validity claims.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: visual animation/pulse of trace-relevant props.

## 2026-05-23 Worker 9/11 Reactive Environment Prop Visuals

- Relevant room props now visibly respond to trace-tied environment state through local deterministic scale/opacity changes.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: include reacted prop IDs in manual evidence and continue richer scene realism.

## 2026-05-23 Worker 9/11 Environment Reactive Prop Evidence

- Manual evidence now distinguishes candidate prop cue IDs from active trace-reactive prop IDs.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: environmental alarm/audio posture metadata and visual alarm substitute.

## 2026-05-23 Worker 9/11 Visual Alarm Posture Metadata

- Trace-tied room state now includes visual-only alarm posture and prop-level visual alarm metadata.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: room-state text panel copy or updated evidence capture.

## 2026-05-23 Worker 9/11 Room State Review Panel

- XR runtime now includes a Room State panel for monitor/alarm/active-prop feedback during scenario progression.
- Focused verification passed: `@openclinxr/ui-xr` test, typecheck, and build. Known Three vendor chunk warning remains.
- Next lane: higher-fidelity generated geometry or updated Quest/browser evidence.

## 2026-05-23 Worker 9/11 Generated GLB Bedside Geometry Realism

- Generated ED bay environment GLB now includes stretcher, mattress, rails, pillow/blanket, monitor/waveform, and clipboard geometry.
- Public XR GLB hash/provenance was updated after regeneration.
- Focused verification passed: environment artifact tests, environment generate/validate scripts, UI-XR test/typecheck/build. Known Three vendor chunk warning remains.
- Next lane: signage/texture-like cues and headset-readable label cleanup.

## 2026-05-23 Worker 11 Environment Realism Cue Metric

- Environment artifact reports now expose `environmentRealismCueCount` to quantify local scene richness across placements and interaction anchors.
- Current ED bay environment validates with 27 realism cues.
- Focused verification passed: environment artifact tests, generated station bundle tests, and environment generate/validate scripts.
- Next lane: headset/browser evidence capture or additional scene clutter/signage realism.

## 2026-05-23 Worker 9/11 Environmental Texture and Signage Realism

- Runtime and generated GLB environment lanes now include floor wear, infection-control signage, handoff whiteboard, supply drawer labels, and privacy-zone floor tape.
- Environment state evidence exposes `environmentalRealismCueIds`; browser evidence confirmed environment shell loaded with 0 failures/fallbacks after vitals, ECG, and urgent escalation trace actions.
- Environment artifact richness increased to 8 spatial zones, 15 equipment/context placements, 22 interaction anchors, and 37 local realism cues.
- Focused verification passed: environment artifact tests, static asset tests, environment generate/validate scripts, UI-XR typecheck/build. Known Three vendor chunk warning remains.
- Next lane: deterministic motion/lighting realism, label cleanup, and additional browser/headset evidence when it unlocks product work.

## 2026-05-23 Worker 9/11 Deterministic Environment Motion Cues

- Trace-reactive room props now have deterministic local motion cues and label cleanup for headset readability.
- Environment evidence exposes `environmentMotionCueMode`, and browser evidence confirmed `deterministic_visual_pulse` with four active room props after escalation traces.
- Focused verification passed: UI-XR test/typecheck/build. Known Three vendor chunk warning remains.
- Next lane: scenario-specific monitor/status badges and richer workflow clutter.

## 2026-05-23 Worker 9/11 Scenario-Specific Escalation Visuals

- Runtime ED bay now includes monitor, ECG, nurse workflow, and doorway escalation visual cues tied to trace progression.
- Browser evidence confirmed eight active props and ten environmental realism cue IDs after the escalation trace sequence.
- Focused verification passed: UI-XR test/typecheck/build. Known Three vendor chunk warning remains.
- Next lane: mirror escalation badge geometry in generated GLB artifacts and continue realism iteration.

## 2026-05-23 Worker 9/11 Generated GLB Escalation Cue Geometry

- Generated environment GLB now includes escalation badge geometry matching runtime monitor, ECG, nurse workflow, and doorway cues.
- Public WebXR GLB hash/provenance coverage was refreshed after regeneration.
- Artifact report validates at 41 local realism cues; browser evidence confirmed environment shell loaded with 0 failures/fallbacks.
- Focused verification passed: environment artifact tests, static asset tests, environment generate/validate scripts, UI-XR typecheck/build. Known Three vendor chunk warning remains.
- Next lane: more material/detail realism or pivot to the next approved product lane if needed.

## 2026-05-23 Worker 9/11 Active Prop Material Posture

- Active room props now visibly change material posture through warm color blend and emissive intensity while retaining deterministic local behavior.
- Browser evidence confirmed motion mode, visual-only alarm mode, and eight active props after escalation traces.
- Focused verification passed: UI-XR test/typecheck/build. Known Three vendor chunk warning remains.
- Next lane: more generated material/detail realism or another approved product-advancement lane.

## 2026-05-23 Worker 9/11 Clinical Detail Realism Pass

- Runtime and generated GLB environment lanes now include cable, wheel-lock, curtain-ring, trash-liner, and IV tubing details.
- Browser evidence confirmed 15 runtime environmental realism cue IDs and no generated environment load failures/fallbacks.
- Artifact report validates at 46 local realism cues after regeneration/public hash update.
- Focused verification passed: environment artifact tests, static asset tests, environment generate/validate scripts, UI-XR typecheck/build. Known Three vendor chunk warning remains.
- Next lane: reduce rudimentary geometry and run another browser/headset quality pass when useful.

## 2026-05-23 Worker 9/11 Decluttered Environment Camera Framing

- Preview camera and input panel were adjusted so the ED bay environment is more readable and less obstructed.
- Scene asset evidence now records the decluttered three-actor environment framing cue; browser evidence confirmed 0 generated asset failures/fallbacks.
- Focused verification passed: UI-XR test/typecheck/build. Known Three vendor chunk warning remains.
- Next lane: geometry/material refinements for humanoid/environment believability.

## 2026-05-23 Worker 9/11 Anny-Only Humanoid Contract and Legacy Fixture Removal

- Humanoid generation is now Anny-only: the old Blender fallback source path is disabled and the old low-poly humanoid smoke fixture is rejected.
- Generated humanoid GLB/report now require face rig, upper/lower lip sync controls, eye gaze controls, ragdoll collision proxy, and physician interaction target nodes.
- UI runtime no longer uses primitive actor geometry as a humanoid fallback; generated asset failure remains explicit evidence instead of visual substitution.
- Focused verification passed: generated-human rigging tests, Blender bake smoke tests, UI-XR static/tests/typecheck/build, and human-rigging generate/validate. Known Three vendor chunk warning remains.
- Next lane: implement actual controller/hand overlap event counters against humanoid physician-interaction targets.

## 2026-05-23 Worker 7/9/11 Runtime Scene Manifest Consumption

- Room composition is now represented in the learner runtime asset bundle through `sceneManifest.roomProps` instead of being authored only inside UI-XR.
- UI-XR consumes the runtime scene manifest to create room props and includes `runtimeSceneManifestEvidence` in copied evidence payloads.
- Focused verification passed: asset-registry tests, UI-XR static/runtime tests, UI-XR typecheck/build. Known Three vendor chunk warning remains.
- Next lane: make the scene manifest a generated artifact persisted through Blob/Mongo publication chain.

## 2026-05-23 Worker 6/7 Azure Queue Encounter Asset Generation Contract

- Encounter-definition-to-executable-encounter generation now has an Azure Storage Queue message contract with required scene-manifest, runtime-bundle-publication, and review evidence gates.
- Durable state is modeled in Mongoose through `encounter_asset_generation_jobs`, including multi-day optimization windows, Blob publication targets, checkpoint history, and review-blocked status.
- A local planning tool emits and validates an Azurite-compatible queue report for dynamic generated assets, without cloud operations, paid APIs, deployment, or readiness claims.
- Focused verification passed: capability-gateway queue tests/typecheck, Mongoose job model tests/typecheck, and encounter queue report tests/validation.
- A one-message worker execution skeleton now consumes the queue contract, emits per-stage durable checkpoints, preserves generated scene-manifest/runtime-bundle references, stops on failed stages, and review-blocks before learner runtime use.
- A queue-client processing boundary now receives one queue envelope, persists execution before delete, and keeps failed-persistence messages visible for retry.
- Worker execution persistence is now wired into a Mongoose repository for `encounter_asset_generation_jobs`, including queue message ID, checkpoint history, generated scene-manifest Blob name, and learner runtime bundle ID.
- A local one-message worker CLI now consumes the generated queue report, exercises the queue processor, writes persisted worker execution evidence, and validates no cloud/readiness claims.
- The Azure Storage Queue SDK adapter now maps real Azure/Azurite receive/delete calls into the existing queue-client boundary while preserving idle and no-delete-before-persist behavior.
- The worker CLI now has an Azurite-only mode using `AZURE_STORAGE_CONNECTION_STRING`; it rejects non-local Azure connection strings and supports empty emulator queues without false failures.
- Optional `MONGODB_URI` persistence now runs inside the worker persist callback, so queue messages are not deleted until `encounter_asset_generation_jobs` is upserted when Mongo is configured.
- Worker checkpoints now derive explicit Blob and Mongoose/Mongo publication refs for `scene-manifest.v1.json`, `learner-runtime-bundle.v1.json`, `learner_runtime_asset_bundles`, and `encounter_asset_generation_jobs`.
- Encounter publication payloads now materialize local `scene-manifest.v1.json` and `learner-runtime-bundle.v1.json` files from the generated bundle report and map them to the queue-derived Blob/Mongo publication targets.
- ED chest-pain browser/emulator evidence confirmed all generated GLBs loaded with 0 fallbacks, but exposed local fallback bundle usage instead of the generated publication payload.
- UI-XR now prefers the static generated learner runtime bundle published by the materializer before falling back to local fixture bundles.
- Follow-up browser/emulator evidence confirmed `storageBackedBundle: true` but exposed Azurite Blob URLs as a local-rendering gap when Azurite is not running.
- UI-XR now resolves generated bundle assets to local public mirrors for emulator rendering while keeping Blob/Mongo publication target evidence separate.
- Browser/emulator evidence now confirms generated bundle use, all six generated assets loaded, and zero active fallbacks.
- Visual QA showed the rotation experiment exposed blocky torso geometry; UI-XR now preserves generator-native humanoid orientation and reduces physician interaction target opacity while keeping affordance evidence.
- Runtime evidence showed dialogue phoneme/gaze mapping could be lost from late captures after the animation cue ended; UI-XR now keeps the last observed humanoid speech mapping for review evidence.
- Latest evidence confirms generated bundle rendering, zero fallbacks, and persistent speech mapping; remaining visual gap is humanoid face readability.
- UI-XR now lifts/compresses hair and adds clearer face, nose, mouth, and eye detail cues with `generated_humanoid_facial_features_unobscured`.
- Next lane: recapture visual evidence after facial cue refinement, then continue to the next encounter/asset-loop slice.

| 2026-05-23 ED chest pain humanoid readability refinement | Product loop | apps/ui-xr/src/main.ts | Pending focused UI-XR static asset test/typecheck and browser evidence recapture | Moves facial cues upward, lowers/narrows bed occlusion, and shifts patient placement to improve generated humanoid readability in the examinee scene. |

| 2026-05-23 selectable encounter asset queue | Product loop | tools/openclinxr/encounter-asset-generation-queue.ts; tools/openclinxr/encounter-asset-generation-queue.test.ts | Pending focused queue tests | Adds --scenario-id planning support for peds asthma and psych safety encounters so generation can repeat per encounter instead of staying hardcoded to ED chest pain. |

| 2026-05-23 peds asthma queue and worker evidence | Product loop | docs/openclinxr/encounter-asset-generation-queue-peds-asthma-parent-anxiety-2026-05-23.json; docs/openclinxr/encounter-asset-generation-worker-peds-asthma-parent-anxiety-2026-05-23.json | Passed focused queue/worker validation | Second encounter selected and processed through the dynamic long-running asset generation contract; next slice is making generated scene/runtime payload materialization scenario-selectable. |

| 2026-05-23 scenario-selectable generated runtime bundle | Product loop | tools/openclinxr/generated-ed-station-runtime-bundle.ts; tools/openclinxr/generated-ed-station-runtime-bundle.test.ts | Pending focused generated bundle test | Lets the asset pipeline materialize learner runtime bundles for peds asthma and psych safety instead of hardcoding ED identifiers. |

| 2026-05-23 scenario-selected UI-XR learner bundle loading | Product loop | apps/ui-xr/src/main.ts; apps/ui-xr/src/static-assets.test.ts | Passed UI-XR static asset test and typecheck | Runtime can fetch /xr-assets/generated/<scenarioId>/learner-runtime-bundle.v1.json and bind patient/team/family actors by role fallback instead of ED-only IDs. |

| 2026-05-23 peds asthma runtime bundle publication | Product loop | docs/openclinxr/generated-peds-asthma-runtime-bundle-2026-05-23.json; docs/openclinxr/encounter-publication-payloads-peds-asthma-parent-anxiety-2026-05-23.json; apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json | Passed generated bundle/publication validation | Second encounter assets are now materialized as dynamic generated learner payloads with no production/Quest/clinical/scoring claims. |

| 2026-05-23 selected encounter actor/dialogue binding | Product loop | apps/ui-xr/src/main.ts; apps/ui-xr/src/static-assets.test.ts; tools/openclinxr/generated-ed-station-runtime-bundle.ts | Passed UI-XR tests/typecheck and bundle/publication regeneration | Peds generated bundle now carries peds actor asset IDs, and runtime speech/phoneme/gaze selection follows bundle roles instead of ED hardcoding. |

| 2026-05-23 psych safety queue/bundle/publication | Product loop | docs/openclinxr/encounter-asset-generation-queue-psych-suicidal-ideation-safety-2026-05-23.json; docs/openclinxr/generated-psych-suicidal-ideation-runtime-bundle-2026-05-23.json; docs/openclinxr/encounter-publication-payloads-psych-suicidal-ideation-safety-2026-05-23.json | Passed queue/worker/bundle/publication validation | Third encounter entered the same dynamic asset generation loop with Azurite Blob + Mongoose targets and no readiness/validity claims. |

| 2026-05-23 scenario-stamped environment/equipment IDs | Product loop | tools/openclinxr/generated-ed-station-runtime-bundle.ts; tools/openclinxr/generated-ed-station-runtime-bundle.test.ts | Passed generated bundle tests and regenerated peds/psych publications | Generated learner bundles now identify humanoids, environment, and equipment with selected-scenario asset IDs instead of ED defaults. |

| 2026-05-23 scenario-specific generated scene manifests | Product loop | tools/openclinxr/generated-ed-station-runtime-bundle.ts | Passed generated bundle test and regenerated peds/psych publications | Generated learner bundles now include selected-scenario manifest IDs and contextual room props for ED, peds asthma, and psych safety. |

| 2026-05-23 psych runtime scenario-manifest evidence | Evidence loop | docs/openclinxr/evidence/psych-scenario-manifest-v4-runtime-state-2026-05-23.json | Passed browser evidence capture | Psych encounter runtime now shows selected bundle, psych context, scenario-specific room props, scenario-stamped assets, and psych actor speech evidence in desktop emulator context. |

| 2026-05-23 telehealth diabetes dynamic encounter loop | Product loop | docs/openclinxr/encounter-asset-generation-queue-telehealth-diabetes-health-literacy-2026-05-23.json; docs/openclinxr/generated-telehealth-diabetes-runtime-bundle-2026-05-23.json; docs/openclinxr/encounter-publication-payloads-telehealth-diabetes-health-literacy-2026-05-23.json | Passed queue/worker/bundle/publication validation | Fourth encounter entered dynamic asset generation/publication with scenario context, room props, actors, equipment, and no readiness/validity claims. |

| 2026-05-23 scenario-bank-derived generated bundle fallback | Product loop | tools/openclinxr/generated-ed-station-runtime-bundle.ts; docs/openclinxr/generated-ward-delirium-med-rec-runtime-bundle-2026-05-23.json | Passed generated bundle test and ward publication validation | Unknown/non-hand-authored scenarios can now derive actors, equipment, and room props from scenarioBank for the encounter asset loop. |

| 2026-05-23 remaining scenario-bank batch materialization | Product loop | docs/openclinxr/encounter-asset-generation-queue-*-2026-05-23.json; docs/openclinxr/generated-*-runtime-bundle-2026-05-23.json; docs/openclinxr/encounter-publication-payloads-*-2026-05-23.json | Passed queue/worker/bundle/publication validations for six additional scenarios | Scenario-bank encounters now have dynamic generated learner payloads and UI-XR public mirrors; per-scenario emulator evidence remains to cycle through next. |

| 2026-05-23 | Scenario-bank generated encounter batch | Completed queue/worker/runtime/publication validation for OB preeclampsia, ED stroke handoff, stepdown sepsis, clinic interpreter, oncology bad news, and postop fever. OB emulator evidence confirmed selected generated bundle, manifest, zero asset failures/fallbacks, phoneme/viseme mapping, and no ED object-name leakage after runtime refinement. | `docs/openclinxr/evidence/ob-preeclampsia-dynamic-scene-names-v2-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/ob-preeclampsia-dynamic-scene-names-v2-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Continue emulator captures for newly materialized scenario-bank encounters and refine only when evidence exposes a product/runtime gap. |

| 2026-05-23 | Scenario-specific runtime dialogue/context | Added scenario-specific opening dialogue and station context for OB preeclampsia, ED stroke handoff, stepdown sepsis, clinic interpreter, oncology bad-news, and postop fever. Verified postop evidence shows dialogue and humanoid speech phoneme mapping use the scenario-specific patient line with generated assets loaded. | `docs/openclinxr/evidence/ed-stroke-generic-v1-runtime-state-2026-05-23.json`; `docs/openclinxr/evidence/stepdown-sepsis-generic-v1-runtime-state-2026-05-23.json`; `docs/openclinxr/evidence/clinic-interpreter-generic-v1-runtime-state-2026-05-23.json`; `docs/openclinxr/evidence/oncology-family-generic-v1-runtime-state-2026-05-23.json`; `docs/openclinxr/evidence/postop-fever-specific-dialogue-v2-runtime-state-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: encode station context/dialogue in generated runtime bundles rather than UI branches so newly authored encounters remain dynamic. |

| 2026-05-23 | Bundle-driven station context | Added `sceneManifest.stationContext` to runtime bundles, refreshed UI context after async bundle load, republished the generated encounter bank, and verified postop title/dialogue/speech now match the published bundle context rather than UI defaults. | `docs/openclinxr/evidence/postop-fever-bundle-context-v4-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/postop-fever-bundle-context-v4-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: put dialogue turn scripts and gaze targets into the generated runtime bundle/publication payload. |

| 2026-05-23 | Bundle-driven dialogue turns | Added generated `dialogueTurns` with actor/text/gaze targets to runtime scene manifests; UI trace actions now consume those turns before fallback maps. Regenerated and republished the generated encounter bank, then verified postop `history_opqrst` drove visible dialogue and humanoid speech evidence from the bundle with refined speaker labels. | `docs/openclinxr/evidence/postop-fever-refined-speaker-labels-v6-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/postop-fever-refined-speaker-labels-v6-runtime-2026-05-23.png`; `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; generated bundle/publication validators for six generated scenarios | Next: formalize generated actor role types and placement cues for multi-actor scenes. |

| 2026-05-23 | Generated actor role contract | Runtime asset bundle actor roles now explicitly include generated scenario-bank roles (`family`, `parent`, `respiratory_therapist`, `nurse_observer`) and tool generation normalizes unknown roles to `other`. | `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: generate and consume actor placement hints from runtime bundles. |

| 2026-05-23 | Bundle-driven actor placements | Added generated `actorPlacements`, consumed them in UI actor slots, and exposed placement/dialogue counts in runtime scene manifest evidence. Regenerated/validated current generated encounter bank. | `docs/openclinxr/evidence/postop-fever-manifest-counts-v8-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/postop-fever-manifest-counts-v8-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts apps/ui-xr/src/runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: generate and consume equipment placement/interaction metadata. |

| 2026-05-23 | Bundle-driven equipment placements | Added generated `equipmentPlacements`, consumed them in UI equipment slots, and exposed equipment placement count in runtime manifest evidence. Regenerated/validated current generated encounter bank and captured postop evidence. | `docs/openclinxr/evidence/postop-fever-equipment-placement-v9-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/postop-fever-equipment-placement-v9-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts apps/ui-xr/src/runtime-state.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: enrich generated scene manifest semantics and per-scenario affordances. |

| 2026-05-23 | Semantic scene manifest props | Added semantic roles/evidence cues to generated room props, surfaced `semanticRoomPropCount` in runtime evidence, regenerated/validated current generated encounter bank, and captured postop evidence proving all semantic roles are present. | `docs/openclinxr/evidence/postop-fever-semantic-props-v10-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/postop-fever-semantic-props-v10-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/runtime-state.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Continue capture/refinement across generated bank, focusing on visible realism and generated-data control. |

| 2026-05-23 | Actor embodiment for virtual devices | Added actor embodiment to runtime bundles and prevented virtual-device actors from occupying humanoid scene slots. Clinic interpreter now loads patient/family humanoids while the interpreter tablet remains a virtual-device actor. | `docs/openclinxr/evidence/clinic-interpreter-embodiment-v3-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/clinic-interpreter-embodiment-v3-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: render visible virtual-device/voice-only actor affordances in scene. |

| 2026-05-23 | Visible virtual-device actor affordance | Added visible tablet-style affordance for virtual-device actors and surfaced `virtualDeviceActorCount` in runtime evidence. Clinic interpreter evidence confirms remote interpreter is represented without loading a humanoid stand-in. | `docs/openclinxr/evidence/clinic-interpreter-virtual-device-v4-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/clinic-interpreter-virtual-device-v4-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts apps/ui-xr/src/runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: route virtual-device dialogue to device affordance while preserving humanoid lip/gaze cues for humanoid speakers. |

| 2026-05-23 | Virtual-device dialogue routing | Virtual-device dialogue now preserves text/phoneme evidence while avoiding humanoid viseme/lip-sync claims. Runtime evidence includes `virtualDeviceDialogueRoutedCount`. | `docs/openclinxr/evidence/clinic-interpreter-device-dialogue-v5-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/clinic-interpreter-device-dialogue-v5-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts apps/ui-xr/src/runtime-state.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: add visible virtual-device speech/presence pulse during routed dialogue. |

| 2026-05-23 | Virtual-device speech pulse | Added active pulse behavior for virtual-device actor affordances during routed speech while preserving no-humanoid-viseme evidence boundaries. | `docs/openclinxr/evidence/clinic-interpreter-device-pulse-v6-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/clinic-interpreter-device-pulse-v6-runtime-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Sample another generated encounter for realism gaps under the enriched bundle-driven scene contract. |

| 2026-05-23 | OB enriched-contract capture | OB preeclampsia evidence validates bundle-driven semantic props, placements, equipment, dialogue turns, and humanoid viseme routing with no virtual-device actor. | `docs/openclinxr/evidence/ob-preeclampsia-enriched-contract-v3-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/ob-preeclampsia-enriched-contract-v3-runtime-2026-05-23.png` | Next: sample oncology bad-news family encounter for emotional/family communication realism. |

| 2026-05-23 | Oncology emotional-dialogue refinement | Refined oncology serious-news/family dialogue turns and validated that bundle, UI, and speech evidence use the emotionally specific family line. | `docs/openclinxr/evidence/oncology-refined-dialogue-v3-runtime-state-2026-05-23.json`; `docs/openclinxr/screenshots/oncology-refined-dialogue-v3-runtime-2026-05-23.png`; `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts` | Continue sampling generated encounters for realism-specific dialogue gaps; generalize refinements by scenario category. |

| 2026-05-23 | Timed encounter progression and note flow | Added UI-XR station-sequence evidence, timed encounter-to-note transition, patient note entry, and submit-note next-encounter navigation. Evidence confirms accelerated ED chest pain station enters note phase after the timer and advances to the OB preeclampsia generated bundle after note submission. | `docs/openclinxr/evidence/exam-flow-auto-note-phase-sample-2026-05-23.json`; `docs/openclinxr/evidence/exam-flow-auto-next-encounter-sample-2026-05-23.json`; `docs/openclinxr/screenshots/exam-flow-auto-note-phase-sample-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: session-scope patient note drafts and capture another generated encounter sample after clearing/resuming behavior is explicit. |

| 2026-05-23 | Run-scoped notes and VR-visible exam flow | Patient-note drafts are now keyed by exam run and scenario; next-encounter navigation preserves run/sequence/timing query state. In-scene VR text-panel evidence now mirrors exam phase and note readiness. | `docs/openclinxr/evidence/exam-flow-run-scoped-note-sample-2026-05-23.json`; `docs/openclinxr/evidence/exam-flow-run-scoped-next-sample-2026-05-23.json`; `docs/openclinxr/evidence/exam-flow-vr-panel-sample-2026-05-23.json`; `docs/openclinxr/screenshots/exam-flow-vr-panel-sample-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: add evidence-safe note-timeout auto-advance/blocked behavior, then sample another generated station sequence. |

| 2026-05-23 | Note-timeout progression gates | Note phase now records timeout status, blocks empty-note timeout safely, and auto-advances to the next generated encounter when a valid run-scoped note exists before timeout. | `docs/openclinxr/evidence/exam-flow-note-timeout-empty-sample-2026-05-23.json`; `docs/openclinxr/evidence/exam-flow-note-timeout-auto-advance-preseed-sample-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: maintain an exam-run summary across station transitions for sequence-level evidence and faculty review workflow alignment. |

| 2026-05-23 | Exam-run summary evidence | Added persisted `examRunId` summary evidence that accumulates station outcomes across encounter transitions and is included in the manual evidence payload. | `docs/openclinxr/evidence/exam-flow-run-summary-sample-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: surface run-summary outcomes in the DOM/VR review UI and sample a three-station sequence. |

| 2026-05-23 | Oncology realism screenshot loop and expression/locomotion refinement | Screenshot analysis found active-station mismatch in the in-VR EHR panel and weak mannequin-like face cues. UI-XR now drives in-scene clinical text from station context, adds visible mouth/eye/eyebrow/cheek/jaw expression cues, retains last observed locomotion in the VR panel, and generated bundles publish animation clip plus phoneme-map references per actor. glTF Transform was installed and used to inspect the neutral humanoid GLB, confirming no embedded animations yet. | `docs/openclinxr/evidence/realism-review-oncology-expression-v3-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-oncology-expression-v3-2026-05-23.png`; `docs/openclinxr/evidence/realism-review-locomotion-retained-2026-05-23.json`; `docs/openclinxr/evidence/gltf-transform-neutral-humanoid-inspect-2026-05-23.md`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/asset-registry test` | Next: add an asset realism gate/report for animation and morph-target absence, then materialize/retarget real clips instead of relying on procedural fallback. |

| 2026-05-23 | Animated/morph-ready humanoid materialization | Added a glTF Transform-backed humanoid realism gate, installed glTF Transform tooling, materialized local Blender animation/morph targets into the neutral generated humanoid GLB, updated provenance/hash guards, and verified runtime now reports `gltf_animation_clips_playing` for oncology humanoids. | `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-2026-05-23.json`; `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-animated-2026-05-23.json`; `docs/openclinxr/evidence/gltf-transform-neutral-humanoid-animated-inspect-2026-05-23.md`; `docs/openclinxr/evidence/realism-review-animated-humanoid-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-animated-humanoid-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: add visual-realism evidence checks tying screenshot/runtime capture to animation playback, expression cues, station context, and locomotion evidence. |

| 2026-05-23 | Active viseme/runtime realism evidence gate | Runtime humanoid speech evidence now records active phoneme, viseme, mouth openness, and expression cue IDs during dialogue. Added a runtime realism evidence checker requiring animation playback, visible expression cues, scenario-specific panel text, dialogue viseme/gaze mapping, and observed examinee locomotion. Captured oncology evidence and screenshot after movement plus family dialogue; gate passed with no blockers. | `docs/openclinxr/evidence/realism-review-active-viseme-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-active-viseme-2026-05-23.png`; `docs/openclinxr/runtime-realism-evidence-check-active-viseme-2026-05-23.json`; `pnpm exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: strengthen humanoid interaction/collision evidence with deterministic collision readiness checks and a safe local physics/collision probe before claiming richer physician-humanoid interaction realism. |

| 2026-05-23 | Humanoid collision physics probe | Installed Rapier and added a deterministic humanoid collision probe. Current oncology evidence exposes two generated humanoid ragdoll proxy cues, and the Rapier contact simulation detects learner-hand sphere overlap against each humanoid capsule proxy with no blockers. | `docs/openclinxr/humanoid-collision-probe-active-viseme-2026-05-23.json`; `pnpm exec vitest run tools/openclinxr/humanoid-collision-probe.test.ts`; `pnpm asset:humanoid-collision:validate -- --validate docs/openclinxr/humanoid-collision-probe-active-viseme-2026-05-23.json` | Next: surface collision probe status in runtime/manual evidence so screenshot captures can prove visual actors and physics-contact readiness together. |

| 2026-05-23 | Collision probe surfaced in runtime evidence | Runtime `SceneAssetEvidence` now carries `interactionCollisionEvidence` with proxy count, offline Rapier gate mode, and latest probe path. Fresh oncology capture links visible humanoids to the collision probe report while preserving non-production biomechanics boundaries. | `docs/openclinxr/evidence/realism-review-collision-linked-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-collision-linked-2026-05-23.png`; `docs/openclinxr/humanoid-collision-probe-collision-linked-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts apps/ui-xr/src/runtime-state.test.ts tools/openclinxr/humanoid-collision-probe.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: improve screenshot-visible humanoid realism through richer generated face/hair/clothing/material cues or VRM/Anny-compatible import path, then recapture adversarial visual evidence. |

| 2026-05-23 | Humanoid visual-detail and silhouette refinement | Added local Blender passes over the generated animated GLB to improve face, hair, lips, eyes, clothing, badge, shoes, and camera-facing silhouette. Gates still report `clip_and_morph_ready`; screenshots show improved readability but remaining blocky base-mesh realism debt. | `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-visual-detail-2026-05-23.json`; `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-silhouette-2026-05-23.json`; `docs/openclinxr/evidence/realism-review-visual-detail-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-visual-detail-2026-05-23.png`; `docs/openclinxr/evidence/realism-review-silhouette-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-silhouette-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts` | Next: replace the slab-like base mesh through the Anny/VRM-compatible generation lane rather than stacking more camera-facing patches. |

| 2026-05-23 | Proportioned humanoid visual body pass | Dimmed the legacy blocky mesh and added a proportioned front-facing humanoid body with head, torso, limbs, hands, legs, shoes, hair, eyes, brows, nose, lips, and scrub materials while preserving rig/morph/animation gates. Latest screenshot is materially more humanoid but still has duplicate face overlays and primitive-proxy limitations. | `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-proportioned-2026-05-23.json`; `docs/openclinxr/evidence/realism-review-proportioned-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-proportioned-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts` | Next: consolidate duplicate facial overlays and block any high-fidelity/production claim until an Anny/VRM-quality generated base mesh replaces the primitive visual proxy. |

| 2026-05-23 | Face-layer consolidation and visual-debt report | Removed older experimental visual overlays so the proportioned humanoid is the single visible layer. Latest screenshot is more humanoid and less slab-like, with explicit remaining debt recorded: primitive proxy, non-anatomical hands/limb attachment, symbolic facial controls, and no headset/production realism claim. | `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-face-consolidated-2026-05-23.json`; `docs/openclinxr/evidence/realism-review-face-consolidated-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-face-consolidated-2026-05-23.png`; `docs/openclinxr/visual-realism-review-face-consolidated-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts` | Next: replace primitive proxy with Anny/VRM-quality generated base mesh and retarget current animation/morph/phoneme/gaze/collision gates. |

| 2026-05-23 | Body-motion and structured locomotion runtime evidence | Added speaking-aligned body motion cues to humanoids and structured examinee locomotion evidence with a visible position/heading trail cue. Runtime realism gate now prefers structured locomotion path evidence over plain movement text. Browser DevTools capture timed out, so a traceability note was recorded and the next loop should use a fresh capture path. | `docs/openclinxr/evidence/realism-review-body-motion-runtime-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-body-motion-desktop-2026-05-23.png` (not usable encounter evidence); `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/runtime-realism-evidence-check.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: restore reliable screenshot capture and replace primitive humanoid proxy with an Anny/VRM-quality generated base mesh candidate while preserving existing runtime gates. |

| 2026-05-23 | Anny base mesh proxy strip and surface face refinement | Humanoid gate now distinguishes animation/morph readiness from visual base-mesh readiness. Removed 34 legacy proxy nodes from the runtime GLB, preserved the Anny skinned mesh/rig/contracts, converted visible control boxes into non-rendering semantic empties, and added smaller surface eye/lip/brow cues. Blender visual evidence shows a real generated body instead of slab/proxy layers, with remaining material/face/pose debt. | `docs/openclinxr/strip-humanoid-primitive-proxies-2026-05-23.json`; `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-surface-face-refinement-2026-05-23.json`; `docs/openclinxr/screenshots/neutral-generated-human-surface-face-refinement-2026-05-23.png`; `pnpm exec vitest run tools/openclinxr/humanoid-realism-gate.test.ts apps/ui-xr/src/static-assets.test.ts tools/openclinxr/runtime-realism-evidence-check.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: restore reliable WebGL encounter screenshot capture, then improve material/clothing/pose realism and retarget dialogue facial cues onto the Anny surface rather than symbolic overlays. |

| 2026-05-23 | Anny surface clothing refinement | Added surface-following scrub shirt/sleeve/pants and hair meshes derived from Anny body vertices, avoiding blocky clothing proxies while preserving humanoid gate readiness. Blender review shows better body-conforming clothing with remaining flat-material and T/A-pose debt. | `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-surface-clothing-2026-05-23.json`; `docs/openclinxr/screenshots/neutral-generated-human-surface-face-refinement-2026-05-23.png`; `pnpm exec vitest run tools/openclinxr/humanoid-realism-gate.test.ts apps/ui-xr/src/static-assets.test.ts tools/openclinxr/runtime-realism-evidence-check.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: improve default posture/idle-pose review evidence and recover WebGL encounter screenshots for scene-context realism analysis. |

| 2026-05-23 | Runtime humanoid overlay declutter and evidence recapture | Removed runtime proxy detail overlays, hid collision debug volumes by default, removed misaligned asset-level eye/lip/brow meshes, and recaptured the oncology encounter after locomotion plus family dialogue. Runtime realism gate now passes with animation, expression, scenario-specific panel, dialogue viseme/gaze mapping, and structured locomotion evidence. | `docs/openclinxr/screenshots/realism-review-asset-surface-decluttered-interaction-2026-05-23.png`; `docs/openclinxr/evidence/realism-review-asset-surface-decluttered-interaction-runtime-2026-05-23.json`; `docs/openclinxr/runtime-realism-evidence-check-asset-surface-decluttered-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/runtime-realism-evidence-check.test.ts tools/openclinxr/humanoid-realism-gate.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: improve facial feature alignment via mesh-space/shape-key controls and improve default actor pose/idle animation to reduce mannequin read. |

| 2026-05-23 | Mesh-painted face and subtler speech cues | Painted face/eye/lip regions directly on the Anny base mesh and reduced runtime speech cue opacity/size so dialogue evidence does not obscure the face. Captured fresh oncology interaction evidence; runtime realism gate passes with no blockers. | `docs/openclinxr/screenshots/realism-review-mesh-face-paint-interaction-2026-05-23.png`; `docs/openclinxr/evidence/realism-review-mesh-face-paint-interaction-runtime-2026-05-23.json`; `docs/openclinxr/runtime-realism-evidence-check-mesh-face-paint-2026-05-23.json`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts tools/openclinxr/runtime-realism-evidence-check.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: improve actor pose/idle animation and material contrast, then repeat encounter screenshot/evidence analysis. |

| 2026-05-23 | Material preservation and runtime posture reapplication | Reapplied clinical idle posture after animation mixer updates and preserved Anny-authored material contrast during runtime tinting. Screenshot review shows material/readability improvement but posture remains only partially improved, so the next fix should move to GLB-level pose/animation authoring. | `docs/openclinxr/screenshots/realism-review-runtime-posture-applied-2026-05-23.png`; `docs/openclinxr/screenshots/realism-review-material-contrast-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: reduce camera/panel/equipment occlusion and add close actor realism review framing, then return to GLB-level pose authoring. |

| 2026-05-23 | Actor-close visual QA and manifest prop variety | Added structured visual QA evidence for actor-close review and enriched XR room props from generated manifest semantics rather than encounter-specific hardcoding. Runtime evidence now records generated prop-detail cue IDs for tissue/empathy, chair, review/whiteboard, doorway/sign, supply, and semantic accent detail variants. | `docs/openclinxr/screenshots/realism-review-neutral-bone-restore-2026-05-23.png`; `docs/openclinxr/visual-qa-evidence-neutral-bone-restore-report-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-manifest-prop-variety-2026-05-23.png`; `docs/openclinxr/evidence/realism-review-manifest-prop-variety-runtime-2026-05-23.json`; `docs/openclinxr/visual-qa-evidence-manifest-prop-variety-report-2026-05-23.json`; `pnpm --filter @openclinxr/ui-xr typecheck`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts` | Next: reduce mannequin arm/hand posture debt through GLB-level idle pose authoring or a posture debt gate before further realism claims. |

| 2026-05-23 | Humanoid posture debt gate and authored clinical idle clip | Added clinical-idle pose detection to the humanoid realism gate, materialized a named `clinical_idle_conversation_pose` into the generated humanoid GLB, updated provenance/hash guards, and changed runtime fallback posture so authored GLB pose clips are not overwritten. Screenshot QA shows modest posture improvement but remaining shoulder/hand mannequin debt. | `docs/openclinxr/materialize-clinical-idle-pose-clip-rerun-2026-05-23.json`; `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-clinical-idle-clip-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-authored-idle-clip-active-2026-05-23.png`; `docs/openclinxr/visual-qa-evidence-authored-idle-clip-active-report-2026-05-23.json`; `pnpm exec vitest run tools/openclinxr/humanoid-realism-gate.test.ts apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: refine authored idle-pose rotations using screenshot evidence, then continue facial/eye/mouth realism and headset evidence loops. |

| 2026-05-23 | Deoccluded actor pose review and persistent gaze cue | Added pose-review capture mode for full-body visual QA, refined the authored clinical idle pose through v3, and made runtime eye-focus cues persist softly so gaze remains visually readable after speech. | `docs/openclinxr/screenshots/realism-review-actor-pose-review-v3-2026-05-23.png`; `docs/openclinxr/materialize-clinical-idle-pose-clip-v3-2026-05-23.json`; `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-clinical-idle-v3-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-persistent-gaze-cue-2026-05-23.png`; `pnpm exec vitest run tools/openclinxr/humanoid-realism-gate.test.ts apps/ui-xr/src/static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: use better source animation/retargeting or facial/morph refinement rather than more blind bone tuning. |

| 2026-05-23 | Material contrast experiment and rollback | Added a repeatable humanoid material-contrast refinement tool, captured evidence, detected a mask-like red face artifact, and rolled back only the material change while preserving pose-v3 and runtime gaze/capture improvements. | `docs/openclinxr/refine-humanoid-material-contrast-v2-2026-05-23.json`; `docs/openclinxr/refine-humanoid-material-contrast-v3-2026-05-23.json`; `docs/openclinxr/screenshots/realism-review-material-contrast-v3-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: localize facial material/texture work instead of broad material reassignment; continue morph/eye realism. |

| 2026-05-23 | Gaze/material regression cleanup | Visual QA rejected broad face material contrast and persistent floating eye cues. Rolled GLB material contrast back to pose-v3 and restored eye-focus cues to dialogue-active evidence only. | `docs/openclinxr/screenshots/realism-review-material-contrast-v3-2026-05-23.png`; `docs/openclinxr/screenshots/realism-review-persistent-gaze-fixed-2026-05-23.png`; `pnpm exec vitest run apps/ui-xr/src/static-assets.test.ts tools/openclinxr/humanoid-realism-gate.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Next: implement localized face/eye geometry or texture-map authoring instead of floating overlays or broad material reassignment. |

| 2026-05-23 | Heartbeat continuation correction | Corrected repo-level instructions so automation heartbeats are treated as work-continuation triggers, not quiet status checkpoints. Future heartbeat handling must complete a productive approved slice before any response unless no tools are available or a true blocker exists. | `AGENTS.md`; `AUTONOMOUS_WORK_PLAN.md` | Continue the highest-value approved product lane on the next wake-up; do not reply with status only. |

| 2026-05-23 | Rejected visual regression gate | Runtime realism evidence checker now blocks known rejected cue IDs from the floating persistent-eye and broad face-material experiments, preventing future evidence from passing with those regressions reintroduced. | `tools/openclinxr/runtime-realism-evidence-check.ts`; `tools/openclinxr/runtime-realism-evidence-check.test.ts`; `pnpm exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts` | Continue localized face/eye geometry or texture-map work; do not reintroduce broad face patches or floating persistent eye overlays. |

| 2026-05-23 | Authored idle-pose runtime signal | Runtime realism evidence checker now emits a positive `authored_clinical_idle_pose_runtime_cue` signal when generated humanoid evidence includes the authored clinical idle pose cue, separating pose-pipeline evidence from generic animation playback. | `tools/openclinxr/runtime-realism-evidence-check.ts`; `tools/openclinxr/runtime-realism-evidence-check.test.ts`; `pnpm exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts` | Capture fresh runtime evidence with authored idle-pose cue present, then continue face/eye/morph realism. |

| 2026-05-23 | Authored idle-pose cue suffix matching | Fixed runtime realism evidence checker to recognize namespaced authored idle-pose cue IDs by suffix, then regenerated evidence proving the authored clinical idle-pose signal appears in passed runtime evidence. | `docs/openclinxr/evidence/realism-review-authored-idle-pose-runtime-signal-2026-05-23.json`; `docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-runtime-signal-v2-2026-05-23.json`; `pnpm exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts` | Continue face/eye/morph realism and scene-quality work using authored pose evidence as a positive runtime signal. |

| 2026-05-23 | Authored idle-pose required runtime gate | Promoted authored clinical idle-pose evidence from an optional positive signal to a required generated-humanoid runtime realism signal. Current authored-idle runtime capture passes the stricter gate. | `tools/openclinxr/runtime-realism-evidence-check.ts`; `tools/openclinxr/runtime-realism-evidence-check.test.ts`; `docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23.json`; `pnpm exec vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts` | Continue localized face/eye/morph realism while preserving authored-pose evidence as a required gate. |

### 2026-05-24 humanoid realism evidence gate update
- `ui-xr`: posture-refinement screenshot collected for oncology bad-news family mouth/gaze/pose review.
- Gate status: blocked for learner-use; mouth/gaze cues are reviewable, but pose and hand/arm naturalness need another refinement slice.
- Verification completed before this gate entry: `@openclinxr/ui-xr` tests and typecheck passed for the prior posture refinement.

### 2026-05-24 capture de-cluttering slice
- `ui-xr`: mouth/gaze/pose review mode now hides secondary actors and generic target markers during realism evidence capture.
- Rationale: prior screenshot mixed the primary actor with a secondary actor/affordance marker, making pose, mouth, and gaze QA less reliable.
- Required verification: `@openclinxr/ui-xr` tests, typecheck, and recaptured screenshot evidence.

### 2026-05-24 static sleeve artifact refinement
- `ui-xr`: mouth/gaze/pose capture mode now hides static unskinned Anny scrub sleeve meshes so arm/hand pose evidence reflects the rigged humanoid rather than offset clothing artifacts.
- Gate expectation: hand/arm naturalness should be reassessed with a clean primary actor screenshot before any learner-use gate can advance.

### 2026-05-24 authored idle clip priority
- `ui-xr`: authored humanoid clinical-idle animation now takes priority over fallback posture even in mouth/gaze/pose review captures.
- Validation target: recapture primary humanoid evidence and compare arm/hand naturalness against fallback posture captures.

### 2026-05-24 generated humanoid idle clip update
- `tools/openclinxr/materialize-clinical-idle-pose-clip.ts`: clinical-idle rotations now aim for lower, less abducted arms.
- `apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb`: regenerated from the materialized clinical-idle clip.
- `apps/ui-xr/src/static-assets.test.ts`: hash updated for the regenerated GLB.
- Required verification: static asset tests, `ui-xr` typecheck, and screenshot review.

### 2026-05-24 generated humanoid idle clip v5
- `tools/openclinxr/materialize-clinical-idle-pose-clip.ts`: v5 rotations reduce the v4 arm abduction regression.
- `neutral-generated-human.glb` regenerated; hash/provenance updated to `91bfefd24cc94c56c72d69669811c64b7de6661f79e780d74bb61762b89d2651`.
- Required verification: `ui-xr` tests/typecheck and screenshot recapture.

### 2026-05-24 generated humanoid idle clip v6
- : v6 uses evidence-backed lower-arm clinical idle rotations.
-  regenerated; hash/provenance updated to .
- Required verification:  tests/typecheck and screenshot recapture.

### 2026-05-24 generated humanoid idle clip v6b
- tools/openclinxr/materialize-clinical-idle-pose-clip.ts: v6b uses evidence-backed lower-arm clinical idle rotations.
- neutral-generated-human.glb regenerated; hash/provenance updated to 91bfefd24cc94c56c72d69669811c64b7de6661f79e780d74bb61762b89d2651.
- Required verification: ui-xr tests/typecheck and screenshot recapture.

### 2026-05-24 visual QA candidate v6
- Evidence file: `docs/openclinxr/visual-qa-evidence-mouth-gaze-pose-generated-idle-v6-2026-05-24.json`.
- Screenshot: `docs/openclinxr/screenshots/realism-review-mouth-gaze-pose-generated-idle-v6-2026-05-24.png`.
- Status: concern-level local evidence candidate; no production, Quest-readiness, clinical-validity, or scoring claims.

### 2026-05-24 dialogue-to-face-rig mapping slice
- `ui-xr`: active speech now offsets generated upper/lower lip controls by viseme openness and rotates generated eye gaze controls toward the dialogue target.
- Evidence target: recapture mouth/gaze/pose after verification and ensure runtime speech evidence includes face rig mapping cues.

### 2026-05-24 face-detail capture framing
- `ui-xr`: capture IDs containing `face-rig`, `face-detail`, or `lip-eye` now use close face/lip/eye camera framing.
- Required verification: `ui-xr` tests/typecheck and close-range screenshot capture.

### 2026-05-24 morph-target dialogue mapping slice
- `ui-xr`: active dialogue visemes now update generated humanoid morph target influences for mouth open, brow concern, and cheek tension.
- Evidence target: close face/lip/eye screenshot should show stronger mouth expression and runtime metadata should carry morph target cue details.

### 2026-05-24 face morph-target visual QA candidate
- Evidence file: `docs/openclinxr/visual-qa-evidence-face-rig-morph-target-lip-eye-detail-2026-05-24.json`.
- Screenshot: `docs/openclinxr/screenshots/realism-review-face-rig-morph-target-lip-eye-detail-2026-05-24.png`.
- Status: accepted as bounded local visual QA evidence; remaining work should improve face mesh/eye geometry/hand fidelity without production claims.

### 2026-05-24 face realism regression guards
- `apps/ui-xr/src/static-assets.test.ts`: guards face-detail camera framing and morph-target/face-rig runtime cue strings.
- Purpose: prevent later asset/UI work from silently dropping the evidence-gated facial realism path.

### 2026-05-24 generated asset morph contract
- `tools/openclinxr/generated-human-rigging-artifacts.ts`: reports now require `openclinxr_mouth_open`, `openclinxr_brow_concern`, and `openclinxr_cheek_tension` morph targets.
- `tools/openclinxr/generated-human-rigging-artifacts.test.ts`: regression coverage added for morph target inventory and runtime morph-target viseme requirement.

### 2026-05-24 heartbeat slice: runtime asset morph provenance
- `tools/openclinxr/generated-human-rigging-artifacts.ts`: generated humanoid runtime asset references now include morph-target viseme contract provenance.
- `tools/openclinxr/generated-human-rigging-artifacts.test.ts`: covers morph target fixture inventory and runtime provenance propagation.

### 2026-05-24 dynamic-only scene clutter rule
- `apps/ui-xr/src/main.ts`: hides non-dynamic bed/monitor primitives in generated encounter scenes; keeps required runtime floor anchor with explicit necessity policy.
- `apps/ui-xr/src/static-assets.test.ts`: guards the dynamic-only scene policy strings.
- Verification: `@openclinxr/ui-xr` tests/typecheck.

### 2026-05-24 generated-scene affordance marker cleanup
- `apps/ui-xr/src/main.ts`: hides runtime affordance markers by default for generated encounter scenes, preserving them for explicit evidence/debug captures.
- `apps/ui-xr/src/static-assets.test.ts`: guards the marker visibility policy.
- Verification: `@openclinxr/ui-xr` tests/typecheck, then visual recapture.

### 2026-05-24 generated-scene overview framing
- `apps/ui-xr/src/main.ts`: dynamic/generated scene captures now use a wider overview camera with explicit `generated_scene_overview_multi_actor_dynamic_encounter_capture` framing metadata.
- `apps/ui-xr/src/static-assets.test.ts`: guards the generated-scene overview capture path.
- Verification: `@openclinxr/ui-xr` tests/typecheck, then screenshot recapture.

### 2026-05-24 dynamic overview visual QA baseline
- Evidence file: `docs/openclinxr/visual-qa-evidence-dynamic-only-generated-scene-overview-2026-05-24.json`.
- Screenshot: `docs/openclinxr/screenshots/realism-review-dynamic-only-generated-scene-overview-2026-05-24.png`.
- Status: accepted bounded local visual QA evidence; continue asset-pipeline realism refinement without production/Quest claims.

## 2026-05-24 Worker 7/8 validation note - review-safe timeline boundary
- Product lane: completed-station faculty/admin review workflow.
- Change: added summary-only latest timeline and patient-note posture assertions to the review-safe evidence boundary so reviewers can see replay completeness without private payload exposure.
- Verification target: `@openclinxr/ui-admin` focused App review replay coverage.
- Boundary: projection-only UI/test slice; no learner-use, score-use, clinical-validity, Quest-readiness, or production-readiness claims.

## 2026-05-24 Worker 5/6 validation note - humanoid realism queue contract
- Product lane: dynamic encounter asset generation and humanoid realism evidence gates.
- Change: encounter asset-generation queue and worker plans now preserve actor-role humanoid realism requirements before generation starts.
- Verification target: queue/worker report tests for Azurite-compatible multi-day generation contracts.
- Boundary: deterministic metadata-only contract; not generated assets, not runtime loading, not learner-use readiness.

## 2026-05-24 Worker 5/6 validation note - humanoid realism contract guard
- Product lane: dynamic encounter asset generation quality gates.
- Change: queue report validator rejects missing or malformed humanoid realism asset/signal requirements.
- Verification target: encounter asset-generation queue/worker focused tests.
- Boundary: local report validation only; no asset production or learner runtime activation.

## 2026-05-24 Worker 5/6 validation note - worker humanoid realism persistence guard
- Product lane: dynamic encounter asset pipeline and evidence-gated humanoid realism.
- Change: worker report validation now requires persisted executions to preserve humanoid realism asset/signal requirements in their plan.
- Verification target: encounter asset-generation worker focused test.
- Boundary: deterministic local validation; not generated asset readiness or learner runtime use.

## 2026-05-24 Worker 5/6 validation note - worker evidence-gate persistence guard
- Product lane: evidence-gated dynamic encounter asset generation.
- Change: worker report validation now requires persisted executions to preserve asset-production, runtime-realism, visual-QA, and Quest-runtime evidence gates with no-readiness-claim boundaries.
- Verification target: encounter asset-generation worker focused test.
- Boundary: local deterministic validation only; not generated asset readiness or learner runtime use.

## 2026-05-24 Worker 5/6 validation note - publication humanoid coverage contract
- Product lane: dynamic scene generation and executable encounter publication.
- Change: publication payload reports now include humanoid realism requirements and block materialization when required actor roles are missing from the learner runtime bundle.
- Verification target: encounter publication payload focused tests.
- Boundary: local deterministic payload materialization only; not production asset readiness or learner runtime readiness.

## 2026-05-24 Worker 5/6 validation note - publication humanoid boundary guard
- Product lane: dynamic scene publication and evidence-gated humanoid realism.
- Change: publication report validation now rejects corrupted humanoid realism not-evidence boundaries and missing dialogue viseme/gaze signal requirements.
- Verification target: encounter publication payload focused tests.
- Boundary: local deterministic validation only; not production asset readiness or learner runtime use.

## 2026-05-24 Worker 0/5 validation note - OpenClaw orchestration rehydration
- Product lane: autonomous multi-agent alignment plus dynamic publication compatibility.
- Change: `AGENTS.md` now requires a non-coding orchestration agent after compaction/OpenClaw kickoff, and publication payloads use derived humanoid realism requirements when older queue reports are consumed.
- Verification target: encounter publication payload focused tests.
- Boundary: coordinator is read-only; implementation remains in bounded product slices with no readiness/validity/scoring claims.

## 2026-05-24 Worker 9 validation note - hand-pinch select interaction detail
- Product lane: XR trace interaction observability.
- Change: hand-pinch select attempts now publish local interaction detail into trace latency evidence, including blocked reason, dwell, right-pinch state, and fired count.
- Verification target: `@openclinxr/ui-xr` runtime-state focused test.
- Boundary: WebXR local observability only; not Quest readiness, production controller latency validity, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - runtime bundle publication metadata
- Product lane: control-plane generated bundle publication and dynamic asset pipeline.
- Change: asset-registry can now derive local publication metadata from a generated runtime bundle while preserving evidence-gate blockers and no-readiness claim boundaries.
- Verification target: `@openclinxr/asset-registry` focused test.
- Boundary: local metadata/report contract only; not learner runtime activation, Quest readiness, clinical validity, scoring validity, or production asset readiness.

## 2026-05-24 Worker 5/6 validation note - generated learner runtime publication report tool
- Product lane: control-plane generated bundle publication and dynamic asset pipeline.
- Change: added local-only publication report tool for generated learner runtime bundles, using asset-registry publication metadata while preserving pending evidence gates and no-readiness boundaries.
- Verification target: `tools/openclinxr/publish-generated-learner-runtime-bundle.test.ts`.
- Boundary: report-only local planning; no Mongo/Blob writes, cloud calls, paid APIs, learner runtime enablement, Quest readiness, clinical validity, scoring validity, or production readiness.

## 2026-05-24 Worker 5/6 validation note - generated learner bundle publication script exposure
- Product lane: dynamic asset pipeline operations.
- Change: root script `asset:generated-learner-bundle:publish-plan` now exposes the local-only generated bundle publication report tool.
- Verification target: generated learner runtime bundle publication report focused test.
- Boundary: script creates local report plan only; not Blob/Mongo publication or learner runtime readiness.

## 2026-05-24 Worker 5/6 validation note - generated learner bundle publication CLI validation
- Product lane: dynamic asset pipeline operations.
- Change: generated learner runtime bundle publication plan tool now validates saved local reports by path/latest pattern.
- Verification target: generated learner runtime bundle publication report focused test.
- Boundary: local report validation only; not Blob/Mongo publication or learner runtime readiness.

## 2026-05-24 Worker 5/6 validation note - generated learner bundle publication CLI help boundary
- Product lane: dynamic asset pipeline operations.
- Change: generated learner runtime bundle publication plan CLI now exposes help text with usage and explicit local-only no-readiness boundaries.
- Verification target: generated learner runtime bundle publication report focused test.
- Boundary: script contract/help only; not Blob/Mongo publication or learner runtime readiness.

## 2026-05-24 Worker 5/6 validation note - generated learner bundle publication CLI argument safety
- Product lane: dynamic asset pipeline operations.
- Change: generated learner runtime bundle publication plan CLI now rejects missing `--output`/`--validate` path values with safe errors.
- Verification target: generated learner runtime bundle publication report focused test.
- Boundary: script UX only; not Blob/Mongo publication or learner runtime readiness.

## 2026-05-24 Worker 5/6 validation note - generated learner bundle publication destination clarity
- Product lane: dynamic asset pipeline operations.
- Change: generated learner runtime bundle publication plan CLI now rejects ambiguous `--stdout` plus `--output` usage.
- Verification target: generated learner runtime bundle publication report focused test.
- Boundary: script UX only; not Blob/Mongo publication or learner runtime readiness.

## 2026-05-24 Worker 4/2 validation note - scenario-bank pressure actor coverage
- Product lane: scenario-bank maturity and multi-actor clinical encounter design.
- Change: scenario-bank maturity now reports pressure/context actor coverage and blocks scenarios that only include patient/system actors.
- Verification target: scenario-fixtures focused test.
- Boundary: coverage/maturity signal only; not learner readiness, clinical validity, scoring validity, or exam equivalence.

## 2026-05-24 Worker 4/7 validation note - admin pressure actor maturity signal
- Product lane: scenario-bank maturity and admin review workflow.
- Change: admin Scenario Bank Maturity panel now shows pressure/context actor coverage from the scenario-bank maturity report.
- Verification target: `@openclinxr/ui-admin` focused App/api-client tests.
- Boundary: coverage/maturity signal only; not learner readiness, clinical validity, scoring validity, or exam equivalence.

## 2026-05-24 Worker 4/7 validation note - API pressure actor maturity contract
- Product lane: scenario-bank maturity and admin review workflow.
- Change: `/scenario-bank/maturity` focused API coverage now asserts pressure/context actor coverage reaches the control-plane route with complete multi-actor coverage and no missing pressure-actor gaps.
- Verification target: `@openclinxr/api` focused app test.
- Boundary: sanitized maturity metadata only; not learner readiness, clinical validity, scoring validity, Quest readiness, or exam equivalence.

## 2026-05-24 Worker 9 validation note - XR locomotion path quality probe
- Product lane: XR trace interaction and locomotion evidence.
- Change: copied/manual XR evidence now includes a path-shape quality probe with sample count, straight-line detection, path cue IDs, and blockers for missing multi-sample/turn evidence.
- Verification target: `@openclinxr/ui-xr` focused runtime-state test.
- Boundary: local observability only; not Quest readiness, motion comfort validation, clinical validity, scoring validity, or production runtime readiness.

## 2026-05-24 Worker 9 validation note - XR path-quality evidence export guard
- Product lane: XR trace interaction and locomotion evidence.
- Change: static UI-XR coverage now guards that copied/manual evidence keeps the path-quality formatter and `path_shape_probe_only` scope in the export surface.
- Verification target: `@openclinxr/ui-xr` focused static-assets test.
- Boundary: local evidence export contract only; not Quest readiness, motion comfort validation, clinical validity, scoring validity, or production runtime readiness.

## 2026-05-24 Worker 5/6 validation note - publication humanoid runtime requirements
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: encounter publication payloads now include per-humanoid runtime requirements for actor/model IDs, gaze target obligation, viseme-map obligation, required asset kinds, required signal IDs, and no-readiness/validity boundaries.
- Verification target: encounter publication payload focused test.
- Boundary: local publication contract only; not materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - publication humanoid runtime summary consistency
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: publication report validation now rejects payload summaries whose humanoid runtime requirement count does not match the actual runtime requirement list.
- Verification target: encounter publication payload focused test.
- Boundary: local validation only; not materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - publication eye realism runtime signals
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: per-humanoid publication runtime requirements now include dialogue eye micro-saccade and generated eyelid blink control cues, and validation rejects reports that drop those signals.
- Verification target: encounter publication payload focused test.
- Boundary: local publication contract only; not materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue eye realism signal source
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: encounter asset-generation queue plans now require eye micro-saccade and generated eyelid blink control signals before downstream publication/runtime evidence checks.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue contract only; not queue dispatch, materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - publication all-humanoid eye signal coverage
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: publication focused coverage now asserts every generated humanoid runtime requirement includes eye micro-saccade and generated eyelid blink control signals.
- Verification target: encounter publication payload focused test.
- Boundary: local publication contract only; not materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue all-humanoid eye signal coverage
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: queue focused coverage now asserts every planned humanoid role includes eye micro-saccade and generated eyelid blink control signals.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue contract only; not queue dispatch, materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - selectable encounter eye signal coverage
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: selectable pediatric asthma queue coverage now asserts every planned humanoid role carries eye micro-saccade and generated eyelid blink control signals.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue contract only; not queue dispatch, materialized evidence refresh, Quest readiness, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue humanoid realism profiles
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: queue reports now include metadata-only per-role humanoid realism profiles covering age band, posture, clothing/context, expression/affect, mobility constraints, and required realism evidence IDs.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue metadata only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - capability-gateway humanoid realism profile contract
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: core encounter humanoid requirements can now carry metadata-only realism profiles through Azure queue encode/decode and plan derivation.
- Verification target: capability-gateway asset-generation-jobs focused test.
- Boundary: core metadata contract only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - capability-gateway eye realism validator
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: core queue-message validation now rejects humanoid requirements missing eye micro-saccade or generated eyelid blink control signals, with negative coverage for malformed metadata profiles.
- Verification target: capability-gateway asset-generation-jobs focused test.
- Boundary: core metadata validation only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue embedded realism profile parity
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: queue humanoid requirements now embed metadata-only realism profiles, and focused coverage asserts parity with the top-level queue profile list.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue metadata only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue embedded profile validator
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: queue validation now rejects embedded humanoid realism profiles that drop metadata-only scope or required viseme/eye/blink evidence IDs.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue metadata validation only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue profile count parity validator
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: queue validation now rejects reports where top-level humanoid realism profiles do not cover every humanoid requirement actor.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue metadata validation only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - publication humanoid realism profile handoff
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: publication reports now carry queue humanoid realism profiles and validate profile count plus required viseme/eye/blink evidence IDs.
- Verification target: encounter publication payload focused test.
- Boundary: local publication metadata only; not materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - publication profile actor-role validator
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: publication validation now rejects humanoid realism profiles whose actor role does not match a humanoid requirement actor role.
- Verification target: encounter publication payload focused test.
- Boundary: local publication metadata validation only; not materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - queue profile actor-role validator
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: queue validation now rejects top-level humanoid realism profiles whose actor role does not match a humanoid requirement actor role.
- Verification target: encounter asset-generation queue focused test.
- Boundary: local queue metadata validation only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 5/6 validation note - capability-gateway embedded profile requirement
- Product lane: dynamic encounter factory and generated humanoid realism handoff.
- Change: core queue-message validation now rejects humanoid requirements that do not embed metadata-only realism profiles.
- Verification target: capability-gateway asset-generation-jobs focused test.
- Boundary: core metadata validation only; not queue dispatch, materialized evidence refresh, Quest readiness, GLB quality evidence, production asset readiness, clinical validity, or scoring validity.

- 2026-05-24 Task 4 asset-registry: runtime bundle publication metadata now accepts optional humanoid realism profiles and emits a metadata-only profile summary of required evidence signal IDs; learner-use blockers and readiness boundaries remain unchanged.

2026-05-24 Task 6 note: runtime realism evidence checks can reason over supplied metadata-only humanoid realism profiles and block handoff when profile evidence IDs omit viseme, eye micro-saccade, or generated blink coverage; this remains metadata gating only, not visual proof or readiness evidence.

## 2026-05-24 Worker 11 validation note - admin publication profile visibility
- Product lane: dynamic encounter factory admin/API visibility.
- Change: scene-generation publication readiness now includes metadata-only runtime bundle publication metadata, including generated asset refs, humanoid/equipment counts, and humanoid realism profile signal coverage surfaced in the admin panel.
- Verification target: API app focused test, UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, and UI-admin typecheck.
- Boundary: projection-only admin/API visibility; not Quest evidence, screenshot/video analysis, generated GLB materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 11 validation note - admin humanoid profile role visibility
- Product lane: dynamic encounter factory admin/API visibility.
- Change: runtime bundle publication metadata now includes humanoid realism profile actor-role coverage, and the admin queue panel exposes covered roles plus metadata-only signal requirements.
- Verification target: asset-registry focused test, API app focused test, UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, and UI-admin typecheck.
- Boundary: projection-only role coverage; not Quest evidence, screenshot/video analysis, generated GLB materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 12 validation note - encounter factory dry-run plan
- Product lane: dynamic encounter factory review posture.
- Change: encounter publication payload reports now include `encounterFactoryDryRunPlan` with scenario/request sources, actor roles, planned stages, reviewer roles, and hard evidence boundaries before any generation/publication/runtime enablement claims.
- Verification target: encounter publication payload focused test.
- Boundary: metadata-only dry-run plan; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 12 validation note - dry-run plan validator hardening
- Product lane: dynamic encounter factory review posture.
- Change: publication payload validation now enforces required dry-run plan stages, stage-count parity, actor/profile coverage where applicable, and metadata-only evidence boundaries.
- Verification target: encounter publication payload focused test.
- Boundary: metadata-only validation; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 12 validation note - dry-run plan summary export
- Product lane: dynamic encounter factory operator/agent usability.
- Change: publication payload tooling now exposes a read-only dry-run plan summary for local report JSON files, covering plan status, actor roles, stages, review gates, next action, blockers, and evidence boundaries.
- Verification target: encounter publication payload focused test with temp local JSON CLI summary path.
- Boundary: read-only local metadata summary; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 12 validation note - dry-run summary script alias
- Product lane: dynamic encounter factory operator/agent usability.
- Change: root package scripts now expose `asset:encounter-publication:summarize-dry-run` as a read-only entrypoint for dry-run plan summary inspection.
- Verification target: encounter publication payload focused test.
- Boundary: script alias only; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 13 validation note - scenario maturity blocker visibility
- Product lane: scenario-bank/admin product usability.
- Change: scenario-bank maturity now includes per-scenario blocker visibility for review gates, governance stage, dialogue seed readiness, traceability readiness, asset-need types, and environment IDs; admin surfaces the breakdown summary read-only.
- Verification target: scenario-fixtures scenario-bank focused tests, API app focused tests, UI-admin api-client/App focused tests, and UI-admin typecheck.
- Boundary: read-only maturity/blocker visibility; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 13 validation note - scenario maturity recommended actions
- Product lane: scenario-bank/admin product usability.
- Change: per-scenario maturity breakdowns now include deterministic recommended next actions, and admin summaries expose those actions with blocker/dialogue/traceability posture.
- Verification target: scenario-fixtures scenario-bank focused tests, API app focused tests, UI-admin api-client/App focused tests, and UI-admin typecheck.
- Boundary: read-only maturity/blocker recommendation visibility; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 13 validation note - scenario maturity recommended actions
- Product lane: scenario-bank/admin product usability.
- Change: per-scenario maturity breakdowns now carry deterministic recommended next actions, and the admin summary exposes those actions with blocker/dialogue/traceability posture.
- Verification target: scenario-fixtures scenario-bank focused tests, API app focused tests, UI-admin api-client/App focused tests, and UI-admin typecheck.
- Boundary: read-only maturity/blocker recommendation visibility; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - publication blocker visibility surface
- Product lane: review workflow / station runtime blocker visibility.
- Change: scenario publication readiness now includes a deterministic blocker visibility projection with blocker IDs, warning IDs, human-review requirement, recommended next action, and an explicit no-readiness-claim boundary.
- Verification target: review-workflow scenario-publication focused tests and scenario-runtime focused tests.
- Boundary: local blocker visibility; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement beyond existing local-formative gate semantics, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - admin client publication blocker visibility
- Product lane: admin/review workflow blocker visibility.
- Change: admin control-plane client now exposes the scenario publication-readiness REST route and verifies publication blocker visibility metadata and boundaries.
- Verification target: UI-admin api-client/App focused tests and UI-admin typecheck.
- Boundary: admin client visibility only; not GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - scenario detail publication blocker panel
- Product lane: admin/review workflow blocker visibility.
- Change: scenario detail now fetches and renders publication blocker visibility with blocker/warning IDs, human-review posture, recommended action, and boundary language.
- Verification target: UI-admin App/api-client focused tests and UI-admin typecheck.
- Boundary: read-only admin UI visibility; not GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - API publication blocker visibility contract
- Product lane: admin/review workflow blocker visibility.
- Change: API publication-readiness tests now assert blocker visibility metadata and no-readiness-claim boundaries for blocked and warning-only local formative cases.
- Verification target: API app focused test.
- Boundary: API contract visibility only; not GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - scenario detail publication visibility scope guard
- Product lane: admin/review workflow blocker visibility.
- Change: scenario-detail publication blocker visibility is now fetched only for the ED chest pain seed scenario, preventing accidental reuse of ED-specific blocker posture on other scenario pages.
- Verification target: UI-admin App focused test and UI-admin typecheck.
- Boundary: UI guardrail only; not broader per-scenario routing, GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - publication blocker target-use label
- Product lane: admin/review workflow blocker visibility.
- Change: scenario-detail publication blocker visibility now shows target-use scope so local formative posture is not confused with broader publication/readiness claims.
- Verification target: UI-admin App focused test and UI-admin typecheck.
- Boundary: read-only UI clarity; not broader per-scenario routing, GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - publication blocker reviewer-role visibility
- Product lane: admin/review workflow blocker visibility.
- Change: scenario-detail publication blocker visibility now lists missing reviewer roles alongside blocker/warning IDs and recommended next action.
- Verification target: UI-admin App focused test and UI-admin typecheck.
- Boundary: read-only UI blocker clarity; not broader per-scenario routing, GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 14 validation note - publication blocker gate-status visibility
- Product lane: admin/review workflow blocker visibility.
- Change: scenario-detail publication blocker visibility now lists publication gate statuses alongside missing reviewer roles, blocker/warning IDs, and recommended next action.
- Verification target: UI-admin App focused test and UI-admin typecheck.
- Boundary: read-only UI blocker clarity; not broader per-scenario routing, GraphQL schema expansion, Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 12 validation note - dynamic encounter behavior coverage validator
- Product lane: dynamic encounter factory review posture and humanoid realism metadata.
- Change: encounter publication payload validation now enforces required-role coverage for dialogue turns, gaze targets, actor-target support, and actor placements, including deterministic blocker IDs for missing required behavior metadata.
- Verification target: encounter publication payload focused test.
- Boundary: local metadata validation only; not Quest evidence, screenshot/video analysis, generated asset materialization beyond existing temp-test payload behavior, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 12 validation note - dry-run dynamic behavior summary
- Product lane: dynamic encounter factory operator/agent usability.
- Change: dry-run plan summaries now include compact dynamic behavior coverage for dialogue actor roles, gaze targets, actor placements, blockers, warnings, and the metadata-only behavior boundary.
- Verification target: encounter publication payload focused test.
- Boundary: read-only local summary metadata only; not Quest evidence, screenshot/video analysis, generated asset materialization beyond existing temp-test payload behavior, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 11/12 validation note - admin dynamic behavior coverage visibility
- Product lane: dynamic encounter factory admin/API visibility.
- Change: scene-generation publication readiness now exposes metadata-only dynamic behavior coverage, and the admin 3D environment queue panel displays dialogue, gaze, placement, missing-role, and blocker summaries with the no-runtime-evidence claim boundary.
- Verification target: API app focused tests, UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, and UI-admin typecheck.
- Boundary: read-only admin/API visibility only; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 11/12 validation note - admin encounter factory dry-run summary
- Product lane: dynamic encounter factory admin/API visibility.
- Change: scene-generation publication readiness now includes a compact encounter factory dry-run summary, and the admin 3D environment queue panel displays plan status, actor roles, stages, review gates, blockers, warnings, next action, and dry-run boundary.
- Verification target: API app focused tests, UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, and UI-admin typecheck.
- Boundary: read-only admin/API dry-run visibility only; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-24 Worker 11/12 validation note - dry-run evidence-boundary visibility
- Product lane: dynamic encounter factory admin/API boundary clarity.
- Change: scene-generation publication readiness dry-run summaries now carry explicit evidence-boundary flags, and admin displays the core metadata-only/generated-assets/learner-runtime/Quest-claim posture.
- Verification target: API app focused tests, UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, and UI-admin typecheck.
- Boundary: read-only admin/API dry-run boundary visibility only; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker coordination note - dynamic encounter factory completion plan
- Product lane: dynamic encounter factory completion and multi-agent execution.
- Change: added the durable implementation plan at `docs/superpowers/plans/2026-05-25-dynamic-encounter-factory-completion.md` with dependency-ordered work packages and worker ownership.
- Next worker dispatch: shared dynamic behavior and dry-run summary contracts, then encounter definition/work-order bridge once shared contracts are stable.
- Boundary: planning and local deterministic execution only; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 4 validation note - peds asthma queued as definition lane
- Product lane: scenario-bank expansion for dynamic encounter factory planning.
- Finding: `peds_asthma_parent_anxiety_v1` is the next smallest safe scenario-definition lane because actor/dialogue/trace/environment/equipment metadata exists, but review gates remain draft.
- Next validation target: scenario-fixtures scenario-bank focused tests after adding factory-planning projections or assertions.
- Boundary: fixture/factory planning metadata only; not scenario approval, clinical validity, scoring validity, Quest readiness, generated asset materialization, or production readiness.

## 2026-05-25 Worker 11/12 validation note - shared dynamic factory contracts completed
- Product lane: dynamic encounter factory contract convergence.
- Change: asset-registry now owns shared dynamic behavior coverage and encounter factory dry-run summary builders/contracts; API/tooling reuse shared posture where practical, shared humanoid runtime signal IDs are reused by queue tooling, and `changes_requested` publication review remains blocked by regression coverage.
- Verification target: asset-registry runtime-bundles tests, encounter publication payload focused tests, API app focused tests, review-workflow scenario-publication focused tests, and encounter asset-generation queue focused tests.
- Boundary: local metadata/contract hardening only; not Quest evidence, screenshot/video analysis, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 4 validation note - peds asthma factory-planning projection
- Product lane: scenario-bank expansion for dynamic encounter factory planning.
- Change: `peds_asthma_parent_anxiety_v1` now appears in a deterministic factory-planning projection after ED chest pain with actor/dialogue/trace/environment/equipment/asset metadata and explicit review blockers.
- Verification target: scenario-fixtures scenario-bank focused tests and scenario-fixtures typecheck, plus approved claim-boundary review.
- Boundary: fixture/factory planning metadata only; not scenario approval, clinical validity, scoring validity, Quest readiness, generated asset materialization, learner runtime enablement, or production readiness.

## 2026-05-25 Worker 11 validation note - encounter definition to asset work-order bridge
- Product lane: dynamic encounter factory asset pipeline bridge.
- Change: asset-registry now builds metadata-only scene/actor work orders from scenario definitions with humanoid appearance, rigging/animation, provenance/licensing, optimization/performance, evidence-gate, environment, and equipment metadata; peds draft work orders include scenario status and no-approval boundary metadata.
- Verification target: asset-registry scene-generation focused tests plus approved boundary review.
- Boundary: work-order planning metadata only; not generated asset materialization, Quest evidence, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 11 validation note - humanoid realism metadata contract
- Product lane: dynamic encounter factory humanoid realism metadata.
- Change: actor work orders and character manifests now include typed face/viseme, gaze/blink, animation, appearance, collision/interaction, provenance/license, limitation, fixture/non-production, and visual-QA blocker metadata for ED and peds scenarios.
- Verification target: asset-registry focused tests plus approved boundary/realism review.
- Boundary: metadata contract/work-order planning only; not generated asset materialization, Quest evidence, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 11/9 validation note - runtime bundle assembly boundary
- Product lane: runtime bundle assembly and learner-use gate separation.
- Change: runtime bundle publication metadata now carries assembly audit refs and fallback posture, while learner-use gates stay blocked by pending runtime-realism, visual-QA, and Quest evidence gates; API readiness separates publisher readiness from learner runtime use.
- Verification target: asset-registry focused tests, API app focused tests, and approved boundary review.
- Boundary: metadata/audit/readiness-boundary only; not generated asset materialization, Quest evidence, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 7/8 validation note - admin review gate orchestration
- Product lane: admin review workflow and dynamic encounter factory visibility.
- Change: API/admin surfaces now expose factory-planning status, scene work-order/request status, runtime bundle gates, assembly audit metadata, humanoid metadata blockers, learner-use blockers, evidence gates, and review actions with explicit peds draft/no-approval boundaries.
- Verification target: API app focused tests, UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, UI-admin typecheck, and approved claim-boundary review.
- Boundary: read-only admin/API orchestration only; not generated asset materialization, Quest evidence, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 9 validation note - learner WebXR blocked-gate posture
- Product lane: learner WebXR runtime gate safety.
- Change: UI-XR consumes shared learner-use gate evaluation, blocks generated learner bundle use when runtime-realism, visual-QA, or Quest evidence gates are pending, falls back to fixture assets, and displays generated-bundle blocker posture accurately.
- Verification target: UI-XR focused tests, typecheck, build, and approved blocked-gate review.
- Boundary: local runtime gating only; not Quest evidence, generated asset materialization, learner generated-bundle enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 5/7/8 validation note - replayable evidence loop
- Product lane: replayable evidence and faculty/admin review handoff.
- Change: API/admin replay readiness projections now link review packet refs, trace refs, patient notes, actor turns, runtime evidence gates, generated-bundle blockers, and publication blocker visibility while preserving redaction and no-score-use boundaries.
- Verification target: API app focused tests/typecheck, UI-admin App/api-client/ReviewReplayReadinessSummaryPanel focused tests/typecheck, and approved replay-boundary review.
- Boundary: read-only local replay evidence handoff only; not Mongo production wiring, Quest evidence, generated asset materialization, learner runtime enablement, production asset readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 6/10 validation note - provider gate metadata
- Product lane: provider/runtime readiness boundaries.
- Change: deterministic provider gates now cover model/dialogue, STT, TTS, emotional prosody, lip-sync timing, and asset generation paths; production STT/TTS cloud paths are `cloud-approved` gated states with live/evidence flags false.
- Verification target: capability-gateway focused tests, voice-gateway focused tests, API/UI-admin focused tests, and approved provider-boundary review.
- Boundary: provider metadata only; not live provider calls, paid/cloud API use, Quest readiness, production readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker coordination note - completion gate packet and worker handoff
- Product lane: dynamic encounter factory completion gate and next-worker routing.
- Change: added `docs/openclinxr/dynamic-encounter-factory-completion-gate-packet-2026-05-25.json` as the machine-readable status packet for ED chest pain and peds asthma, covering definition, work orders, humanoid metadata, runtime bundle, admin gates, XR use gate, replay evidence blockers, provider gates, and next approved worker.
- Completion status: `done_with_concerns`; local deterministic metadata/payload/gate handoff is complete, but review/evidence blockers still prevent learner use, Quest readiness, production readiness, clinical validity, scoring validity, live provider readiness, and peds scenario approval.
- Next approved worker: Worker 9 plus Worker 11 for focused runtime-realism/humanoid visual-QA evidence attachment, then Worker 4 plus Worker 7/8 for peds review packet/checklist prep; avoid broad benchmark refresh unless it unlocks a named decision.
- Boundary: packet/docs only; not generated asset materialization, Quest evidence, learner runtime enablement, production asset readiness, clinical validity, scoring validity, live provider calls, paid/cloud API use, or deployment.

## 2026-05-25 Worker coordination note - next autonomous handoff packet
- Product lane: continuation control after dynamic encounter factory completion packet.
- Change: added `docs/openclinxr/next-autonomous-worker-handoff-2026-05-25.json` with the next safe slices and explicit stop-before boundaries.
- Boundary: handoff metadata only; not Quest evidence, generated asset materialization, learner runtime enablement, production readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 11/9 validation note - pipeline execution quality iteration
- Product lane: dynamic encounter factory execution, generated humanoid realism, and publication gate quality.
- Change: queue/worker/publication `--validate-latest` tooling now resolves the newest modified report instead of lexically newest filename, preventing stale scenario reports from hijacking current validation.
- Change: the Anny-derived generated humanoid GLB export now includes required facial morph targets for mouth open, brow concern, and cheek tension, clearing the generated humanoid model blocker while keeping local-fixture/non-production caveats.
- Change: the ED family actor runtime role now aligns to `family_member`, matching encounter-factory humanoid realism requirements and enabling all-role behavior coverage.
- Verification: `asset:encounter-queue:validate`, `asset:encounter-worker:run`, `asset:encounter-worker:validate`, `asset:human-rigging:generate`, `asset:human-rigging:validate`, `asset:medical-equipment:generate`, `asset:medical-equipment:validate`, `asset:environment:generate`, `asset:environment:validate`, `asset:generated-station-bundle`, `asset:generated-station-bundle:validate`, `asset:encounter-publication:materialize`, `asset:encounter-publication:validate`, and the dry-run summary command all completed successfully with the NVM/Corepack pnpm path.
- Evidence: dry-run summary for `docs/openclinxr/encounter-publication-payloads-2026-05-25.json` now has status `review_plan_created_not_asset_generation`, zero blockers/warnings, and dialogue/gaze/placement coverage for patient, nurse, and family_member.
- Next: attach runtime realism and visual-QA evidence to the now-unblocked generated runtime bundle path before refreshing Quest/headset evidence.
- Focused regression verification also passed: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/encounter-asset-generation-queue.test.ts tools/openclinxr/encounter-asset-generation-worker.test.ts tools/openclinxr/encounter-publication-payloads.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts` (5 files, 29 tests).

## 2026-05-25 Worker 11/9 validation note - generated human variant rigging matrix
- Product lane: generated humanoid asset pipeline, rigging generality, and adversarial visual evidence.
- Change: generated-human rigging now supports `--body-profile` for adult, pediatric, older-adult kyphotic, and bariatric local static variants using the same Anny source and canonical Blender rig export path.
- Change: added `asset:human-rigging:variant-matrix` and validation tooling that requires every profile to preserve canonical bones, embodiment nodes, face/lip/gaze/blink controls, ragdoll/interaction proxies, and required morph targets.
- Adversarial lens: matrix report records `ux-friction-critic`, `clinical-safety-critic`, and `implementation-plan-gap-attacker` as required reviewers so future claims are tested against variety/readability/gap concerns instead of one-fixture success.
- Evidence: `docs/openclinxr/generated-human-rigging-variant-matrix-2026-05-25.json` plus screenshot artifact `docs/openclinxr/screenshots/generated-human-rigging-variant-matrix-2026-05-25.png`.
- Verification: `asset:human-rigging:variant-matrix`, `asset:human-rigging:variant-matrix:validate`, and `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts` passed.
- Boundary: local static rigging matrix evidence only; do not treat as runtime facial animation quality, Quest readiness, production art readiness, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - variant matrix visual-QA evidence attachment
- Product lane: humanoid realism evidence and adversarial visual QA.
- Change: generated-human rigging variant matrix screenshot is now represented as visual-QA evidence with required humanoid realism signal IDs, adversarial review checks, screenshot dimension validation, and explicit static-evidence limitations.
- Verification: `tsx tools/openclinxr/visual-qa-evidence-check.ts --input docs/openclinxr/visual-qa-evidence-generated-human-rigging-variant-matrix-2026-05-25.json --output docs/openclinxr/visual-qa-evidence-generated-human-rigging-variant-matrix-report-2026-05-25.json` and `tsx tools/openclinxr/visual-qa-evidence-check.ts --validate-latest` passed using the NVM/Corepack path.
- Boundary: temporal mouth/eye/gaze quality remains a runtime video evidence concern, not a static screenshot pass.

## 2026-05-25 Worker 9/11 validation note - emotion-aligned expression transitions
- Product lane: humanoid realism, facial animation, gaze/mouth evidence, and dynamic encounter factory runtime behavior.
- Change: UI-XR generated humanoid dialogue now has an explicit affect-transition state with eased expression weights for mouth, brow, and cheek morph targets.
- Change: copied humanoid speech evidence now carries active emotion state, transition elapsed time, expression weights, and `emotion_aligned_expression_transition_cue` so later video/screenshot QA can distinguish smooth affect behavior from generic facial activity.
- Adversarial review: live repo-agent critique using clinical-safety/UX-gap lens identified missing affect state machine, speech-only brow/cheek coupling, deterministic mouth behavior, and gaze realism gaps; this slice closes the first state/transition layer without overclaiming production quality.
- Verification: `pnpm --filter @openclinxr/ui-xr test -- --run apps/ui-xr/src/runtime-state.test.ts apps/ui-xr/src/static-assets.test.ts` and `pnpm --filter @openclinxr/ui-xr typecheck` passed.
- Boundary: this is deterministic local runtime behavior and evidence metadata, not validated clinical affect scoring, production facial animation quality, or Quest readiness.
- Next: generate affect timelines from encounter definitions/runtime bundles instead of relying only on text heuristics.

## 2026-05-25 Worker 9/11 validation note - runtime bundle affect timelines
- Product lane: dynamic encounter factory, humanoid facial affect, and generated runtime bundle metadata.
- Change: `EncounterRuntimeDialogueTurn` can now carry `affectTimeline` metadata with emotion, intensity, onset/transition/decay timing, evidence cue IDs, and explicit non-readiness/non-validity boundaries.
- Change: generated station bundles emit deterministic affect timelines, and UI-XR uses that metadata as the primary emotion target for humanoid expression transitions, falling back to text inference only for older bundles.
- Verification: generated bundle/asset-registry tests, targeted UI-XR tests, and UI-XR typecheck passed using the NVM/Corepack path.
- Boundary: affect timelines are encounter metadata and deterministic runtime cues, not validated clinical affect scoring, production facial animation quality, or Quest readiness.
- Next: expose affect-transition coverage in dry-run/publication summaries and keep temporal video evidence as the gate for smooth expression quality.

## 2026-05-25 Worker 9/11 validation note - affect coverage in dry-run summaries
- Product lane: dynamic encounter factory review posture and humanoid affect metadata.
- Change: dynamic behavior coverage now includes `affectTimelineCoverage` with actor-role coverage, missing roles, count, and a boundary that it is metadata only, not runtime facial animation evidence.
- Change: publication payload validation now enforces affect timeline coverage against required humanoid roles and emits deterministic `affect_timeline_missing:<role>` blockers.
- Change: ED local runtime and publication fixtures now carry affect timelines aligned with the generated-bundle contract.
- Verification: asset-registry/publication/generated-bundle tests and generated bundle/publication CLI validation passed with NVM/Corepack path.
- Boundary: affect metadata coverage is not temporal video proof, Quest readiness, production facial animation quality, clinical validity, or scoring validity.
- Next: expose affect coverage in admin/review surfaces and keep video evidence as the smooth-transition quality gate.

## 2026-05-25 Worker 9/11 validation note - admin affect coverage surface
- Product lane: admin review workflow, dynamic encounter factory, and humanoid affect metadata.
- Change: publication-readiness API/admin client data now carries affect actor-role coverage, missing affect-role blockers, affect timeline count, and explicit metadata-only facial-animation boundary.
- Change: the admin 3D environment queue dynamic behavior summary renders affect coverage alongside dialogue, gaze, and placement so reviewers can see affect metadata readiness without treating it as video/runtime proof.
- Verification: UI-admin EnvironmentGenerationQueuePanel/api-client focused tests, API app focused tests, UI-admin typecheck, and API typecheck passed with the NVM/Corepack path.
- Boundary: admin metadata surface only; not runtime facial-animation evidence, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - affect transition runtime-realism gate
- Product lane: humanoid realism evidence, dynamic asset pipeline, and review-gated runtime behavior.
- Change: `emotion_aligned_expression_transition_cue` is now required by runtime-realism evidence gates and humanoid realism validation across asset-registry, capability-gateway, encounter queue, worker, and publication payload tooling.
- Change: regenerated queue/publication docs now carry the stricter cue requirement so generated encounter assets must preserve smooth emotion-expression transition evidence before learner/runtime claims can advance.
- Verification: focused asset-registry/capability-gateway/queue/worker/publication tests passed, and `asset:encounter-queue:plan`, `asset:encounter-queue:validate`, `asset:encounter-publication:materialize`, and `asset:encounter-publication:validate` passed.
- Boundary: evidence-contract hardening only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - admin evidence gate signal visibility
- Product lane: admin review workflow and humanoid runtime-realism evidence gates.
- Change: the admin 3D environment queue evidence-gate summary now renders required signal IDs per gate so reviewers can see that smooth emotion-expression transition evidence is explicitly required.
- Verification: UI-admin EnvironmentGenerationQueuePanel focused tests and UI-admin typecheck passed.
- Boundary: review-surface visibility only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - visual QA emotion-transition evidence contract
- Product lane: humanoid realism evidence, facial affect transitions, and adversarial visual QA.
- Change: runtime-realism evidence now requires `emotion_aligned_expression_transition_cue` to be backed by active emotion state, expression transition timing, and mouth/brow/cheek expression weights.
- Change: visual-QA evidence now requires `emotion_expression_transition_readability` for humanoid realism reviews; screenshot/static evidence may carry concern-level review, but pass-level temporal claims require video.
- Evidence: regenerated `docs/openclinxr/visual-qa-evidence-generated-human-rigging-variant-matrix-report-2026-05-25.json` after adding the new signal and check to the source evidence file.
- Verification: focused runtime-realism/visual-QA tests and visual-QA latest validation passed.
- Boundary: evidence contract and static visual-QA metadata only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - UI-XR speech affect evidence panel
- Product lane: humanoid realism evidence capture and Quest/WebXR review workflow.
- Change: UI-XR manual evidence now renders speech affect status, active emotion transition timing, expression weights, and the emotion-transition cue state in the visible evidence panel.
- Verification: UI-XR static/runtime-state focused tests and UI-XR typecheck passed.
- Boundary: evidence surfacing only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - in-scene speech affect evidence line
- Product lane: WebXR evidence capture, humanoid affect realism, and visual QA.
- Change: the in-scene VR-readable `Input Evidence` panel now includes speech-affect transition status, making emotion-transition cues visible in screenshots/video captures rather than only in DOM/manual JSON.
- Verification: UI-XR static/runtime-state focused tests and UI-XR typecheck passed.
- Boundary: local runtime evidence visibility only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - visual-QA gate emotion-transition signal
- Product lane: humanoid visual QA, runtime evidence gates, and admin review workflow.
- Change: `visual_qa_evidence` gate required signals now include `emotion_expression_transition_readability` across shared asset-registry bundles, capability-gateway jobs, API readiness payloads, admin surfaces, and worker validation.
- Evidence: regenerated `docs/openclinxr/encounter-asset-generation-worker-2026-05-25.json` with the stricter visual-QA gate.
- Verification: focused asset-registry/capability-gateway/worker/API/UI-admin tests, API typecheck, UI-admin typecheck, and encounter worker run/validate scripts passed.
- Boundary: evidence-gate contract hardening only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - runtime-realism latest-report selector
- Product lane: runtime-realism evidence tooling and autonomous validation reliability.
- Change: runtime-realism evidence `--validate-latest` now selects the newest modified report rather than lexically newest path, preventing stale report validation after repeated same-day evidence iterations.
- Verification: runtime-realism evidence checker focused tests and latest-report validation passed.
- Boundary: local tooling reliability only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - runtime-realism stale-signal validation
- Product lane: runtime-realism evidence tooling and humanoid affect evidence gates.
- Change: runtime-realism report validation now requires each required signal to be present in either `passedSignals` or a matching missing-signal blocker.
- Evidence: added contract-level local evidence/report files for the complete required runtime-realism signal set, including `emotion_aligned_expression_transition_cue`.
- Verification: runtime-realism evidence checker focused tests and latest-report validation passed.
- Boundary: local evidence validation only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - runtime-realism boundary validation
- Product lane: runtime-realism evidence tooling and claim-boundary safety.
- Change: runtime-realism report validation now requires `notEvidenceFor` to include production asset readiness, Quest readiness, clinical validity, and scoring validity caveats.
- Verification: runtime-realism evidence checker focused tests and latest-report validation passed.
- Boundary: local evidence validation only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - UI-admin API client gate signal assertions
- Product lane: admin review workflow and evidence-gate contract coverage.
- Change: UI-admin API client tests now assert runtime-realism and visual-QA emotion-transition signal IDs across publication-readiness payloads.
- Verification: UI-admin API client focused tests and UI-admin typecheck passed.
- Boundary: client contract coverage only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - API gate signal assertions
- Product lane: API evidence-gate contract coverage and admin/replay handoff safety.
- Change: API tests now assert runtime-realism and visual-QA emotion-transition signal IDs in publication-readiness and runtime evidence gate refs.
- Verification: API app focused tests and API typecheck passed.
- Boundary: API contract coverage only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - generated bundle/publication refresh
- Product lane: generated runtime bundle, publication payload, and humanoid affect metadata.
- Change: regenerated ED station runtime bundle and encounter publication payload after the latest emotion-transition gate hardening.
- Evidence: generated runtime/public artifacts carry `emotion_aligned_expression_transition_cue` through affect timelines and humanoid runtime requirements; API/admin/worker gate refs enforce the paired visual-QA readability signal.
- Verification: generated station bundle run/validate, encounter publication materialize/validate, and targeted artifact signal search passed.
- Boundary: local generated artifact refresh only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 Worker 9/11 validation note - publication plan emotion-transition output refs
- Product lane: dynamic encounter factory publication metadata and worker handoff clarity.
- Change: publication dry-run plans now list both emotion-transition runtime-realism and visual-QA readability requirements in the publication/evidence-gate stage output refs.
- Verification: encounter publication payload focused tests plus materialize/validate scripts passed.
- Boundary: publication metadata only; not runtime video proof, Quest readiness, production facial-animation quality, clinical validity, or scoring validity.

## 2026-05-25 validation update: emotion-animation screencap proof
- Lane: Humanoid realism / emotion-aligned facial cue evidence.
- Completed: browser screencaps and JSON evidence showing active emotion state, expression transition duration, expression weights, and `emotion transition cue present` after `history opqrst`.
- Evidence: `docs/openclinxr/evidence/emotion-animation-screencap-proof-2026-05-25.json`.
- Follow-up validation: video/headset capture required before claiming smooth temporal animation quality.

## 2026-05-25 worker update: generated scene declutter
- Lane: Dynamic asset pipeline / learner runtime scene quality.
- Completed: primitive equipment fallback scaffolds now hide by default when a generated encounter scene manifest/environment is active.
- Boundary: fallback primitives are retained for non-generated scenes and explicit `fallback`, `debug`, or `cue-review` capture modes.
- Follow-up validation: next visual evidence pass should confirm only generated GLB equipment/environment, room manifest props, required actors, panels, and minimal floor anchor remain visible in normal dynamic encounter captures.

## 2026-05-25 worker update: 20-pass visual declutter loop
- Lane: Dynamic asset pipeline / encounter realism.
- Completed: browser-side 20-pass visible-scene inspection identified in-scene evidence panels as the dominant visible clutter.
- Implemented: normal generated encounter captures now hide in-scene clinical/dialogue/input evidence panels, actor/equipment nameplates, and primitive wall-clock fallback unless explicitly requested by capture mode.
- Implemented: scene-only visual review capture hides desktop runtime panel/status strip for `scene-only`, `dynamic-only`, and `visual-cleanup` captures.
- Follow-up validation: post-cleanup screenshot and hierarchy evidence should show fewer non-encounter overlays while preserving generated assets, humanoids, room props, and sidecar desktop controls.
- Final evidence: `docs/openclinxr/evidence/dynamic-encounter-cleanup-loop-final-2026-05-25.json`; screenshot `docs/openclinxr/screenshots/dynamic-encounter-cleanup-loop-final-2026-05-25.png`.
- Final 20th-pass result: no suspected visible overlay clutter, desktop chrome hidden for visual cleanup capture, generated scene assets loaded without fallback.

## 2026-05-25 worker update: visual intent refinement
- Lane: Humanoid realism / generated ED encounter composition.
- Implemented: generated-scene visual-review camera now uses a clinical-focus framing with less empty vertical space.
- Implemented: generated humanoid clinical conversation posture is applied continuously so authored placeholder clips cannot leave actors in an unnatural wide-arm stance.
- Implemented: scene-only visual review suppresses the locomotion trail marker after movement; actor placements now separate patient bedside, nurse workflow, and family/observer positions more clearly.
- Implemented: locomotion trail child meshes are hidden during scene-only visual review, preserving evidence in `window.__openClinXrExamineeLocomotionEvidence` without visual marker clutter.
- Follow-up validation: capture front/left/right/advanced learner-position screenshots and compare against intended ED encounter representation.
- Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts` passed (`4` files, `68` tests) after generated-scene declutter and scene-only visual review capture changes.
- Confirmed multi-position visual intent: `docs/openclinxr/evidence/dynamic-encounter-visual-intent-confirmed-multi-position-2026-05-25.json` reports scene-only canvas, 4/4 generated assets loaded, no fallback, all three actor roots visible, 97 clinical objects, and no forbidden debug/nameplate/locomotion overlays across front/forward/left/right moved views.

## 2026-05-25 worker update: adversarial realism refinement
- Lane: Humanoid realism / ED scene believability.
- Evidence: `docs/openclinxr/evidence/dynamic-encounter-visual-iteration-20x-2026-05-25.json` completed 20 moved/dialogue views with structural pass criteria.
- Adversarial finding: structural pass did not equal AAA-style realism; patient role, actor identity, and prop fidelity still needed sharper scenario-specific cues.
- Implemented: role-specific patient/nurse/family posture and clothing cues plus essential-prop pruning for scene-only visual review.
- Role-accent validation: `docs/openclinxr/evidence/dynamic-encounter-role-accent-20x-2026-05-25.json` passed role-cue/no-debug-overlay/loaded-asset checks across 20 views; screenshots stored under `docs/openclinxr/screenshots/visual-iteration-role-accent-2026-05-25/`.
- Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts` passed (`4` files, `68` tests).
- Residual adversarial realism gap: cue overlays are a bridge, not final asset realism. Next implementation should materialize generated role-specific clothed humans and a true reclined chest-pain patient animation/pose asset.

## 2026-05-25 worker update: next realism build target
- Lane: Dynamic asset pipeline / humanoid realism.
- Next target: convert role identity from temporary runtime accent cues into encounter-factory asset requirements and work orders for generated patient, nurse, and spouse humanoid variants.
- Validation target: generated asset manifests must distinguish model, clothing, pose/animation, face/gaze/lip-sync requirements, and evidence gates before learner-runtime use.

## 2026-05-25 worker update: adversarial feedback to generation work orders
- Lane: Dynamic encounter factory / humanoid realism / scalable asset pipeline.
- Completed: encounter asset-generation plans now include reusable work orders for role-specific humanoid GLBs, animation/facial/gaze/lip-sync bundles, semantic medical equipment GLBs, and adversarial visual-feedback closure.
- Completed: each work order is policy-bound as metadata-only with no paid/cloud API use, no external network, no secrets, and no production/Quest/clinical/scoring readiness claim.
- Validation: capability-gateway and encounter queue focused tests passed (`2` files, `26` tests).
- Residual work: publication payloads and worker execution reports should surface these work orders so long-running local/open-source/provider-approved generators can consume them across many encounters.

## 2026-05-25 worker update: publication dry-run work-order handoff
- Lane: Dynamic encounter factory / review workflow / scalable asset pipeline.
- Completed: publication dry-run plans now preserve asset-generation work orders and add a routing stage for generated humanoids, animation, equipment, and adversarial visual-feedback closure.
- Completed: validation enforces metadata-only provider policy boundaries and required work-order families in the dry-run handoff.
- Validation: publication payload, encounter queue, and capability-gateway focused tests passed (`3` files, `33` tests).
- Residual work: convert visual-QA evidence blocker reports into automatically attached remediation refs for each work-order family.

## 2026-05-25 worker update: visual-QA blockers to remediation refs
- Lane: Evidence-gated visual realism / worker-adversarial improvement loop.
- Completed: visual-QA blocked findings can now be converted into metadata-only remediation work-order refs for humanoid generation, facial/lip-sync/gaze animation, role idle animation, medical equipment generation, or visual feedback closure.
- Completed: remediation refs include source evidence, scenario ID, blocker ID, target kind, capability ID, recommended worker action, and readiness/validity caveats.
- Validation: visual-QA evidence checker and publication payload focused tests passed (`2` files, `24` tests).
- Residual work: integrate remediation refs into persisted worker/evidence reports and trigger them from the screenshot/video review loop.

## 2026-05-25 worker update: shared asset library/LRU reuse contract
- Lane: Dynamic encounter factory / shared asset reuse / provider gates.
- Implemented: generation work orders now include encounter-derived shared asset library lookup keys, shared Blob/Mongoose refs, and LRU lookup-before-generate policy.
- Boundary: no external provider execution, no paid/cloud API use, and no readiness claims are enabled by this metadata.
- Next: add provider registry entries for Hunyuan3D, Meshy, Tripo, and VLM adversarial review as planned/blocked routes.

## 2026-05-25 worker update: external AI provider registry gates
- Lane: Provider gates / dynamic asset pipeline / adversarial refinement.
- Implemented: Hunyuan3D, Meshy, Tripo, and VLM adversarial reviewer candidates are represented in the capability routing matrix as planned/blocked provider routes.
- Implemented: local-development remains deterministic/no paid-cloud; production cloud candidates are blocked behind explicit approval, privacy, cost, credential, license, and evidence controls.
- Validation: capability-gateway, asset-generation jobs, and queue focused tests passed (`3` files, `37` tests).
- Residual work: deterministic shared asset library resolver/evidence report and later approved provider adapters.

## 2026-05-25 worker update: shared asset cache evidence experiment
- Lane: Dynamic encounter factory / shared asset library / LRU reuse.
- Completed: deterministic evidence harness proves work-order cache hit, miss, recency update, and LRU eviction semantics using encounter-derived semantic lookup keys.
- Evidence: `docs/openclinxr/shared-asset-library-cache-evidence-2026-05-25.json` validated successfully.
- Validation: shared cache evidence tests and related focused queue/capability tests passed.
- Residual work: wire shared-library resolver into encounter worker execution so approved generated assets can be reused across encounters before invoking any generation provider.

## 2026-05-25 worker update: shared-library cache events in worker execution
- Lane: Dynamic encounter factory / shared asset reuse / worker execution.
- Completed: encounter worker execution metadata now records shared asset cache hits, misses, and LRU eviction events per generation work order.
- Completed: compatible cached assets can be represented as `cache_hit_reuse_generation_skipped` before provider work is invoked.
- Validation: capability-gateway asset worker tests, shared cache evidence tests, and encounter queue tests passed (`3` files, `31` tests).
- Residual work: surface cache events in CLI worker reports and publication dry-run summaries.

## 2026-05-25 worker update: provider routing preference metadata
- Lane: External AI experimentation / dynamic asset pipeline / provider gates.
- Completed: work orders now carry explicit provider preference order for humanoid mesh/rig, equipment/props, and adversarial review, matching the recommended integration order.
- Boundary: provider routing is metadata only; Meshy, Tripo, Hunyuan3D, and cloud VLM execution remain disabled until approval/evidence gates are satisfied.
- Validation: capability-gateway, queue, publication, and worker focused tests passed (`4` files, `39` tests).

## 2026-05-25 worker update: regenerated asset-pipeline metadata artifacts
- Lane: Dynamic encounter factory / shared asset reuse / provider routing metadata.
- Completed: regenerated queue, worker, shared-library cache, and publication payload reports so current repo artifacts include cache reuse events and provider-routing preferences.
- Validation: encounter queue, encounter worker, shared-library cache evidence, and publication payload validators passed.
- Residual work: provider preflight evidence for Hunyuan3D/Meshy/Tripo/VLM routes before any provider execution.

## 2026-05-25 worker update: external AI provider preflight evidence
- Lane: External AI experimentation / provider gates / adversarial refinement.
- Completed: provider preflight report records Hunyuan3D, Meshy, Tripo, and VLM reviewer candidates without enabling execution, network, paid API use, or credentials.
- Evidence: `docs/openclinxr/external-ai-asset-provider-preflight-2026-05-25.json` validated successfully.
- Validation: external provider preflight, capability-gateway, and asset-generation job focused tests passed (`3` files, `36` tests).
- Residual work: surface preflight blockers in provider-gate summaries and worker/publication artifacts.

## 2026-05-25 - provider gate/cache validation worker updates

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| External provider gate preflight | Added metadata-only provider gate fields proving external execution remains disabled and surfaced for review. | `vitest run tools/openclinxr/external-ai-asset-provider-preflight.test.ts`; regenerated and validated `docs/openclinxr/external-ai-asset-provider-preflight-2026-05-25.json`. | Continue only with metadata/refusal boundaries unless operator approves live provider/runtime execution. |
| Shared asset library cache validation | Worker/publication validations now require shared cache summaries to match persisted cache events and preserve lookup-before-generate metadata. | `vitest run tools/openclinxr/encounter-asset-generation-worker.test.ts tools/openclinxr/encounter-publication-payloads.test.ts`. | Feed the cache metadata into dynamic encounter factory manifests and visual review evidence. |

## 2026-05-25 - asset manifest and visual realism evidence worker updates

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Dynamic encounter asset manifest | Encounter definitions now have a stronger asset-needs/readiness basis for humanoids, equipment, room/environment, animation/emotion/gaze/lip-sync, and shared semantic-key reuse. | `vitest run packages/openclinxr/asset-registry/src/asset-registry.test.ts`. | Wire manifest expectations into scenario-bank fixture expansion and encounter publication metadata. |
| Adversarial runtime realism evidence | Deterministic criteria now cover gaze, eyes, lips/visemes, smooth emotion transitions, locomotion, equipment necessity, and clutter removal. | `vitest run tools/openclinxr/runtime-realism-evidence-check.test.ts`. | Feed criteria into screenshot/evidence loops and XR trace/locomotion instrumentation. |

## 2026-05-25 - active OpenClaw assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Scenario-bank expansion | `packages/openclinxr/scenario-fixtures`, `packages/openclinxr/shared-schemas`, `packages/openclinxr/domain`, `docs/openclinxr/*case*`; no UI, Quest, provider, or asset materialization changes. | Focused scenario fixture/schema validation. |
| XR trace/locomotion instrumentation | `apps/ui-xr`, optional IWSDK/Quest evidence tooling only; no scenario fixture/schema/domain changes. | Focused UI-XR validation or evidence-tool validation for touched files. |

## 2026-05-25 - scenario fixture and XR diagnostic updates

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Scenario-bank expansion | `peds_asthma_parent_anxiety_v1` now carries richer schema-aligned asset needs for nurse actor and respiratory-care room equipment. | `vitest run packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`. | Feed scenario asset needs into encounter factory/publication outputs and shared asset library reuse keys. |
| UI-XR trace diagnostics | Hand-select trace blocked reasons now surface as explicit readiness blockers for headset evidence triage. | `vitest run apps/ui-xr/src/runtime-state.test.ts`. | Extend observability to locomotion or screenshot evidence only when it verifies a changed product path. |

## 2026-05-25 - active continuation assignments after scenario/XR slices

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Scenario-to-factory manifest wiring | Scenario fixtures, asset registry, encounter-factory/publication metadata only; no UI-XR, Quest capture, provider preflight, or runtime realism evidence changes. | Focused factory/publication/scenario metadata preservation tests. |
| XR realism evidence capture | UI-XR plus copied/manual evidence payload and runtime evidence checker path only; no scenario/asset-registry/publication/provider changes. | Focused UI-XR/evidence-check tests proving new diagnostics are captured. |

## 2026-05-25 - scenario-to-factory publication integration fix

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Scenario-to-factory publication wiring | Queue/publication artifacts now preserve encounter asset-needs readiness manifests, and the ED scenario declares spouse/equipment asset needs needed for materialized local payloads. | `vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts tools/openclinxr/encounter-publication-payloads.test.ts`; regenerated and validated queue/publication artifacts. | Extend manifest wiring to another scenario and connect shared asset reuse/evidence summaries. |
| XR runtime interaction evidence capture | UI-XR runtime evidence now captures fresh locomotion, hand-select, and humanoid realism signals into copied/manual evidence payloads with stale-evidence guarding. | `vitest run apps/ui-xr/src/runtime-state.test.ts`. | Use screenshot/Quest evidence only when verifying changed runtime interaction paths. |

## 2026-05-25 - active follow-on assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Dynamic encounter factory maturity | Docs/shared schemas/scenario-factory manifest layer only; no XR runtime, asset-generation code, admin UI, or asset evidence files. | Narrow schema/fixture/factory validation. |
| Humanoid/asset realism evidence | Asset-production evidence/provenance/manifest/reporting path only; no scenario schemas, factory publication logic, review UI, or XR runtime. | Focused asset-lane validation. |

## 2026-05-25 - dynamic factory schema and ED equipment realism evidence

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Dynamic encounter factory projection | Shared schemas now validate dynamic factory planning projections and shared asset reuse envelopes; scenario projection records selection mode and approved-variant preference. | `vitest run packages/openclinxr/shared-schemas/src/schemas.test.ts packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts tools/openclinxr/encounter-asset-generation-queue.test.ts tools/openclinxr/encounter-publication-payloads.test.ts`. | Emit/consume projection artifacts across additional scenario variants. |
| ED equipment realism evidence | Medical equipment artifacts now include a realism manifest and shared-library provenance references for the ED equipment lane. | `vitest run tools/openclinxr/medical-equipment-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`. | Add humanoid-specific realism manifest/evidence with gaze/lip-sync/expression posture. |

## 2026-05-25 - active humanoid realism/projection continuation

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| ED humanoid realism evidence | Asset-production evidence/provenance/manifest/reporting path for one named humanoid only; no scenario schema, factory publication, XR runtime, review UI, or equipment artifact changes. | Focused humanoid asset-lane validation. |
| Next-slice coordinator | Read-only selection of disjoint next work after projection/equipment slices. | Concise assignments only. |

## 2026-05-25 - ED humanoid realism evidence

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| ED humanoid realism evidence | Generated-human rigging lane now includes a humanoid realism manifest for rigging, gaze/eyes, lips/visemes, expression transitions, clothing, pose/locomotion, collision/proxy posture, and shared asset reuse. | `vitest run tools/openclinxr/asset-production-artifact-evidence.test.ts tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`. | Connect projection artifacts across additional scenarios without editing asset evidence lanes. |

## 2026-05-25 - projection artifact publication support

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Projection artifact publication | Publication tooling can consume dynamic factory projection artifacts, synthesize queue reports, and propagate projection metadata into publication outputs for additional variants. | `vitest run packages/openclinxr/shared-schemas/src/schemas.test.ts packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts tools/openclinxr/encounter-asset-generation-queue.test.ts tools/openclinxr/encounter-publication-payloads.test.ts`. | Expand projection artifact emission/consumption to more scenario fixtures and summarize shared asset reuse across projections. |

## 2026-05-25 - active shared summary and humanoid gate assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Shared factory summary contracts | Runtime bundle summary contracts, publication summary tooling, API, and admin client only; no asset-generation jobs or queue validation files. | Focused runtime-bundles/publication/API/admin tests. |
| Humanoid realism gate hardening | Capability-gateway asset generation jobs and encounter queue validation only; no summary contracts, publication tooling, API, or admin files. | Focused asset-generation-jobs and encounter queue tests. |

## 2026-05-25 - shared summaries and humanoid gate hardening

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Shared factory summaries | Behavior coverage and dry-run summaries are canonicalized across runtime bundle utilities, publication tooling, API, and admin client surfaces. | `vitest run packages/openclinxr/asset-registry/src/runtime-bundles.test.ts tools/openclinxr/encounter-publication-payloads.test.ts apps/api/src/app.test.ts`. | Expose projection/factory summary status in admin or generated docs without duplicating contract shapes. |
| Humanoid realism gates | Queue/request validation now rejects duplicate/missing/mismatched humanoid realism roles and missing realism profile objects. | `vitest run packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts tools/openclinxr/encounter-asset-generation-queue.test.ts`. | Reuse these gates before any humanoid materialization or further scenario expansion. |

## 2026-05-25 - active admin parity and multi-scenario artifact assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Admin projection/factory status parity | Admin surfaces and admin-only view model glue only; no runtime/publication/API/docs artifacts/provider/asset evidence edits. | Focused admin validation/tests. |
| Multi-scenario factory loop docs/artifacts | Docs, generated artifact directories, artifact-generation config only; no admin UI/runtime/publication/API/provider/asset evidence code edits. | Focused artifact/docs validation. |

## 2026-05-25 - multi-scenario factory loop artifacts

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Multi-scenario factory loop docs/artifacts | Projection, queue, publication, and v2 runtime bundle docs artifacts now align to `ed_chest_pain_priority_v2` and preserve factory-selection metadata. | `asset:encounter-queue:validate --validate docs/openclinxr/encounter-asset-generation-queue-2026-05-25.json`; `asset:encounter-publication:validate --validate docs/openclinxr/encounter-publication-payloads-2026-05-25.json`. | Continue admin-side status parity and then expose artifact status without regenerating stale evidence. |

## 2026-05-25 - admin projection/factory status parity

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Admin projection/factory status parity | Admin scene-generation request panel now surfaces projection/factory status parity through an admin view-model path. | `node ./node_modules/vitest/vitest.mjs run --config /tmp/vitest-ui-admin.config.ts apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`. | Extend admin status summaries to projection artifact status without changing API/runtime contracts unless needed. |

## 2026-05-25 - active projection status/artifact expansion assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Admin projection artifact status | `apps/ui-admin/src/*` only; no tools/docs/runtime/API/provider/asset evidence edits. | Focused admin TSX test/check already used for parity. |
| Projection artifact expansion | `tools/openclinxr/*`, `docs/openclinxr/*`, specific scenario/queue/publication artifacts only; no admin/UI/XR/API/provider/asset evidence edits. | Focused artifact, queue, and publication validation. |

## 2026-05-25 - admin projection artifact status and v3 projection expansion

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Admin projection artifact status | Admin summary row now displays projection artifact status and runtime asset review decision count from existing parity data. | Focused `EnvironmentGenerationQueuePanel.test.tsx` check with working Node runtime. | Extend only if another admin status gap appears; otherwise move to XR/evidence quality. |
| Projection artifact expansion | Projection/queue/publication artifacts now include `ed_chest_pain_priority_v3` and summarize shared asset reuse across v1/v2/v3. | Scenario fixture, queue, publication tests plus queue/publication/projection artifact validators. | Use the expanded projection set for operational asset pipeline/evidence loops. |

## 2026-05-25 - active XR foreground and local benchmark assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| XR foreground performance capture | Quest foreground evidence artifacts/manual reports only; no projection metadata, benchmarks, provider gates, asset evidence, or scenario fixture edits. | Focused evidence validation or explicit nonblocking blocker note. |
| Local model runtime benchmark refresh | Local model benchmark evidence/runtime notes only; no XR foreground artifacts, projection metadata, provider gates, asset evidence, or scenario fixture edits. | Focused benchmark validation or explicit nonblocking blocker note. |

## 2026-05-25 - XR foreground draft and local benchmark refresh

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| XR foreground performance capture | Draft evidence report created and headset-capture requirement recorded without false readiness claims. | JSON parse validation for `docs/openclinxr/quest-manual-performance-2026-05-25.json`. | Complete live headset foreground capture when physical/operator conditions are available. |
| Local model runtime benchmark refresh | Fresh Qwen3-4B/llama.cpp local runtime benchmark captured with latest runtime notes. | Benchmark parse validation plus JSON parse validation for `docs/openclinxr/local-model-runtime-benchmark-2026-05-25.json`. | Use fresh latency/token evidence in local voice/model strategy decisions. |

## 2026-05-25 - active non-headset evidence operationalization assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Visual realism loop readiness | Runtime/evidence checker files and visual evidence docs/artifacts only; no projection/admin/API/scenario/provider/asset-generator edits. | Focused runtime/evidence checker validation. |
| Asset pipeline operationalization | Asset pipeline queue/work-order docs/tools and shared asset library operational notes only; no admin/XR/projection/scenario/visual-checker edits. | Focused artifact/tool validation or JSON/doc validation. |

## 2026-05-25 - visual remediation loop readiness and asset pipeline operational notes

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Visual remediation loop readiness | Visual QA reports can now summarize blockers into deterministic remediation categories/work-order inputs without live headset capture, while preserving temporal evidence boundaries. | `vitest run tools/openclinxr/visual-qa-evidence-check.test.ts`. | Emit loop-readiness summaries into generated evidence artifacts and use them to drive remediation work orders. |
| Asset pipeline operational notes | Worker executions now derive queue-stage and shared-library reuse operational notes for long-running generation/refinement loops. | `vitest run packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`. | Surface these notes in worker reports or generated asset pipeline status summaries. |

## 2026-05-25 - active admin maturity and provider-disabled orchestration assignments

| Worker lane | Scope guard | Expected verification |
| --- | --- | --- |
| Admin maturity/report surfacing | `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`, `api-client.ts`, `App.test.tsx` only; no queue/publication/projection/XR/provider/asset-evidence edits. | Focused admin tests proving metadata-only language. |
| Provider-disabled orchestration reports | Encounter queue/report contract only; no admin/XR/projection docs/scenario fixture/asset evidence generator edits. | Focused queue/report validation rejecting overclaiming and preserving provider-disabled boundary. |

## 2026-05-25 - admin maturity surfacing and provider-disabled queue boundaries

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Admin maturity/report surfacing | Scenario Bank Maturity panel now displays richer report-backed maturity signals with explicit no-Quest/no-learner/no-production-readiness boundary language. | `vitest run apps/ui-admin/src/App.test.tsx`. | Keep admin surfaces aligned with report contracts; do not add readiness claims without evidence. |
| Provider-disabled orchestration reports | Queue report now surfaces provider-disabled/local-only boundaries and exact missing evidence, and rejects overclaiming. | `vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts`. | Propagate these boundary notes into publication/worker reports if needed. |

## 2026-05-25 - publication/worker-report blocker propagation

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Publication/worker-report propagation | Publication readiness and worker progress reports now share the same next asset/publication blocker name, and the owned operator docs now mirror the provider-disabled/local-only boundary labels plus their exact missing evidence IDs on both surfaces: `provider_credentials_or_operator_approval_missing`, `provider_runtime_evidence_missing`, `local_blender_ffmpeg_toolchain_evidence_missing`, `hunyuan3d_local_install_license_cache_evidence_missing`, `shared_asset_library_lru_reuse_evidence_missing`, `azurite_or_queue_emulator_evidence_missing`, and `durable_job_checkpoint_evidence_missing`. | Doc-only check of the owned operator docs. | Keep the blocker name and boundary labels consistent across publication and worker progress surfaces; do not widen schema/runtime behavior. |

## 2026-05-25 - publication blocker propagation and visual remediation artifact

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Publication/worker blocker propagation | Plan/backlog now name the same next shared asset/publication blocker for operator-visible continuity. | Doc-only presence check from worker plus append-only handoff. | Keep report blockers aligned as publication/worker reports evolve. |
| Visual remediation artifact emission | Added a mouth/gaze/pose/posture remediation placeholder video plus matching evidence JSON for the humanoid review loop. | File existence plus JSON parse validation. | Run/extend visual QA checker consumption against this artifact when ready. |

## 2026-05-25 - visual remediation evidence consumption and provider-disabled blocker alignment

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Visual remediation evidence consumption | Desktop remediation artifacts normalize into standard visual QA evidence and structured remediation loop inputs without Quest-readiness claims. | `vitest run tools/openclinxr/visual-qa-evidence-check.test.ts`. | Feed normalized remediation inputs into asset work-order planning. |
| Provider-disabled blocker alignment | Plan/backlog now carry provider-disabled/local-only boundaries, exact missing evidence IDs, and shared blocker naming. | Focused content validation by worker. | Keep publication/worker/admin blockers aligned as reports evolve. |

## 2026-05-25 - visual remediation work-order planning and provider-boundary report alignment

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Visual remediation work-order planning | Normalized visual remediation inputs now become metadata-only asset work-order planning envelopes with explicit non-readiness boundaries. | `vitest run tools/openclinxr/visual-qa-evidence-check.test.ts packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`. | Surface these plans in generated reports or queue them as provider-disabled remediation planning records. |
| Provider-boundary report alignment | Publication and worker reports now use shared provider-disabled/local-only boundary notes and reject missing evidence drift/overclaiming. | `vitest run tools/openclinxr/encounter-publication-payloads.test.ts tools/openclinxr/encounter-asset-generation-worker.test.ts`. | Keep queue/publication/worker/admin blocker labels aligned as execution reports evolve. |

## 2026-05-25 - remediation report surfacing and provider handoff artifact

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Remediation report surfacing | Visual QA evidence reports now include metadata-only `remediationWorkOrderRefs` for normalized remediation artifacts. | `vitest run tools/openclinxr/visual-qa-evidence-check.test.ts`. | Feed remediation refs into queue/publication artifacts or provider-disabled planning. |
| Provider-disabled handoff artifact | External provider preflight artifact now carries provider-disabled/local-only boundaries, missing evidence IDs, and next safe provider-disabled step. | JSON/key validation for `docs/openclinxr/external-ai-asset-provider-preflight-2026-05-25.json`. | Keep provider execution disabled until missing evidence and approvals are resolved. |

## 2026-05-25 - remediation refs in reports and hardened provider-disabled handoff

| Worker lane | Product advancement | Verification | Next handoff |
| --- | --- | --- | --- |
| Remediation refs in reports | Publication and worker reports now carry metadata-only remediation refs for visual remediation artifacts. | `vitest run tools/openclinxr/encounter-publication-payloads.test.ts tools/openclinxr/encounter-asset-generation-worker.test.ts`. | Regenerate affected artifacts and keep refs metadata-only. |
| Hardened provider-disabled handoff | External provider preflight builder/validator now enforce exact provider-disabled/local-only boundaries and missing evidence IDs. | `vitest run tools/openclinxr/external-ai-asset-provider-preflight.test.ts`. | Keep provider execution hard-disabled until approvals and evidence are present. |

- 2026-05-25 Worker 9 XR/IWSDK sidecar locomotion observability: `apps/ui-xr-iwsdk-spike/src/main.ts` publishes `locomotionDelta` with from/to/delta pose, distance, and turn radians when movement is accepted. `tools/openclinxr/quest-cdp-smoke.ts` now carries that delta through manual-harvest signal snapshots, and `tools/openclinxr/check-quest-manual-performance.ts` preserves the sanitized delta in copied-payload harvest summaries. Validation: focused IWSDK sidecar tests/typecheck and Quest manual-harvest tests passed. Boundary: sidecar/local evidence only; no Quest refresh, no production runtime adoption, and no physical headset readiness claim.

- 2026-05-25 Worker 7/8 completed-station faculty review: `packages/openclinxr/review-workflow/src/faculty-review-path.ts` now uses a review-path packet contract compatible with admin replay packets that include nullable actor/tag metadata, and `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`/test surface explicit timeline latest-second plus patient-note posture. Validation: `vitest run packages/openclinxr/review-workflow/src/faculty-review-path.test.ts` and `pnpm --filter @openclinxr/ui-admin test -- FacultyReviewDecisionPanel.test.tsx` passed. Caveat: `pnpm --filter @openclinxr/ui-admin typecheck` remains blocked by unrelated EnvironmentGenerationQueuePanel fixture and asset-registry generic typing failures, not the faculty-review change.

- 2026-05-25 Worker 4/2 scenario-bank to encounter-factory bridge: `packages/openclinxr/shared-schemas/src/schemas.ts` and `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts` now carry `encounterFactoryInputSummary` on dynamic factory planning scenarios. It derives asset work-order counts, semantic shared-library lookup keys, and dynamic behavior trace tags from scenario definitions plus dialogue seeds. Validation: `vitest run packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts packages/openclinxr/shared-schemas/src/schemas.test.ts`, `pnpm --filter @openclinxr/scenario-fixtures typecheck`, and `pnpm --filter @openclinxr/shared-schemas typecheck` passed. Boundary: metadata/planning contract only; no generated assets, cloud provider calls, learner-use, Quest, or clinical-validity claims.

- 2026-05-25 Worker 11 asset-pipeline work-order bridge: `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts` accepts optional `encounterFactoryInputSummary` on executable encounter asset requests and threads semantic actor/equipment/environment keys plus dynamic behavior trace tags into work-order cache keys and input refs. Validation: `vitest run packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts` and `pnpm --filter @openclinxr/capability-gateway typecheck` passed. Boundary: metadata-only work-order planning; external/provider execution remains disabled and no assets were materialized.

- 2026-05-25 Worker 11 asset-registry dry-run bridge: `packages/openclinxr/asset-registry/src/runtime-bundles.ts` adds `EncounterFactoryInputPlanningSummary` and wires it into encounter factory summary contracts when scenario-derived `encounterFactoryInputSummary` is present. Validation: `vitest run packages/openclinxr/asset-registry/src/runtime-bundles.test.ts` passed. Caveat: `pnpm --filter @openclinxr/asset-registry typecheck` remains blocked by unrelated existing `asset-registry.test.ts` and `src/index.ts` type errors. Boundary: metadata-only, no provider execution, no materialized assets, no readiness claims.

- 2026-05-25 Worker 11 admin factory-input visibility: `apps/ui-admin/src/api-client.ts` and `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx` now carry and display `inputPlanningSummary` for scene-generation publication readiness. Validation: `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx` passed. Caveat: `pnpm --filter @openclinxr/ui-admin typecheck` remains blocked by existing EnvironmentGenerationQueuePanel fixture completeness and asset-registry generic typing errors. Boundary: operator metadata only; no provider execution, generated assets, learner runtime enablement, Quest claim, or production claim.

### 2026-05-25 validation update - asset-registry ED required-asset alignment

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / asset registry | ED chest pain required-asset alignment for placeholder manifests, evidence fixtures, environment packets, and scene work orders | `packages/openclinxr/asset-registry/src/index.ts`, `packages/openclinxr/asset-registry/src/asset-registry.test.ts` | `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts runtime-bundles.test.ts` | Passed |

### 2026-05-25 validation update - provider-disabled humanoid remediation planning

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Asset pipeline / humanoid realism | Provider-disabled remediation planning for gaze, mouth/viseme, pose, posture/collision, clothing, and shared asset reuse | `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`, `packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`, `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `packages/openclinxr/asset-registry/src/runtime-bundles.test.ts` | `pnpm --filter @openclinxr/capability-gateway typecheck`; `pnpm --filter @openclinxr/capability-gateway test -- asset-generation-jobs.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/asset-registry test -- runtime-bundles.test.ts` | Passed |
| Scenario bank / encounter factory | Deterministic factory-selection metadata for pediatric asthma as next planning scenario | `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`, `packages/openclinxr/shared-schemas/src/schemas.ts`, `packages/openclinxr/shared-schemas/src/schemas.test.ts` | Subagent reported scenario-fixtures/shared-schemas tests and typechecks passed under Node v24.15.0 | Passed |

### 2026-05-25 validation update - factory-selection metadata bridge groundwork

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Encounter factory / runtime planning | Preserve scenario-bank factory-selection role, mode, order, and review-gated claim boundary in capability-gateway and runtime input-planning contracts | `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`, `packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`, `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `packages/openclinxr/asset-registry/src/runtime-bundles.test.ts` | `pnpm --filter @openclinxr/capability-gateway typecheck`; `pnpm --filter @openclinxr/capability-gateway test -- asset-generation-jobs.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/asset-registry test -- runtime-bundles.test.ts` | Passed |

### 2026-05-25 validation update - admin/faculty remediation planning visibility

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin/review workflow | Surface runtime remediation plan refs and provider-disabled remediation metadata in faculty/review panels with explicit metadata-only boundaries | `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`, `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- FacultyReviewDecisionPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - queue report factory-selection bridge

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Encounter factory / queue reports | Carry projection factory-selection metadata into asset-generation queue reports and request summaries | `tools/openclinxr/encounter-asset-generation-queue.ts`, `tools/openclinxr/encounter-asset-generation-queue.test.ts` | `pnpm vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts`; `pnpm --filter @openclinxr/capability-gateway typecheck` | Passed |

### 2026-05-25 validation update - admin factory-selection planning visibility

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin / encounter factory | Show factory-selection role, scenario order, mode, and review-gated claim boundary in environment-generation readiness panel | `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - review-safe XR trace interaction summary

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| XR trace interaction / review workflow | Derive review-safe XR trace action summary and attach it to faculty review packet timeline/trace-quality evidence | `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/runtime-state.test.ts`, `packages/openclinxr/review-workflow/src/review-packet.ts`, `packages/openclinxr/review-workflow/src/review-packet.test.ts` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts`; `pnpm --filter @openclinxr/review-workflow typecheck`; `pnpm --filter @openclinxr/review-workflow test -- review-packet.test.ts` | Passed for focused tests/typecheck; full ui-xr typecheck blocked by existing `latestRuntimeInteractionEvidence` scope issue |

### 2026-05-25 validation update - API/admin XR trace evidence handoff

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| XR trace interaction / admin review | Carry review-safe XR trace evidence summary from API replay-readiness projection into admin replay/faculty panels without Quest, score-use, or clinical-validity claims | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.test.tsx`, `apps/ui-admin/src/App.test.tsx`, `apps/ui-xr/src/main.ts` | `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx FacultyReviewDecisionPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck`; `pnpm --filter @openclinxr/ui-xr typecheck` | Passed |

### 2026-05-25 validation update - adversarial boundary hardening and UI-XR trace instrumentation

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Boundary safety / review workflow | Tighten XR trace handoff, faculty-review readiness, scoring-draft copy, and GraphQL raw-payload warnings after adversarial review | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`, `apps/ui-admin/src/App.test.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.test.tsx`, `packages/openclinxr/review-workflow/src/faculty-review-path.ts`, `packages/openclinxr/review-workflow/src/review-packet.ts`, `packages/openclinxr/review-workflow/src/review-packet.test.ts`, `packages/openclinxr/graphql/src/schema.graphql` | `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx FacultyReviewDecisionPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |
| XR trace interaction / UI-XR | Show latest trace-interaction evidence in UI-XR and include review-safe trace interaction summary in copied manual evidence payloads | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/runtime-state.test.ts`, `apps/ui-xr/src/static-assets.test.ts` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Passed |

### 2026-05-25 validation update - second-station factory metadata and replay-packet hardening

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Scenario bank / dynamic encounter factory | Add safety-critical trace, rubric, and reviewer-role metadata counts to second-station pediatric asthma factory planning | `packages/openclinxr/shared-schemas/src/schemas.ts`, `packages/openclinxr/shared-schemas/src/schemas.test.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts` | `pnpm --filter @openclinxr/shared-schemas test -- schemas.test.ts`; `pnpm --filter @openclinxr/shared-schemas typecheck`; `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank.test.ts`; `pnpm --filter @openclinxr/scenario-fixtures typecheck` | Passed |
| Review workflow / replay evidence | Withhold learner/model private payload text from replay timeline summaries and attach durable event refs only from approved durable-event fields | `packages/openclinxr/review-workflow/src/review-packet.ts`, `packages/openclinxr/review-workflow/src/review-packet.test.ts` | `pnpm --filter @openclinxr/review-workflow test -- review-packet.test.ts`; `pnpm --filter @openclinxr/review-workflow typecheck` | Passed |

### 2026-05-25 next prioritized seam - review-approved encounter launch

| Lane | Product advancement | Boundary | Next handoff |
| --- | --- | --- | --- |
| Encounter launch / learner runtime | Connect reviewed/scenario-selected station state to a learner-safe selectable runtime bundle loaded by opaque bundle id with static local fixture fallback | No new humanoid gates, no Quest refresh, no production asset readiness claim, no cloud/Azure live work, no clinical-validity or score-use claim | Implement the thinnest route/contract/UI-XR boot seam that proves scenario/review/factory work can select what the learner launches |

### 2026-05-25 validation update - review-approved encounter launch seam

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Encounter launch / learner runtime | Add scenario/station-aware opaque bundle summaries and UI-XR scenario/station bundle lookup fallback before static fixture fallback | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-xr/src/api-client.ts`, `apps/ui-xr/src/api-client.test.ts`, `apps/ui-xr/src/main.ts` | `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/ui-xr test -- api-client.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Passed |

### 2026-05-25 validation update - admin review-safe learner launch affordance

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / learner launch | Surface a review-safe learner runtime launch link using opaque bundle id, scenario id, and station id while preserving evidence gates and no-readiness boundaries | `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - encounter-factory worker materialization plan

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / worker handoff | Add deterministic metadata-only materialization plans for generation work orders under `.openclinxr/encounter-factory/<scenarioId>/<requestId>/...` | `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`, `packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts`, `tools/openclinxr/encounter-asset-generation-worker.ts`, `tools/openclinxr/encounter-asset-generation-worker.test.ts` | `vitest run packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts tools/openclinxr/encounter-asset-generation-worker.test.ts`; `pnpm --filter @openclinxr/capability-gateway typecheck` | Passed |

- 2026-05-25 Worker report refresh: `docs/openclinxr/encounter-asset-generation-worker-2026-05-25.json` was regenerated and validated so the latest local artifact carries the metadata-only worker materialization plan. Validation: `tsx tools/openclinxr/encounter-asset-generation-worker.ts --validate-latest` passed.

### 2026-05-25 validation update - publication materialization handoff manifest

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / publication handoff | Include the metadata-only worker materialization plan in encounter publication payload reports for deterministic local artifact handoff | `tools/openclinxr/encounter-publication-payloads.ts`, `tools/openclinxr/encounter-publication-payloads.test.ts`, `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`, `tools/openclinxr/encounter-asset-generation-worker.ts` | `vitest run tools/openclinxr/encounter-asset-generation-worker.test.ts tools/openclinxr/encounter-publication-payloads.test.ts packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts` | Passed |

- 2026-05-25 Publication payload refresh: `docs/openclinxr/encounter-publication-payloads-2026-05-25.json` was regenerated and validated with `localMaterializationHandoffManifest`. Validation: `tsx tools/openclinxr/encounter-publication-payloads.ts --validate-latest` passed.

### 2026-05-25 validation update - local encounter launch-selection manifest

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / local launch selection | Add a local static asset launch-selection report that selects scene/bundle URLs from publication payloads while keeping learner launch blocked behind gates | `tools/openclinxr/encounter-local-launch-selection.ts`, `tools/openclinxr/encounter-local-launch-selection.test.ts`, `package.json`, `docs/openclinxr/encounter-local-launch-selection-2026-05-25.json` | `vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`; `pnpm asset:encounter-publication:validate`; `pnpm asset:encounter-launch-selection -- --publication-report docs/openclinxr/encounter-publication-payloads-2026-05-25.json --output docs/openclinxr/encounter-local-launch-selection-2026-05-25.json`; `pnpm asset:encounter-launch-selection:validate` | Passed |

### 2026-05-25 validation update - local factory operation manifest

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / operation handoff | Add a deterministic local factory operation manifest downstream of launch selection while preserving no-execution/no-readiness boundaries | `tools/openclinxr/encounter-local-factory-operation-manifest.ts`, `tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`, `package.json`, `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json` | `vitest run tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`; `pnpm asset:encounter-launch-selection:validate`; `pnpm asset:encounter-factory-operation-manifest -- --launch-selection docs/openclinxr/encounter-local-launch-selection-2026-05-25.json --output docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json`; `pnpm asset:encounter-factory-operation-manifest:validate` | Passed |

### 2026-05-25 validation update - local factory handoff preflight

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / handoff preflight | Validate operation-manifest local/public scene and runtime bundle files as paired handoff inputs while preserving runtime/learner launch blockers | `tools/openclinxr/encounter-local-factory-handoff-preflight.ts`, `tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`, `package.json`, `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-local-factory-operation-manifest.test.ts tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`; `pnpm asset:encounter-factory-handoff-preflight:validate` | Passed |

### 2026-05-25 validation update - guarded runtime selection intent

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / guarded runtime selection | Add a disabled runtime-selection intent that consumes factory handoff preflight and local provider benchmark metadata without executing providers or launching UI | `tools/openclinxr/encounter-guarded-runtime-selection-intent.ts`, `tools/openclinxr/encounter-guarded-runtime-selection-intent.test.ts`, `package.json`, `docs/openclinxr/encounter-guarded-runtime-selection-intent-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-guarded-runtime-selection-intent.test.ts`; `pnpm asset:encounter-factory-handoff-preflight:validate`; `pnpm local:provider:benchmark:validate`; `pnpm asset:encounter-guarded-runtime-selection-intent:validate` | Passed |

### 2026-05-25 validation update - guarded runtime selector disabled seam

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / guarded runtime selection | Add an asset-registry disabled selector decision for scenario/station/bundle intent without provider execution, UI launch, Quest refresh, or learner runtime enablement | `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `packages/openclinxr/asset-registry/src/runtime-bundles.test.ts` | `pnpm --filter @openclinxr/asset-registry test -- runtime-bundles.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck` | Passed |

### 2026-05-25 validation update - factory operation guarded selector handoff

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / guarded runtime handoff | Embed the disabled guarded runtime selector decision in local factory operation manifests for review-blocked runtime handoff without enabling runtime/UI/provider/Quest execution | `tools/openclinxr/encounter-local-factory-operation-manifest.ts`, `tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`, `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-local-factory-operation-manifest.test.ts packages/openclinxr/asset-registry/src/runtime-bundles.test.ts`; `pnpm asset:encounter-factory-operation-manifest:validate` | Passed |

### 2026-05-25 validation update - preflight guarded selector carry-forward

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / handoff preflight | Carry and validate the disabled guarded runtime selector decision through local factory handoff preflight reports without enabling runtime bridge or learner launch | `tools/openclinxr/encounter-local-factory-handoff-preflight.ts`, `tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`, `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`; `pnpm asset:encounter-factory-handoff-preflight:validate` | Passed |

### 2026-05-25 validation update - guarded selection intent boundary consistency

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / guarded runtime selection | Carry the disabled guarded selector decision into guarded runtime selection intent reports alongside provider candidate metadata while preserving no-execution boundaries | `tools/openclinxr/encounter-guarded-runtime-selection-intent.ts`, `tools/openclinxr/encounter-guarded-runtime-selection-intent.test.ts`, `docs/openclinxr/encounter-guarded-runtime-selection-intent-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-guarded-runtime-selection-intent.test.ts tools/openclinxr/encounter-local-factory-handoff-preflight.test.ts`; `pnpm asset:encounter-guarded-runtime-selection-intent:validate` | Passed |

### 2026-05-25 validation update - runtime selection review packet

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / guarded runtime review | Add a read-only runtime selection review packet that consolidates guarded selector decision, local runtime candidates, blockers, and no-readiness boundaries for future admin handoff | `tools/openclinxr/encounter-runtime-selection-review-packet.ts`, `tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`, `package.json`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-runtime-selection-review-packet.test.ts tools/openclinxr/encounter-guarded-runtime-selection-intent.test.ts`; `pnpm asset:encounter-runtime-selection-review-packet:validate` | Passed |

### 2026-05-25 validation update - API read-only runtime selection review surface

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / control-plane handoff | Add `/runtime/selection-review-packet` as a read-only API surface for disabled guarded runtime selection review without runtime/UI/provider/Quest execution or learner launch | `packages/openclinxr/rest/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts` | `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/api typecheck` | Passed |

### 2026-05-25 validation update - admin client runtime selection review packet

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Add typed admin client access to `/runtime/selection-review-packet` with fixture coverage preserving disabled selector and no-readiness boundaries | `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin typecheck`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` | Passed |

### 2026-05-25 validation update - admin runtime selection review panel

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Render the read-only runtime selection review packet in the seed workbench with disabled selector boundary, reviewer checklist, blockers, and no-readiness copy | `apps/ui-admin/src/App.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin typecheck`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` | Passed |

### 2026-05-25 validation update - REST runtime selection review route contract

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Control-plane routing / guarded runtime handoff | Add route-catalog and matcher coverage for `/runtime/selection-review-packet` so the read-only guarded runtime selection API remains indexed | `packages/openclinxr/rest/src/rest-routes.test.ts` | `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts`; `pnpm --filter @openclinxr/rest typecheck` | Passed |

### 2026-05-25 validation update - admin client runtime selection contract hardening

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin client / guarded runtime handoff | Harden admin client tests for `getRuntimeSelectionReviewPacket()` route usage and disabled selector packet round-trip | `apps/ui-admin/src/api-client.test.ts` | `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx` | Passed |

### 2026-05-25 validation update - runtime selection review panel component test

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Add focused component coverage for the Runtime Selection Review Packet panel boundary, checklist, blockers, and no-readiness claims | `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- RuntimeSelectionReviewPacketPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - seed workbench runtime selection fetch assertion

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Assert the seed workbench actively fetches the runtime selection review packet before rendering the read-only panel | `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - shared asset LRU generation disposition

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / shared asset library | Add explicit generation-skip/generate dispositions and evidence-gate compatibility metadata to shared asset LRU cache evidence operations | `tools/openclinxr/shared-asset-library-cache-evidence.ts`, `tools/openclinxr/shared-asset-library-cache-evidence.test.ts`, `docs/openclinxr/shared-asset-library-cache-evidence-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/shared-asset-library-cache-evidence.test.ts`; `pnpm asset:shared-library-cache:validate` | Passed |

### 2026-05-25 validation update - capability-gateway shared asset cache event dispositions

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / shared asset library | Add explicit generation-skip/generate dispositions and evidence-gate compatibility metadata to upstream shared asset cache events | `packages/openclinxr/capability-gateway/src/asset-generation-jobs.ts`, `packages/openclinxr/capability-gateway/src/asset-generation-jobs.test.ts` | `pnpm --filter @openclinxr/capability-gateway test -- asset-generation-jobs.test.ts`; `pnpm --filter @openclinxr/capability-gateway typecheck` | Passed |

### 2026-05-25 validation update - worker artifact shared asset cache disposition refresh

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / shared asset library | Refresh worker execution artifact so shared asset cache events persist generation dispositions and evidence-gate compatibility metadata | `docs/openclinxr/encounter-asset-generation-worker-2026-05-25.json` | `pnpm asset:encounter-worker:validate`; `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-worker.test.ts` | Passed |

### 2026-05-25 validation update - publication payload refresh after shared asset cache metadata

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / publication handoff | Refresh publication payload artifact after shared asset cache event disposition updates using the current publication CLI contract | `docs/openclinxr/encounter-publication-payloads-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts`; `pnpm asset:encounter-publication:validate` | Passed after replacing obsolete `--worker-report` attempt with current CLI args |

### 2026-05-25 validation update - downstream factory handoff refresh after shared asset metadata

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / deterministic handoff chain | Refresh launch selection, operation manifest, handoff preflight, guarded runtime selection intent, and runtime selection review packet artifacts from updated publication payloads | `docs/openclinxr/encounter-local-launch-selection-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-25.json`, `docs/openclinxr/encounter-guarded-runtime-selection-intent-2026-05-25.json`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm asset:encounter-launch-selection:validate`; `pnpm asset:encounter-factory-operation-manifest:validate`; `pnpm asset:encounter-factory-handoff-preflight:validate`; `pnpm asset:encounter-guarded-runtime-selection-intent:validate`; `pnpm asset:encounter-runtime-selection-review-packet:validate` | Passed |

### 2026-05-25 validation update - worker shared asset disposition validator hardening

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / shared asset library | Require worker-report shared-asset cache events to include generation disposition and evidence-gate compatibility metadata | `tools/openclinxr/encounter-asset-generation-worker.ts`, `tools/openclinxr/encounter-asset-generation-worker.test.ts` | `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-worker.test.ts`; `pnpm asset:encounter-worker:validate` | Passed |

### 2026-05-25 validation update - runtime selection review publication linkage

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / guarded runtime handoff | Surface publication payload materialization blockers and asset-readiness summaries inside the runtime selection review packet | `tools/openclinxr/encounter-runtime-selection-review-packet.ts`, `tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`; `pnpm asset:encounter-runtime-selection-review-packet:validate` | Passed |

### 2026-05-25 validation update - admin/API publication materialization review surface

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / dynamic encounter factory | Surface publication materialization blockers and planned-vs-materialized output counts through the read-only runtime selection review API and admin panel | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/api-client.test.ts`, `apps/ui-admin/src/App.test.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx` | `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/ui-admin test -- RuntimeSelectionReviewPacketPanel.test.tsx api-client.test.ts App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - integrated admin materialization blocker coverage

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Prove the integrated seed exam workbench displays publication materialization counts, humanoid roles, and blockers inside the runtime selection review panel | `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - publication realism evidence refs contract

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / humanoid realism evidence gates | Require materialized publication payloads with humanoid runtime requirements to carry metadata-only humanoid, runtime-realism, and visual-QA evidence refs before guarded wiring | `tools/openclinxr/encounter-publication-payloads.ts`, `tools/openclinxr/encounter-publication-payloads.test.ts`, `docs/openclinxr/encounter-publication-payloads-2026-05-25.json`, `docs/openclinxr/encounter-local-launch-selection-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-25.json`, `docs/openclinxr/encounter-guarded-runtime-selection-intent-2026-05-25.json`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-publication-payloads.test.ts`; `pnpm asset:encounter-publication:validate`; downstream artifact validators | Passed |

### 2026-05-25 validation update - runtime review realism evidence ref propagation

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Guarded runtime handoff / humanoid realism evidence gates | Summarize publication humanoid-realism, runtime-realism, and visual-QA evidence refs inside runtime selection review packets before guarded wiring | `tools/openclinxr/encounter-runtime-selection-review-packet.ts`, `tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`; `pnpm asset:encounter-runtime-selection-review-packet:validate` | Passed |

### 2026-05-25 validation update - admin publication readiness evidence refs

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / publication readiness | Surface exact publication review evidence refs in the admin 3D environment publication-readiness panel without changing runtime/provider/Quest gates | `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx api-client.test.ts`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - admin/API runtime review realism refs

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Surface publication realism evidence ref IDs through the read-only runtime selection review API and admin panel without enabling runtime/provider/Quest paths | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- RuntimeSelectionReviewPacketPanel.test.tsx App.test.tsx`; `pnpm --filter @openclinxr/api typecheck`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - launch-selection realism evidence refs

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / launch-selection handoff | Preserve publication humanoid-realism, runtime-realism, and visual-QA evidence ref IDs in local launch-selection reports while keeping learner launch disabled | `tools/openclinxr/encounter-local-launch-selection.ts`, `tools/openclinxr/encounter-local-launch-selection.test.ts`, `docs/openclinxr/encounter-local-launch-selection-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-25.json`, `docs/openclinxr/encounter-guarded-runtime-selection-intent-2026-05-25.json`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`; downstream artifact validators | Passed |

### 2026-05-25 validation update - full runtime review realism evidence trace

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Guarded runtime handoff / humanoid realism evidence gates | Preserve and render full publication realism evidence-ref records through runtime selection review packets, API, and admin review surfaces | `tools/openclinxr/encounter-runtime-selection-review-packet.ts`, `tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm exec vitest run tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`; `pnpm asset:encounter-runtime-selection-review-packet:validate`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- RuntimeSelectionReviewPacketPanel.test.tsx App.test.tsx`; API/admin typechecks | Passed |

### 2026-05-25 validation update - operation manifest realism evidence refs

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / local operation manifest | Preserve publication realism evidence ref IDs through local factory operation manifests before guarded handoff | `tools/openclinxr/encounter-local-factory-operation-manifest.ts`, `tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`, `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-25.json`, `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-25.json`, `docs/openclinxr/encounter-guarded-runtime-selection-intent-2026-05-25.json`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json` | `pnpm exec vitest run tools/openclinxr/encounter-local-factory-operation-manifest.test.ts`; downstream artifact validators | Passed |

### 2026-05-25 validation update - scenario-runtime durable actor-turn refs

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Durable clinical-event persistence / review workflow | Attach deterministic durable event refs to routed actor interactions, learner utterances, generated responses, and failed responses so review packets expose stable refs without raw learner/provider text | `packages/openclinxr/scenario-runtime/src/index.ts`, `packages/openclinxr/scenario-runtime/src/scenario-runtime.test.ts` | `pnpm --filter @openclinxr/scenario-runtime test -- -t "routed|durable|review packet"`; `pnpm --filter @openclinxr/review-workflow test -- -t "durable"`; scenario-runtime/review-workflow typechecks | Passed |

### 2026-05-25 validation update - failed actor-response durable refs

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Review workflow / durable refs | Harden failed actor-response traces so review packets expose deterministic durable refs without raw provider prompt or learner text leakage | `packages/openclinxr/scenario-runtime/src/scenario-runtime.test.ts` | `pnpm --filter @openclinxr/scenario-runtime test -- -t "routed|durable|review packet|fails"`; `pnpm --filter @openclinxr/review-workflow test -- -t "durable"`; scenario-runtime/review-workflow typechecks | Passed |

### 2026-05-25 validation update - routed interaction durable review summaries

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Review workflow / durable refs | Summarize routed actor-interaction events with durable refs while withholding routed learner text from faculty timeline summaries | `packages/openclinxr/review-workflow/src/review-packet.ts`, `packages/openclinxr/review-workflow/src/review-packet.test.ts` | `pnpm --filter @openclinxr/review-workflow test -- -t "durable"`; `pnpm --filter @openclinxr/review-workflow typecheck` | Passed |

### 2026-05-25 validation update - trace-ledger durable-ref validation contract

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Durable clinical-event persistence / trace ledger | Validate `payload.durableEventRef` against each trace event station run and sequence before ledger append/replay | `packages/openclinxr/shared-schemas/src/validators.ts`, `packages/openclinxr/shared-schemas/src/schemas.test.ts`, `packages/openclinxr/trace-ledger/src/in-memory-trace-ledger.test.ts` | `pnpm --filter @openclinxr/shared-schemas test -- -t "durable"`; `pnpm --filter @openclinxr/trace-ledger test -- -t "durable|invalid trace event"`; shared-schemas/trace-ledger typechecks | Passed |

### 2026-05-25 validation update - durable clinical-event provenance ref guard

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Durable clinical-event persistence / provenance integrity | Reject durable clinical-event `trace:<stationRunId>:...` provenance refs that point at another station run before session-state persistence, Mongo persistence, or review projection | `packages/openclinxr/session-state/src/index.ts`, `packages/openclinxr/session-state/src/session-state.test.ts`, `packages/openclinxr/data-mongodb/src/repositories.ts`, `packages/openclinxr/data-mongodb/src/mongodb-repositories.test.ts` | `pnpm --filter @openclinxr/session-state test -- -t "provenance|clinical events"`; `pnpm --filter @openclinxr/data-mongodb test -- -t "provenance|clinical-event"`; session-state/data-mongodb typechecks | Passed |

### 2026-05-25 validation update - durable clinical-event malformed provenance guard

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Durable clinical-event persistence / provenance integrity | Reject malformed durable clinical-event `trace:` provenance refs that omit station-run id or sequence/timestamp before session-state persistence, Mongo persistence, or review projection | `packages/openclinxr/session-state/src/index.ts`, `packages/openclinxr/session-state/src/session-state.test.ts`, `packages/openclinxr/data-mongodb/src/repositories.ts`, `packages/openclinxr/data-mongodb/src/mongodb-repositories.test.ts` | `pnpm --filter @openclinxr/session-state test -- -t "provenance|clinical events"`; `pnpm --filter @openclinxr/data-mongodb test -- -t "provenance|clinical-event"`; session-state/data-mongodb typechecks | Passed |

### 2026-05-25 validation update - admin-visible operator review readiness

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Surface metadata-only `operatorReviewReadiness` across runtime selection review packet, API fixture, and admin panel so operators can see blocker counts and required actions before guarded runtime wiring | `tools/openclinxr/encounter-runtime-selection-review-packet.ts`, `tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-25.json`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx` | `pnpm exec vitest run tools/openclinxr/encounter-runtime-selection-review-packet.test.ts apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx apps/ui-admin/src/api-client.test.ts`; `pnpm --filter @openclinxr/api test -- app.test.ts`; `pnpm --filter @openclinxr/ui-admin test -- RuntimeSelectionReviewPacketPanel.test.tsx api-client.test.ts App.test.tsx`; `pnpm asset:encounter-runtime-selection-review-packet:validate`; API/UI typechecks | Passed |

### 2026-05-25 validation update - integrated admin operator readiness coverage

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Ensure the full seed exam workbench fixture renders `operatorReviewReadiness` metrics and required actions, not only the isolated panel | `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx RuntimeSelectionReviewPacketPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - REST route read-only operator review contract

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| REST contract / guarded runtime handoff | Mark `/runtime/selection-review-packet` as a read-only review packet route with provider/runtime/learner-launch/Quest execution flags explicitly false | `packages/openclinxr/rest/src/index.ts`, `packages/openclinxr/rest/src/rest-routes.test.ts` | `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts`; `pnpm --filter @openclinxr/rest typecheck` | Passed |

### 2026-05-25 validation update - admin client operator readiness round-trip

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin client / guarded runtime handoff | Ensure `getRuntimeSelectionReviewPacket()` round-trips `operatorReviewReadiness` metadata-only boundaries and false provider/runtime/Quest flags | `apps/ui-admin/src/api-client.test.ts` | `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - dynamic encounter factory planning control-plane route

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / admin contract | Expose the existing dynamic encounter factory planning projection through read-only REST/API/admin-client contracts with provider/runtime/learner-launch/Quest flags false | `packages/openclinxr/rest/src/index.ts`, `packages/openclinxr/rest/src/rest-routes.test.ts`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/api-client.test.ts` | `pnpm --filter @openclinxr/rest test -- rest-routes.test.ts`; `pnpm --filter @openclinxr/api test -- app.test.ts -t "dynamic encounter factory"`; `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts -t "dynamic encounter factory"`; REST/API/UI typechecks | Passed |

### 2026-05-25 validation update - admin Scenario Bank dynamic factory planning panel

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / dynamic encounter factory | Render the dynamic encounter factory planning projection in the Scenario Bank workbench with next-scenario metadata and false provider/runtime/learner/Quest flags | `apps/ui-admin/src/App.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx -t "Scenario Bank"`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - featured factory-planning scene pipeline target

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / admin asset pipeline | Carry the featured dynamic factory-planning target into scene generation pipeline queues and make the admin panel initiate from that review-gated target without inferring generation approval | `packages/openclinxr/asset-registry/src/index.ts`, `packages/openclinxr/asset-registry/src/asset-registry.test.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts`; `pnpm --filter @openclinxr/api test -- app.test.ts -t "scene generation pipeline"`; `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx App.test.tsx`; asset-registry/API/UI typechecks | Passed |

### 2026-05-25 validation update - draft scenario publication gate hardening

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Review workflow / dynamic encounter factory gates | Keep draft scenario scene-generation publication blocked after runtime asset review attaches unless the scenario approval boundary is also clear | `apps/api/src/app.ts`, `apps/api/src/app.test.ts` | `pnpm --filter @openclinxr/api test -- app.test.ts -t "draft scenario publication|runtime asset review decisions|publication readiness"`; `pnpm --filter @openclinxr/api typecheck` | Passed |

### 2026-05-25 validation update - scene-generation request factory-planning context

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / admin asset pipeline | Attach request-level factory-planning context to accepted scene-generation requests and render it in the admin environment panel without inferring generation approval | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx`, `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx` | `pnpm --filter @openclinxr/api test -- app.test.ts -t "pediatric scene-generation\|scene generation pipeline"`; `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; API/UI typechecks | Passed |

### 2026-05-25 validation update - admin draft publication blocked-readiness coverage

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Review workflow / dynamic encounter factory gates | Prove the admin environment panel keeps draft scenario publication visibly blocked after runtime asset review attaches and does not render publisher-ready language | `apps/ui-admin/src/EnvironmentGenerationQueuePanel.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- EnvironmentGenerationQueuePanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-26 validation update - provider-disabled runtime selection review bundle wording

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Tighten runtime selection review packet and admin copy so the surface is explicitly a provider-disabled review bundle with provider/runtime/learner/Quest execution disabled and no provider/runtime/learner readiness claims | `tools/openclinxr/encounter-runtime-selection-review-packet.ts`, `tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`, `docs/openclinxr/encounter-runtime-selection-review-packet-2026-05-26.json`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.tsx`, `apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx` | `pnpm exec vitest run apps/ui-admin/src/RuntimeSelectionReviewPacketPanel.test.tsx tools/openclinxr/encounter-runtime-selection-review-packet.test.ts`; `pnpm asset:encounter-runtime-selection-review-packet:validate`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-26 validation update - admin/API no-readiness fixture propagation

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Admin review / guarded runtime handoff | Propagate expanded provider/runtime/learner no-readiness claim categories through API/admin fixtures and shared admin typing so integrated surfaces match generated review packets | `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/api-client.test.ts`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/api test -- app.test.ts -t "runtime selection review"`; `pnpm --filter @openclinxr/ui-admin test -- api-client.test.ts App.test.tsx RuntimeSelectionReviewPacketPanel.test.tsx`; API/UI typechecks | Passed |

### 2026-05-26 validation update - XR trace evidence admin review promotion

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| XR trace interaction / faculty review | Surface review-safe XR trace evidence refs, locomotion/interaction/latency metrics, and blockers in replay/faculty admin panels while preserving no Quest, score-use, clinical-validity, raw-payload, or full-runtime-readiness claims | `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.tsx`, `apps/ui-admin/src/ReviewReplayReadinessSummaryPanel.test.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`, `apps/ui-admin/src/FacultyReviewDecisionPanel.test.tsx` | `pnpm --filter @openclinxr/ui-admin test -- ReviewReplayReadinessSummaryPanel.test.tsx FacultyReviewDecisionPanel.test.tsx`; `pnpm --filter @openclinxr/ui-admin typecheck` | Passed |

### 2026-05-25 validation update - scenario-bank shared-asset reuse maturity surface

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / shared asset library | Add metadata-only shared-asset reuse maturity metrics to scenario-bank reports and admin panel so LRU/shared-library reuse candidates are visible before generation/materialization | `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/ScenarioBankMaturityPanel.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; scenario-fixtures/UI typechecks | Passed |

### 2026-05-26 validation update - case-defined humanoid performance contract metadata

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / humanoid realism | Derive metadata-only humanoid locomotion, expression, gaze, lip-sync, interactivity, emotion-state, and viseme/gaze/locomotion requirements from scenario definitions and dialogue seeds, then surface them in admin dynamic factory planning | `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts`, `apps/ui-admin/src/api-client.ts`, `apps/ui-admin/src/App.tsx`, `apps/ui-admin/src/App.test.tsx` | `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank`; `pnpm --filter @openclinxr/ui-admin test -- App.test.tsx`; scenario-fixtures/UI typechecks | Passed |

### 2026-05-26 validation update - queue-report case-defined humanoid performance bridge

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / asset-generation queue | Carry scenario-bank case-defined humanoid performance contracts into encounter asset-generation queue reports and projection artifact consumption as metadata-only planning evidence | `tools/openclinxr/encounter-asset-generation-queue.ts`, `tools/openclinxr/encounter-asset-generation-queue.test.ts` | `pnpm exec vitest run tools/openclinxr/encounter-asset-generation-queue.test.ts` | Passed |

### 2026-05-26 validation update - UI-XR case-defined humanoid performance evidence projection

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Include case-defined humanoid performance contract evidence in copied XR evidence payloads so locomotion, expression, gaze, lip-sync, interactivity, emotion-state, and viseme/gaze/locomotion requirements remain review-visible without readiness claims | `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/runtime-state.test.ts`, `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Passed |

### 2026-05-26 validation update - UI-XR evidence panel humanoid contract visibility

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Render case-defined humanoid performance contract metadata in the local XR evidence panel for screenshot/manual review without treating it as generated asset, animation, Quest, runtime, or clinical-validity evidence | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Passed |

### 2026-05-26 validation update - UI-XR runtime-bundle trace controls

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Derive trace action controls from the selected learner runtime bundle dialogue manifest so pediatric generated bundles render pediatric trace tasks instead of ED defaults | `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/runtime-state.test.ts`, `apps/ui-xr/src/main.ts`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-trace-actions-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-trace-actions-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke at `/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1` | Passed |

### 2026-05-26 validation update - UI-XR pediatric runtime trace interaction smoke

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / XR trace interaction | Prove generated pediatric trace controls interact in the running local UI by completing `Oxygen Request`, incrementing `Trace 1/9`, and preserving learner-use gates | `docs/openclinxr/screenshots/ui-xr-peds-runtime-trace-click-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-trace-click-smoke-2026-05-26.json` | Local desktop browser smoke at `/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1` clicking `Oxygen Request` | Passed |

### 2026-05-26 validation update - scenario-specific generated dialogue refinement

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / humanoid dialogue realism | Generate trace-specific actor dialogue from scenario definition details, hidden facts, de-escalation triggers, and rubric labels, then prove the pediatric runtime uses the refined oxygen-request line | `tools/openclinxr/generated-ed-station-runtime-bundle.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`, `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-refined-dialogue-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-refined-dialogue-smoke-2026-05-26.json` | `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm asset:generated-station-bundle -- --scenario peds_asthma_parent_anxiety_v1 --output /tmp/openclinxr-peds-generated-runtime-bundle.json`; local desktop browser smoke clicking `Oxygen Request` | Passed |

### 2026-05-26 validation update - UI-XR runtime trace metadata alignment

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / XR trace interaction | Classify scenario-bank trace tags into review-safe learner event types and use runtime dialogue actors for local handoff actor ids | `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/runtime-state.test.ts`, `apps/ui-xr/src/main.ts`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-trace-metadata-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-trace-metadata-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke checking handoff metadata after `Oxygen Request` | Passed |

### 2026-05-26 validation update - runtime trace family metadata correction

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / review-safe trace metadata | Route parent/family/guardian trace tags to `learner.family` before generic communication/team classification | `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/runtime-state.test.ts` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck` | Passed |

### 2026-05-26 validation update - UI-XR runtime equipment state from generated bundle

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Drive trace-tied room-state equipment cues from selected generated runtime bundle equipment ids for pediatric oxygen and bronchodilator actions | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-equipment-state-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-equipment-state-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Oxygen Request` and `Bronchodilator Plan` | Passed |

### 2026-05-26 validation update - pediatric monitor-state progression from generated trace actions

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Progress pediatric room-state monitor cues through `oxygen_started` and `bronchodilator_in_progress` from generated trace actions while keeping visual-only alarm and runtime equipment cues | `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-monitor-state-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-monitor-state-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- runtime-state.test.ts static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Oxygen Request` and `Bronchodilator Plan` | Passed |

### 2026-05-26 validation update - pediatric parent-communication equipment cues

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Map parent/family/empathy/communication traces to generated parent-chair and pediatric stretcher equipment cues, proving guardian communication activates encounter-defined context | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-parent-communication-equipment-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-parent-communication-equipment-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Parent Communication` | Passed |

### 2026-05-26 validation update - pediatric work-of-breathing assessment state cue

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Add and prove a dedicated generated-bundle work-of-breathing stress cue that activates pulse-ox/stretcher context, soft warning, and patient speech evidence | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-work-of-breathing-state-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-work-of-breathing-state-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Work Of Breathing Assessment` | Passed |

### 2026-05-26 validation update - pediatric history equipment cues

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Map generated pediatric inhaler/trigger history traces to encounter-defined inhaler spacer and parent-chair context cues, proving scenario-specific history actions affect the runtime scene state | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-history-equipment-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-history-equipment-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Inhaler History` and `Trigger History` | Passed |

### 2026-05-26 validation update - pediatric urgent-escalation scene cues

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Map generated pediatric urgent-escalation traces to escalation/family-support stress cues and generated oxygen/pulse-ox/parent-chair equipment state | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-urgent-escalation-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-urgent-escalation-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Urgent Escalation` | Passed |

### 2026-05-26 validation update - pediatric empathy de-escalation cues

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Map generated pediatric empathy traces to de-escalation/reassurance cues and generated parent-chair/stretcher context while preserving review boundaries | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-empathy-deescalation-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-empathy-deescalation-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Empathy Statement` | Passed with realism review note: generated empathy actor currently routes to parent/family actor |

### 2026-05-26 validation update - pediatric empathy actor-routing refinement

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / humanoid realism | Route generated pediatric empathy turns to the patient actor before parent/family routing, regenerating the pediatric static learner bundle and proving patient speech/handoff evidence | `tools/openclinxr/generated-ed-station-runtime-bundle.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`, `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json`, `docs/openclinxr/screenshots/ui-xr-peds-empathy-patient-routing-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-empathy-patient-routing-smoke-2026-05-26.json` | `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm asset:generated-station-bundle -- --scenario peds_asthma_parent_anxiety_v1 --output /tmp/openclinxr-peds-generated-runtime-bundle.json`; local desktop browser smoke clicking `Empathy Statement` | Passed |

### 2026-05-26 validation update - pediatric patient-note completion cues

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / review workflow | Map generated pediatric patient-note completion to note/faculty-handoff scene cues and generated parent-chair/pulse-ox context | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-note-completion-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-note-completion-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Patient Note Submitted` | Passed |

### 2026-05-26 validation update - dynamic room-prop object naming

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Replace hardcoded ED room-prop object-name prefix with the active runtime bundle scenario id and prove pediatric scene object names no longer carry ED prefixes | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-room-prop-names-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-room-prop-names-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object smoke | Passed |

### 2026-05-26 validation update - dynamic humanoid cue object naming

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Replace hardcoded ED prefixes for humanoid mouth/gaze/expression/affordance/collision cue object names with the active runtime bundle scenario id | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-humanoid-cue-names-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-humanoid-cue-names-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object smoke | Passed |

### 2026-05-26 validation update - dynamic humanoid role-visual object naming

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Replace hardcoded ED prefixes for humanoid role-specific gown/badge/pocket/cardigan cue object names with the active runtime bundle scenario id | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-role-visual-names-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-role-visual-names-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object smoke | Passed |

### 2026-05-26 validation update - dynamic locomotion rig object naming

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / locomotion realism | Replace hardcoded ED prefix for the locomotion rig object name with the active runtime bundle scenario id and prove pediatric scene object naming | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-locomotion-rig-name-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-locomotion-rig-name-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object smoke | Passed |

### 2026-05-26 validation update - dynamic actor-nameplate object naming

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Replace hardcoded ED prefix for actor-nameplate object names with the active runtime bundle scenario id and prove pediatric scene object naming | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-actor-nameplate-names-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-actor-nameplate-names-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object smoke | Passed |

### 2026-05-26 validation update - dynamic controller object naming with IWSDK stable aliases

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / Quest-WebXR input alignment | Replace hardcoded ED prefixes for controller/ray/grip scene names with active scenario ids while preserving IWSDK stable grip aliases in metadata | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-controller-object-names-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-controller-object-names-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object smoke | Passed |

### 2026-05-26 validation update - dynamic scene-object naming audit evidence

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Expose scene-object naming audit evidence that separates active-scenario object names from stable IWSDK legacy aliases and reports unexpected hardcoded ED-prefix leaks | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-dynamic-scene-object-naming-audit-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-dynamic-scene-object-naming-audit-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser scene-object audit smoke | Passed |

### 2026-05-26 validation update - scenario-bank-driven UI-XR humanoid performance contract

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Derive UI-XR case-defined humanoid performance contract evidence from the selected scenario-bank scenario instead of ED defaults, with package subpath export for `scenario-bank` | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `packages/openclinxr/scenario-fixtures/package.json`, `docs/openclinxr/screenshots/ui-xr-peds-case-defined-humanoid-contract-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-case-defined-humanoid-contract-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke at `/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1` | Passed |

### 2026-05-26 validation update - runtime-bundle refreshed humanoid contract evidence

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Refresh case-defined humanoid performance contract evidence after learner runtime bundle selection so contract scenario matches the active generated bundle | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-refreshed-humanoid-contract-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-refreshed-humanoid-contract-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke at `/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1` | Passed |

### 2026-05-26 validation update - explicit runtime-bundle humanoid contract scenario binding

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Keep case-defined humanoid performance contract evidence explicitly bound to the loaded learner runtime bundle scenario id after runtime bundle selection | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-explicit-bundle-humanoid-contract-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-explicit-bundle-humanoid-contract-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke at `/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1` | Passed |

### 2026-05-26 validation update - case-defined humanoid emotion/expression runtime evidence

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Route humanoid expression evidence through runtime affect timelines and scenario actor communication profiles before dialogue-text heuristics, preserving case-definition cue metadata in browser evidence | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/runtime-state.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-case-defined-emotion-expression-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-case-defined-emotion-expression-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser smoke clicking `Work Of Breathing Assessment` | Passed |

### 2026-05-26 validation update - pediatric role-distinct humanoid visual cues

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Add pediatric patient, nurse, and parent/family role-specific silhouette/posture/overlay cues so generated humanoid runtime roles are visually distinguishable from reused base assets | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-role-distinct-humanoid-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-role-distinct-humanoid-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser visual/evidence smoke | Passed |

### 2026-05-26 validation update - runtime-turn case-definition signal metadata

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / humanoid realism | Attach case-definition runtime signals to generated dialogue turns and regenerate the pediatric static learner bundle so emotion, gaze, and lip-sync requirements are visible per turn | `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`, `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json`, `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/scene-manifest.v1.json`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-turn-case-definition-signals-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-turn-case-definition-signals-smoke-2026-05-26.json` | `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser bundle-smoke | Passed |

### 2026-05-26 validation update - pediatric respiratory equipment cue and dynamic equipment-slot expansion

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / dynamic encounter factory | Load additional case-defined runtime equipment slots and add pediatric respiratory equipment readability cues for nebulizer, oxygen, pulse-ox, and low bed rail context | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-respiratory-equipment-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-respiratory-equipment-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser visual/evidence smoke | Passed |

### 2026-05-26 validation update - pediatric humanoid acting cue overlay

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| UI-XR evidence / humanoid realism | Add deterministic pediatric asthma humanoid acting cues for work-of-breathing, shoulder hunch, respiratory-rate metadata, and patient gaze alternation toward parent/nurse | `apps/ui-xr/src/main.ts`, `apps/ui-xr/src/static-assets.test.ts`, `docs/openclinxr/screenshots/ui-xr-peds-humanoid-acting-cues-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-humanoid-acting-cues-smoke-2026-05-26.json` | `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`; local desktop browser visual/evidence smoke | Passed |

### 2026-05-26 validation update - scenario-bank actor runtime realism requirements

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Scenario bank maturity / dynamic encounter factory | Extend case-defined humanoid performance contracts with per-actor runtime realism requirements for locomotion, expression, gaze, lip-sync, interaction, baseline mood, and required cue IDs | `packages/openclinxr/scenario-fixtures/src/scenario-bank.ts`, `packages/openclinxr/scenario-fixtures/src/scenario-bank.test.ts` | `pnpm --filter @openclinxr/scenario-fixtures test -- scenario-bank`; `pnpm --filter @openclinxr/scenario-fixtures typecheck` | Passed |

### 2026-05-26 validation update - runtime-bundle actor realism requirement propagation

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Dynamic encounter factory / humanoid realism | Propagate per-actor case-defined runtime realism requirements into generated runtime dialogue-turn metadata and regenerate the pediatric static learner bundle | `packages/openclinxr/asset-registry/src/runtime-bundles.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.ts`, `tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`, `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json`, `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/scene-manifest.v1.json`, `docs/openclinxr/screenshots/ui-xr-peds-runtime-actor-realism-requirements-smoke-2026-05-26.png`, `docs/openclinxr/ui-xr-peds-runtime-actor-realism-requirements-smoke-2026-05-26.json` | `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`; `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; local desktop browser bundle-smoke | Passed |

### 2026-05-26 validation update - durable autonomy instruction memory

| Lane | Slice | Files touched | Verification | Status |
| --- | --- | --- | --- | --- |
| Agent coordination / anti-drift governance | Commit Patrick's OpenClaw-style autonomous multi-agent, low-chat, evidence-gated, end-to-end product advancement instruction into the repo-level operating contract | `AGENTS.md`, `AUTONOMOUS_WORK_PLAN.md`, `docs/openclinxr/worker-backlog-and-validation-matrix.md` | Documentation-only operating-contract update; no code verification run | Passed |

### 2026-05-26 validation update: all-encounter screenshot realism pass
- Evidence: `docs/openclinxr/screenshots/ui-xr-realism-review-fixed3-contact-sheet-2026-05-26.png` and `docs/openclinxr/ui-xr-realism-review-fixed3-screenshots-2026-05-26.json`.
- Passed: ED Chest Pain scene boot recovered after room prop metadata normalization.
- Passed: non-materialized encounters no longer show ED clutter; they display selected scenario panels with an explicit 3D-pending scene notice.
- Remaining blocker for AAA-style realism: OB/clinic/oncology/postop need generated scenario runtime bundles; current pending panel is an evidence boundary, not completed 3D scene realism.
- Remaining blocker for humanoid realism: shared mannequin mesh and weak visible pose differentiation remain insufficient for production/Quest/clinical/scoring claims.
- Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

### 2026-05-26 heartbeat validation: generated bundle load compatibility
- Fixed: `evaluateEncounterRuntimeLearnerUseGate` now handles missing `evidenceGateRefs` as missing required gates, preserving learner-use blocking without crashing visual-review loading.
- Evidence: OB generated runtime bundle loaded in UI-XR visual-review mode; screenshot at `docs/openclinxr/screenshots/ui-xr-realism-review-ob-runtime-bundle-loaded-2026-05-26.png`.
- Verification: `pnpm --filter @openclinxr/asset-registry test -- asset-registry.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`.
- Remaining validation: repeat for clinic, oncology, postop and then regenerate all-encounter contact sheet.

### 2026-05-26 multimodal validation update
- Evidence reviewed: `docs/openclinxr/screenshots/ui-xr-multimodal-review-contact-sheet-2026-05-26.png` before cue additions, and `docs/openclinxr/screenshots/ui-xr-multimodal-review-cued-contact-sheet-2026-05-26.png` after cue additions.
- Product advancement: 3D scene now carries scenario expectation text and actor-attached clinical cues for OB, clinic, oncology, and postop encounters.
- Verification: UI-XR static asset tests and typecheck passed.
- Remaining quality gap: cue overlays improve multimodal review legibility but are not a substitute for generated actor-specific humanoid meshes, authored animations, or Quest runtime evidence.

### 2026-05-26 heartbeat validation: actor-specific identity cues
- Product advancement: generated humanoid scene slots now receive actor-id-specific hair/accent cues so multimodal screenshots no longer rely solely on identical neutral mannequin silhouettes.
- Verification: UI-XR static asset tests and typecheck passed.
- Remaining gap: semantic visual cues still need to be superseded by generated actor-specific meshes, rigged face/eyes/lips, and role-authored motion clips.

### 2026-05-26 validation update: WebXR-only refinement
- Evidence: `docs/openclinxr/screenshots/ui-xr-webxr-only-round2-final-contact-sheet-2026-05-26.png`.
- Improvement: WebXR-only screenshots exclude the right-side UI panel and show reduced/raised actor identity hair cues.
- Remaining gap: generated humanoid quality, facial animation, gaze/lip-sync fidelity, and role-authored locomotion still require asset-pipeline work beyond semantic cue overlays.

### 2026-05-26 heartbeat validation: next realism lane
- Added next-slice plan: `docs/openclinxr/humanoid-variant-materialization-next-slice-2026-05-26.md`.
- Validation target: actor-specific generated variant metadata and UI-XR consumption, verified by WebXR-only screenshots without side-panel context.

### 2026-05-26 validation update: humanoid variant profile metadata
- Product advancement: generated runtime bundle reports now include per-actor `humanoidVariantProfile` fields for body scale, clothing layer, rig, idle pose, and locomotion requirements.
- Verification: generated station runtime bundle tests passed; asset-registry typecheck passed.
- Remaining gap: UI-XR still needs to consume profile fields directly for actor rendering, then screenshots must prove reduced reliance on overlay cues.

### 2026-05-26 validation update: publication profile propagation
- Product advancement: case-defined humanoid runtime handoff now includes `humanoidVariantProfile` metadata for runtime consumers.
- Verification: encounter publication payload tests passed; asset-registry typecheck passed.
- Remaining gap: UI-XR consumption and screenshot evidence that profile-driven rendering reduces cue-overlay reliance.

### 2026-05-26 validation update: repeated doorway artifact reduction
- Evidence: `docs/openclinxr/screenshots/ui-xr-webxr-only-artifact-review-before-contact-sheet-2026-05-26.png` and `docs/openclinxr/screenshots/ui-xr-webxr-only-artifact-review-after-contact-sheet-2026-05-26.png`.
- Improvement: encounter-specific runtime themes now alter background, floor, panel, and reused-asset accent colors by selected bundle.
- Boundary: dynamic theming is not a substitute for true generated per-encounter assets or production/Quest/clinical/scoring readiness.

2026-05-26 Worker 9/11 dynamic-cleanup WebXR-only refinement: UI-XR scene-only cleanup now filters room props through the active encounter scene manifest, records a no-hardcoded-shared-world prop policy, applies scenario-derived actor postures for OB/clinic/oncology/postop instead of reusing the ED chest-pain pose, and restores primitive actor fallbacks when local generated humanoid GLBs are unavailable so captures do not become empty. Evidence: `docs/openclinxr/screenshots/ui-xr-webxr-only-dynamic-cleanup-contact-sheet-2026-05-26.png`; `docs/openclinxr/ui-xr-webxr-only-dynamic-cleanup-evidence-2026-05-26.json`. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Remaining gap: pediatric/ED fallback capsules indicate actor-specific generated GLBs must be materialized/fixed through the encounter factory before realism claims.

2026-05-26 Worker 9 portal anteroom slice: UI-XR now renders a reusable pre-encounter exterior room for doorway orientation and patient-note capture, plus an encounter-derived portal threshold into the dynamic clinical world. The portal frame is reusable, the threshold/accent and clinical floor are selected-bundle-derived, and the portal wall was corrected to leave the encounter window open instead of occluding the generated scene. Evidence: `docs/openclinxr/screenshots/ui-xr-webxr-only-portal-anteroom-contact-sheet-2026-05-26.png`. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Next: bind locomotion/crossing detection to encounter start/resume state.

2026-05-26 Worker 9 portal crossing transition evidence: UI-XR now emits `window.__openClinXrPortalTransitionEvidence` from camera world position relative to the portal threshold. It distinguishes reusable exterior note room, threshold, and dynamic encounter world, records first entry into the encounter side, and marks portal crossing as the encounter start/resume reason while keeping patient-note capture in the exterior anteroom. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Boundary remains local runtime evidence only, not Quest/motion-comfort/readiness proof.

2026-05-26 Worker 9 portal transition panel surfacing: UI-XR now renders portal transition state in the runtime locomotion evidence line so reviewers can see whether the examinee is outside, at threshold, or inside the dynamic encounter world without inspecting raw window state. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Next: browser evidence for threshold crossing or deterministic dev control to simulate crossing.

2026-05-26 Worker 9 deterministic portal crossing probe: UI-XR portal transition evidence now records desktop preview camera offset, a transition probe Z, and an optional `openclinxrPortalStart=exterior|threshold|encounter` deterministic preview start. This lets evidence capture prove exterior/threshold/dynamic-world states locally without needing headset locomotion for every regression pass. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 portal interior declutter behavior: UI-XR now hides the reusable exterior note shell and occluding anteroom wall/floor pieces after the portal transition probe places the examinee inside the dynamic encounter world. This keeps the reusable doorway concept without letting exterior artifacts pollute the in-room encounter view. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 portal shell evidence flag: UI-XR portal transition evidence now includes `reusableExteriorHiddenForEncounterView`, and the runtime evidence line reports whether the exterior shell is hidden after dynamic-world entry. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 portal-entry visual evidence and occlusion fix: Captured deterministic OB portal-entry evidence with `openclinxrPortalStart=encounter`, proving dynamic-world side and exterior shell hidden. Screenshot review showed portal frame occlusion, so the in-room visibility rule now hides portal jambs/lintel/opening/threshold after entry. Evidence: `docs/openclinxr/screenshots/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.png`; `docs/openclinxr/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.json`. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 Worker 9 portal hidden-object evidence list: UI-XR portal transition evidence now records `portalInteriorHiddenObjectNames` for the reusable exterior shell/frame objects hidden after dynamic-world entry, making the portal no-occlusion rule inspectable by tests/evidence capture. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-27 Worker 9 portal evidence export: UI-XR manual/copied evidence payloads now include `portalTransitionEvidence`, making portal side, hidden exterior/frame objects, encounter entry status, and reusable note-room anchoring exportable for review. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-27 Worker 9 actor identity cue refinement: actor-specific clothing/identity cues now apply across actor paths, while procedural face/eye/mouth overlays are restricted to primitive fallback actors or explicit face-detail review mode. This fixes the screenshot-observed GLB face-mask artifact while keeping fallback actors readable. Evidence refreshed: `docs/openclinxr/screenshots/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.png`; `docs/openclinxr/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.json`. Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

### 2026-05-27 Worker 9/11 generated-humanoid runtime declutter and material pass
- `ui-xr`: normal generated-GLB runtime now hides procedural face/clothing cue overlays unless primitive fallback or explicit face/detail review capture is active; legacy blocky review material is transparent in runtime; generated Anny skin/lip/shadow materials use warmer runtime colors.
- Evidence: `docs/openclinxr/screenshots/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.png`; `docs/openclinxr/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.json`.
- Verification: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.
- Next worker action: improve actor-specific generated humanoid asset materialization/retargeted pose variation in the encounter factory; avoid normal-runtime proxy overlays except for explicit review/fallback modes.

## 2026-05-27 OB visual realism gate
- Slice: OB portal-entry runtime screenshot refinement toward B+.
- Verification: `pnpm --filter @openclinxr/ui-xr typecheck`; portal-entry screenshot evidence helper.
- Result: room/portal/set-dressing improved; current evidence is still below B+ because humanoid rig/source quality dominates the score.
- Follow-up priority: agent-factory/asset-pipeline lead should source or generate higher-quality rigged humanoids before additional set dressing; adversarial reviewer should score WebXR-only crops against encounter expectations.

## 2026-05-27 Heartbeat slice: suppress wardrobe panel artifacts
- Product lane: humanoid realism / visual evidence cleanup.
- Change: default encounter runtime now suppresses role wardrobe continuity panels unless `wardrobe-continuity-review` capture mode is selected.
- Verification: `pnpm --filter @openclinxr/ui-xr typecheck`.
- Remaining B+ gap: better rigged humanoid source with clean shoulders/clothing and differentiated actor poses.

## 2026-05-27 OB portal-entry visual grade pass
- Lane: evidence-gated WebXR encounter composition.
- Evidence: `docs/openclinxr/screenshots/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.png`.
- Result: B+ composition pass after suppressing generic room-prop stand-ins, hiding non-OB equipment edge artifacts, tightening camera framing, and restaging patient/nurse/partner actors.
- Verification: `pnpm --filter @openclinxr/ui-xr typecheck`.
- Remaining lane: humanoid source/rig realism; do not continue masking rig defects with overlay geometry.

## 2026-05-27 Humanoid source-quality gate
- Lane: humanoid realism / asset factory.
- Added gate doc: `docs/openclinxr/humanoid-source-quality-gate-2026-05-27.md`.
- Verification target for next slice: generated/imported rigged humanoid source must beat the current OB screenshot without overlay masks.

## 2026-05-27 OB actor-specific humanoid source variants
- Lane: humanoid realism / encounter asset factory.
- Product change: OB runtime actors now use actor-specific generated-humanoid GLB source variants rather than one neutral source or runtime overlay masks.
- Evidence: `docs/openclinxr/ob-humanoid-source-variants-2026-05-27.json`; `docs/openclinxr/screenshots/ui-xr-portal-entry-dynamic-world-evidence-2026-05-26.png`.
- Verification: static asset hash/provenance test and humanoid realism gate tests passed; per-variant gate reports generated.
- Next: improve geometric shoulder/clothing mesh quality and body-profile differences in the actual generated GLBs, then repeat WebXR-only screenshot comparison.

## 2026-05-27 Humanoid source-variant B+ loop
- Outcome: B+ practical pass for source-routed OB actor differentiation, after rejecting a failed GLB geometry-deformation experiment based on screenshot evidence.
- Guardrail: do not reintroduce source sleeve scaling or runtime overlay masks as a realism fix; next improvement must come from a better generated humanoid mesh/source provider.
- Verification: static asset provenance/hash test, humanoid realism gate tests, ui-xr typecheck, and WebXR screenshot evidence.

## 2026-05-27 Humanoid provider/source upgrade plan
- Lane: humanoid realism / asset factory.
- Added plan: `docs/openclinxr/humanoid-provider-upgrade-plan-2026-05-27.md`.
- Next validation target: candidate humanoid-source preflight that gates higher-quality generated/imported GLBs before runtime promotion.

## 2026-05-27 Post-Anny Blender experiment
- Tool tried: local Blender headless GLB import/export with smooth shading and weighted normals.
- Outcome: accepted as safe chain step after Anny; technical gates and WebXR screenshot pass remained intact.
- Rejected: naive source-level sleeve/shirt geometry scaling, because visual evidence showed detached artifacts.
- Next tool-chain target: evaluate stronger mesh/clothing sources or providers before trying further humanoid topology changes.

## 2026-05-27 Humanoid toolchain options
- Lane: humanoid realism / source provider discovery.
- Added local-first option matrix in `docs/openclinxr/humanoid-toolchain-options-2026-05-27.md`.
- Next validation: candidate humanoid-source preflight, then MPFB/MakeHuman or MB-Lab local generation experiment through Blender.

### 2026-05-27 - Humanoid toolchain comparison lane
| Worker lane | Status | Evidence | Next validation |
| --- | --- | --- | --- |
| Asset Pipeline Lead / XR Systems Architect | Bakeoff tool added for Anny variants, body-profile variants, Blender post-pass, MPFB/MakeHuman, MB-Lab, Hunyuan3D, and approval-gated cloud providers. | `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.json`; `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.md` | Generate one MPFB/MakeHuman OB patient candidate locally, then run humanoid realism gate, bakeoff validation, and WebXR-only screenshot comparison. |

### 2026-05-27 - MPFB comparator generated
| Worker lane | Status | Evidence | Next validation |
| --- | --- | --- | --- |
| Asset Pipeline Lead / XR Systems Architect | MPFB 2.0.15 local comparator generated with standard rig, morph target primitive, and clinical idle/expression animation clips. | `docs/openclinxr/humanoid-realism-gate-mpfb-ob-patient-2026-05-27.json`; `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.json` | Add non-promoted WebXR comparison route and capture fallback-vs-MPFB screenshots before promotion. |

### 2026-05-27 - MPFB runtime comparator route
| Worker lane | Status | Evidence | Next validation |
| --- | --- | --- | --- |
| XR Systems Architect / Asset Pipeline Lead | Non-promoted OB patient MPFB comparator route added with static asset hash/provenance. | `humanoidSourceComparator=mpfb_ob_patient`; `apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb` | Capture equivalent WebXR-only fallback-vs-MPFB screenshots and score visual realism before any promotion. |

### 2026-05-27 - MPFB visual comparator decision
| Worker lane | Status | Evidence | Next validation |
| --- | --- | --- | --- |
| Adversarial Visual QA / Asset Pipeline Lead | MPFB comparator captured and rejected for promotion; keep Anny fallback for current runtime. | `docs/openclinxr/humanoid-source-visual-comparator-2026-05-27.json` | Probe MB-Lab local Blender source and only promote if it beats Anny in WebXR-only screenshot evidence. |

### 2026-05-27 - MB-Lab license gate
| Worker lane | Status | Evidence | Next validation |
| --- | --- | --- | --- |
| Open Source Governance / Asset Pipeline Lead | MB-Lab imports/registers in Blender 5.1, but generated model/database license is AGPL and blocks runtime asset promotion. | `.openclinxr-local/provider-cache/mblab/MB-Lab-master.zip`; `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.md` | Keep MB-Lab research-only; continue permissive MPFB/MakeHuman or other compatible source discovery. |

### 2026-05-27 - CharMorph Antonia candidate
| Worker lane | Status | Evidence | Next validation |
| --- | --- | --- | --- |
| Asset Pipeline Lead / Open Source Governance | CharMorph Antonia CC-BY candidate generated locally; not promoted because Rigify/animation gates fail. | `docs/openclinxr/humanoid-realism-gate-charmorph-antonia-2026-05-27.json`; `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.json` | Resolve Rigify/animation export or add deterministic clinical idle clip, then rerun gate before any WebXR route. |

### 2026-05-27 Humanoid source bakeoff evidence update

| Lane | Artifact | Evidence | Status | Next action |
| --- | --- | --- | --- | --- |
| Humanoid source comparison | CharMorph/Antonia OB patient comparator | `docs/openclinxr/humanoid-realism-gate-charmorph-antonia-2026-05-27.json`, `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-antonia-comparator-2026-05-27.png` | Structural pass, visual not yet promotable | Refine patient target-facing pose/orientation and retake WebXR-only screenshot evidence. |
| Humanoid source comparison | MPFB OB patient comparator | `docs/openclinxr/humanoid-realism-gate-mpfb-ob-patient-2026-05-27.json`, `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-mpfb-comparator-2026-05-27.png` | Structural pass, visual not promotable | Keep as fallback comparator; do not promote without material/wardrobe improvements. |
| Humanoid source comparison | MB-Lab | `docs/openclinxr/humanoid-toolchain-bakeoff-2026-05-27.json` | Research only | Do not route runtime assets from MB-Lab because generated-model AGPL boundary blocks promotion. |

| Humanoid source comparison | CharMorph/Reom OB patient comparator | `docs/openclinxr/humanoid-realism-gate-charmorph-reom-2026-05-27.json`, `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-comparator-2026-05-27.png` | Structural pass, visual not yet B+ | Use as next candidate while fixing source-agnostic patient orientation/pose contract. |

| Humanoid source comparison | CharMorph target-facing runtime transform | `docs/openclinxr/ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27.json` | Verification passed, needs visual regrade | Inspect regenerated close-up screenshots and refine face/pose/wardrobe artifacts. |

| Humanoid realism scoring | B+ scorecard for CharMorph comparators | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | Reom C+ visual, Antonia C visual, neither passes B+ | Remove diagnostic geometry from realism view and probe AI4Animation as gated motion-source lane. |

| Humanoid realism scoring | Reom diagnostic face geometry suppression | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Evidence regenerated | Regrade Reom close-up and continue toward B+. |

| Humanoid realism scoring | Reom post-suppression B+ regrade | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | C+ / 74, not B+ | Replace runtime overlay scaffolding with fitted Blender geometry or suppress overlays during realism review. |

| Humanoid realism scoring | Reom scaffolding suppression in realism review | `docs/openclinxr/ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27.json` | Verification passed, screenshot regenerated | Regrade visual realism and choose fitted clothing vs source-tool pivot. |

| Humanoid realism scoring | Reom source-level scaffolding removal | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Evidence regenerated | Regrade base Reom without placeholder overlays, then decide fitted clothing path. |

| Humanoid realism scoring | Broadened Reom overlay suppression | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Evidence regenerated | Regrade base humanoid-only screenshot and continue toward B+. |

| Humanoid realism scoring | Remaining generic cue overlay suppression | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | Provisional B- / 76, not B+ | Inspect regenerated screenshot and add fitted clothing/natural pose if base source is cleaner. |

| Evidence capture | Reom screenshot target mismatch guardrail | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | Latest visual score invalidated | Add capture guard, regenerate OpenClinXR-only screenshot, then resume B+ scoring. |

| Evidence capture | Guarded humanoid close-up comparator | `tools/openclinxr/humanoid-source-closeup-comparator.mjs`, `docs/openclinxr/ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27.json` | Guarded capture regenerated | Inspect guarded Reom image and resume B+ scoring loop. |

| Humanoid realism scoring | Guarded Reom regrade after capture guard | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | D / 58, valid evidence but overlay contaminated | Add source-comparator-clean capture mode to bypass runtime role/detail overlays. |

| Humanoid realism scoring | Clean source-comparator capture mode | `tools/openclinxr/humanoid-source-closeup-comparator.mjs`, `docs/openclinxr/ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27.json` | Typecheck passed, guarded clean screenshot regenerated | Inspect clean Reom evidence and regrade toward B+. |

| Humanoid realism scoring | Clean capture hides actor-slot scaffold before GLB load | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Typecheck passed, guarded evidence regenerated | Inspect clean Reom screenshot and regrade. |

| Humanoid realism scoring | Clean capture skips runtime humanoid overlays | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Typecheck passed, guarded evidence regenerated | Inspect source-only screenshot and update B+ scorecard. |

| Humanoid realism scoring | Clean Reom source regrade | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | B- / 78, not B+ | Add fitted Blender clinical gown/underlayer and regrade. |

| Humanoid realism scoring | Fitted Reom clinical clothing | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Gate/tests passed, guarded evidence regenerated | Inspect fitted source screenshot and update B+ score. |

| Humanoid realism scoring | Fitted Reom regrade | `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` | B / 82, not B+ | Refine gown silhouette/shoulders/lower garment and regrade. |

| Humanoid realism scoring | Refined Reom fitted gown silhouette | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Gate/tests passed, guarded evidence regenerated | Inspect and regrade toward B+. |

| Humanoid realism scoring | Reom shoulder artifact removal | `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png` | Gate/tests passed, guarded evidence regenerated | Inspect and regrade toward B+. |

| 2026-05-27 | Humanoid realism / Reom source comparator | B/83, not B+ | Fresh WebXR-only screenshot `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png`; focused static/realism tests 29/29 | Continue: replace procedural tunic with real fitted clothing mesh and improve pose/face detail. |

| 2026-05-27 | Reom posture realism pass | B/84, not B+ | Fresh WebXR-only Reom capture after posture update; screenshot path unchanged for comparator continuity | Continue: naturalize forearm/hand rotations and replace planar tunic with real garment mesh. |

| 2026-05-27 | Humanoid clothing tooling research | Planned | `docs/openclinxr/humanoid-clothing-tooling-research-2026-05-27.md` | Next: implement local Blender garment fitter and replace planar Reom tunic with fitted garment output. |

| 2026-05-27 | Local garment fitter bootstrap | Implemented utility | `python3 -m py_compile tools/openclinxr/blender/fit_garment_to_humanoid.py` | Next: run fitter against Reom candidate and compare WebXR screenshot score before replacing current tunic. |

| 2026-05-27 | Humanoid clothing/tooling task lane | Planned | Added durable task list to `AUTONOMOUS_WORK_PLAN.md`; research doc exists at `docs/openclinxr/humanoid-clothing-tooling-research-2026-05-27.md` | Execute Blender local fitter against Reom, then integrate MPFB/MakeHuman clothing library if screenshot score improves. |

| 2026-05-27 | External garment source support | Implemented utility upgrade | `python3 -m py_compile tools/openclinxr/blender/fit_garment_to_humanoid.py` | Next: source a license-compatible MPFB/MakeHuman garment GLB and run it through the fitter against Reom. |

| 2026-05-27 | Garment provider registry/work order | Implemented | `node tools/openclinxr/garment-work-order.mjs` generated `docs/openclinxr/garment-work-order-ob-reom-2026-05-27.json` | Next: source license-compatible MPFB/MakeHuman garment mesh and fit via `--garment`. |

| 2026-05-27 | Garment provider registry/work order | Implemented | `/Users/patrick/.nvm/versions/node/v24.15.0/bin/node tools/openclinxr/garment-work-order.mjs` generated `docs/openclinxr/garment-work-order-ob-reom-2026-05-27.json` | Next: source license-compatible MPFB/MakeHuman garment mesh and fit via `--garment`. |

| 2026-05-27 | Parameterized garment work orders | Implemented | Generated `docs/openclinxr/garment-work-order-peds-patient-2026-05-27.json` using NVM Node | Next: route work orders through shared garment cache and source real MPFB/MakeHuman garment mesh. |

| 2026-05-27 | Garment semantic cache helper | Implemented | NVM Node ran `tools/openclinxr/garment-cache-index.mjs` for OB and pediatric work orders; local index `.openclinxr-local/provider-cache/garments/garment-cache-index.json` initialized | Next: MPFB/MakeHuman garment license intake before real garment source reuse. |

| 2026-05-27 | MPFB/MakeHuman garment license intake | Implemented gate, blocked pending allowlist | `sources/makehuman-makeclothes-github-2026.json`; `docs/openclinxr/mpfb-makehuman-garment-license-intake-2026-05-27.json`; registry updated | Continue productive work on B+ screenshot blocker report and cache metadata while specific garment allowlist is pending. |

| 2026-05-27 | Garment cache/provider metadata normalization | Implemented | `docs/openclinxr/garment-cache-provider-metadata-2026-05-27.json` generated from local cache + provider registry | Next: WebXR screenshot B+ blocker report, then enqueue top remediation slice. |

| 2026-05-27 | WebXR B+ blocker report | Implemented | `docs/openclinxr/humanoid-source-bplus-blocker-report-2026-05-27.json` | Next: local-authored non-planar garment mesh candidate, fit to Reom, screenshot compare. |

| 2026-05-27 | Local-authored curved garment source | Implemented/generated | Python py_compile; Blender generated `.openclinxr-local/provider-cache/garments/sources/local-authored-curved-clinical-top.glb` and fitted `.openclinxr-local/provider-cache/garments/generated/reom-local-authored-curved-clinical-top-candidate.glb` | Next: expose candidate in WebXR comparator and score against B/84 baseline. |

| 2026-05-27 | Local-authored curved garment WebXR comparison | Completed, not promoted | Comparator captured `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-local-authored-curved-garment-face-pose-2026-05-27.png`; visual result remains planar/apron-like | Next: improve side/back wrap geometry and placement before next screenshot loop. |

| 2026-05-27 | Provider-routed garment generation gate | Implemented, blocked-safe | `docs/openclinxr/garment-provider-gate-ob-reom-2026-05-27.json` shows blocked before fit/promotion without source garment/license | Next: automatic scoring/promotion gate consumes provider gate + screenshot score and prevents planar/manual candidates from promotion. |

| 2026-05-27 | Automatic garment scoring/promotion gate | Implemented, blocked-safe | `docs/openclinxr/garment-promotion-gate-ob-reom-2026-05-27.json` blocks promotion on provider gate failure and score below B+ | Next: external garment ingestion CLI requiring garment path + license record before fit. |

| 2026-05-27 | External garment ingestion CLI | Implemented, blocked-safe | `python3 -m py_compile tools/openclinxr/blender/fit_garment_to_humanoid.py`; NVM Node `tools/openclinxr/garment-ingest-and-fit.mjs` blocked OB work order before fit | Next: mark ingestion wrapper as required approved entrypoint in cache/provider metadata and promotion docs. |

| 2026-05-27 | Garment pipeline 10-slice pass | Implemented | Updated registry/work-order/cache/provider-gate/promotion-gate and added ingestion contract, allowlist template, queue state, slice log | Next: license-compatible garment allowlist entry, then ingestion wrapper fit and screenshot/promotion gate. |

| 2026-05-27 | Garment pipeline 100-slice automation pass | Implemented, blocked-safe | `tools/openclinxr/garment-hundred-slice-runner.mjs` generated `docs/openclinxr/garment-hundred-slice-run-2026-05-27/summary.json` with 100 recorded slices | Next: real license-compatible garment allowlist entry, then ingestion wrapper + screenshot promotion gate. |

| 2026-05-27 | License-compatible garment source options | Researched | `docs/openclinxr/garment-license-compatible-source-options-2026-05-27.md` with source recommendations and blocked defaults | Next: pick one CC0 MakeHuman/MPFB garment asset and create a concrete allowlist record. |

| 2026-05-27 | First real garment allowlist candidate | Candidate metadata only | `docs/openclinxr/garment-allowlist-candidate-shirts01-elvs-crude-tshirt-2026-05-27.json`; sources reviewed from MakeHuman/MPFB CC0 pages | Next: resolve download URL, stage asset without committing, compute hash, then run provider-gated ingestion. |

| 2026-05-27 | MakeHuman Shirts01 CC0 pack staging | Staged locally, not committed/promoted | Local archive hash `a5a723b0e84a109bb190fcfeac7f1de4138d875da3e30fe5b3340eac9f38bcd3`; allowlist candidate updated | Next: extract selected OBJ locally, hash it, create source-backed work order, run provider-gated ingestion. |

| 2026-05-27 | Source-backed CC0 garment ingestion | Implemented/generated | Provider gate passed for `docs/openclinxr/garment-work-order-ob-reom-shirts01-cc0-2026-05-27.json`; Blender generated `.openclinxr-local/provider-cache/garments/generated/reom-shirts01-cc0-elvs-crude-tshirt-candidate.glb` | Next: expose CC0 garment candidate in WebXR comparator, screenshot score, promotion gate. |

| 2026-05-27 | Source-backed CC0 garment WebXR scoring | Completed, not promoted | Screenshot `docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-shirts01-cc0-face-pose-2026-05-27.png`; promotion gate blocks on B/84 below B+ | Next: improve external garment fit transform/mapping for real MakeHuman assets. |

| 2026-05-27 | External garment transform controls | Implemented/generated | Python py_compile passed; gated ingestion generated `.openclinxr-local/provider-cache/garments/generated/reom-shirts01-cc0-elvs-crude-tshirt-transform-candidate.glb` | Next: add automatic fit-quality inspection metrics to tune transform values. |

| 2026-05-27 | Garment fit-quality inspection | Implemented | `docs/openclinxr/garment-fit-quality-reom-shirts01-cc0-transform-2026-05-27.json`; metric shows large center offset despite depth | Next: derive fit transform from bounds automatically and regenerate source-backed candidate. |

| 2026-05-27 | Automatic garment fit-transform derivation | Implemented/partial improvement | `docs/openclinxr/garment-fit-quality-reom-shirts01-cc0-derived-transform-2026-05-27.json` shows centerOffset improved to `[0,-0.5192,0.004]` | Next: second-pass transform from new metrics, then WebXR comparator. |

| 2026-05-27 | Second-pass garment fit transform | Completed, rejected | `docs/openclinxr/garment-fit-transform-comparison-2026-05-27.json`; pass2 regressed center offset | Next: update transform derivation to use original source/body bounds rather than chained candidate metrics. |

| 2026-05-27 | Imported garment mesh filtering | Implemented, no visual improvement | Regenerated Namuhekam polo and screenshot still shows slab artifact | Next: remove/hide old baked Reom tunic mesh during external garment fitting before shrinkwrap/export. |

| 2026-05-27 | Reom source-backed garment fitter | Completed no-legacy regenerated polo screenshot pass; slab artifact removed but garment displaced/off-torso, grade C+/78, rejected. | Add torso-volume bounds normalization for imported garment meshes before shrinkwrap; re-run screenshot scoring before promotion. |
| 2026-05-27 | Multi-body garment promotion gate | Implemented blocked-safe | `docs/openclinxr/garment-promotion-gate-ob-reom-archetype-required-2026-05-27.json` blocks on missing child/adult/body-size evidence | Next: build archetype fixture generation and measurement extraction so Anny child/adult/overweight/skinny outputs can be fitted/scored before cache promotion. |
| 2026-05-27 | Adaptive garment body measurement extraction | Implemented first fixture | `docs/openclinxr/body-measurements-adult-average-reom-current-2026-05-27.json` generated via Blender background extraction | Next: consume measurement artifacts in garment fitter and generate child/adult/thin/overweight fixture evidence. |
| 2026-05-27 | Measurement-driven garment fitting | Implemented/generated | Provider-gated ingestion generated `.openclinxr-local/provider-cache/garments/generated/reom-namuhekam-polo-measured-candidate.glb` using `docs/openclinxr/body-measurements-adult-average-reom-current-2026-05-27.json` | Next: add measured candidate to screenshot comparator, then expand measurement fixtures to child/thin/overweight/tall/short archetypes. |
| 2026-05-27 | Codex/OpenClaw alignment cleanup | Implemented | Added `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md`; updated `AGENTS.md` and `PROJECT_COORDINATION_INDEX.md`; closed stale wrong-cwd subagent | Next: use bridge kickoff prompt and require live subagents to verify `/Volumes/files/src/openclinxr` before reporting. |
| 2026-05-27 | Adaptive garment archetype evidence aggregation | Implemented blocked-safe | `docs/openclinxr/garment-archetype-evidence-reom-namuhekam-polo-measured-2026-05-27.json` generated; blocks on missing archetypes and score below B+ | Next: generate child/thin/overweight/tall/short humanoid fixtures and run measured fitting/screenshots for each. |
| 2026-05-27 | Repo organization/OpenClaw automation cleanup | Implemented | Bridge now includes canonical organization map; heartbeat automation updated to repo-native OpenClaw prompt; `pnpm agent:alignment` should remain the light coordination check | Next: consolidate future prompt/status artifacts into canonical locations and reject wrong-cwd subagent findings. |
| 2026-05-27 | Blueprint-factory drift guardrails | Implemented protected policy | `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` linked from `AGENTS.md`, `PROJECT_COORDINATION_INDEX.md`, and `AUTONOMOUS_WORK_PLAN.md`; `tools/agent-factory/check-coordination-alignment.ts` now fails if guardrails are missing or unlinked | Next: future slices must pass the blueprint-to-runtime/conversation-tooling slice gate before asset or screenshot work continues. |
| 2026-05-27 | Documentation authority registry | Implemented | `pnpm docs:authority` generated `docs/openclinxr/doc-authority-registry-2026-05-27.md`/`.json`; `pnpm agent:alignment` now checks 10 files | Next: mark temporary/handoff docs historical in-place before any move/delete cleanup. |
