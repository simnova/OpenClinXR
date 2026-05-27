# OpenClinXR Autonomous Work Plan

2026-05-26 encounter realism screenshot review: captured actor-realism screenshots for pediatric asthma plus the five default exam-sequence encounters and wrote `docs/openclinxr/ui-xr-encounter-realism-review-2026-05-26.md`. Findings: pediatric asthma is the only scenario-specific rendered encounter; ED Chest Pain actor-realism capture hits a 3D boot blocker (`Cannot read properties of undefined (reading 'x')`); OB/Clinic/Oncology/Postop currently fall back to ED Chest Pain visuals/text and cannot count as scenario-specific realism evidence. Next product order: fix ED boot, add non-ED fallback guard, materialize actor-specific humanoid variants, then create scenario-specific minimal room manifests for remaining encounters.

2026-05-26 heartbeat continuation guard slice: generated station runtime bundle validation now rejects reports that omit actor-specific Anny humanoid variant keys or required body/clothing/hair-face/rig-preservation materialization cue IDs. This protects the new actor materialization contract from degrading back into shared neutral-human reuse. Focused verification passed: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`.

2026-05-26 heartbeat continuation slice: generated station runtime bundle reports now include an `actorHumanoidMaterializationContract` that requires actor-specific Anny humanoid variant keys, enumerates patient/parent/nurse variant semantic keys, and flags current shared neutral mesh reuse as a materialization gap instead of letting runtime cue overlays masquerade as asset-level progress. Focused verification passed: `pnpm exec vitest run tools/openclinxr/generated-ed-station-runtime-bundle.test.ts`; `pnpm --filter @openclinxr/asset-registry typecheck`.

2026-05-26 heartbeat continuation evidence slice: captured updated pediatric asthma actor-realism evidence after adding visible role-distinction clothing/accessory cues. Evidence shows no page errors and preserves 5 role-distinct humanoid cues plus 7 pediatric equipment cues. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-role-distinction-cues-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-role-distinction-cues-2026-05-26.json`. Visual residual risk: actors still share the same underlying generated humanoid mesh; next product slice should advance actor-specific humanoid asset materialization rather than adding more runtime cue patches.

2026-05-26 heartbeat continuation slice: UI-XR pediatric asthma actors now receive additional role-specific visible clothing/accessory cues that are not proxy bars: child small-stature band, nurse scrub V-neck, and parent civilian shoulder bag. This reduces the duplicated-humanoid read while preserving metadata-only boundaries. Focused verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 heartbeat continuation evidence slice: captured the pediatric asthma actor-realism scene after hiding empty actor-realism panels and semantic pose overlays. Latest desktop-browser evidence shows no page errors, 5 role-distinct humanoid cues, 7 pediatric equipment cues, and the actor-realism panel hidden until trace activation. Evidence: `docs/openclinxr/screenshots/ui-xr-peds-declutter-overlay-hidden-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-declutter-overlay-hidden-2026-05-26.json`. Boundary remains desktop-browser visual evidence only, not Quest, production asset, clinical, scoring, or animation-quality readiness.

2026-05-26 heartbeat continuation slice: UI-XR role-pose helper overlays are now semantic/debug-only and hidden from normal actor-realism captures, preventing large proxy bars from adding visual clutter while preserving cue metadata for affordance/debug review. Focused verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 heartbeat continuation slice: UI-XR actor-realism capture now hides the empty in-scene Actor Realism Requirements panel until an active trace/dialogue actor requirement exists, reducing default pediatric scene clutter while preserving the panel for adversarial review after a trace action is selected. Focused verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`.

2026-05-26 UI-XR pediatric scene declutter and role-pose slice: actor-realism handoff now honors `openclinxrCaptureMode`, suppresses mismatched reused placeholder environment/equipment GLBs when the dynamic scene manifest is for a different scenario, keeps semantic pediatric equipment cues visible, reframes the parent into the three-actor review zone, and adds case-role pose overlays plus fuzzy humanoid joint-name posing for Anny/Mixamo-style rigs. Focused verification passed: `pnpm --filter @openclinxr/ui-xr test -- static-assets.test.ts`; `pnpm --filter @openclinxr/ui-xr typecheck`. Browser evidence: `docs/openclinxr/screenshots/ui-xr-peds-declutter-role-pose-v4-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-declutter-role-pose-v4-2026-05-26.json`. Boundary remains desktop browser visual evidence only, not Quest, production asset, clinical, scoring, or animation-quality readiness.

2026-05-26 verification note for architecture guard: targeted UI-admin handoff tests/typecheck passed. The broader `workspace-architecture.test.ts` suite still reports unrelated existing architecture debts around executable worker endpoint shape, UI domain-contract imports, and unsafe score-use language; treat those as separate backlog lanes, not blockers for the Admin-to-XR handoff slice.

2026-05-26 Admin-to-XR local handoff affordance: Runtime Selection Review Packet now exposes a review-only local XR handoff URL carrying scenario, encounter, station, runtime bundle, and actor-realism capture mode while explicitly preserving blocked learner/runtime/provider/Quest readiness boundaries.

2026-05-26 asset-registry browser-barrel architecture guard: added an architecture regression preventing the root asset-registry browser barrel from re-exporting Node-only object-store runtime code while preserving explicit object-store/asset-writer subpath exports for server/tooling use.

2026-05-26 full-app smoke recovery: fixed the Admin browser runtime failure by keeping Node/Azurite object-store runtime exports out of the asset-registry browser barrel while preserving direct Node/tooling imports. Full-app resmoke shows UI-XR pediatric interaction and Admin landing/routes load with HTTP 200 and no page errors. Evidence: `docs/openclinxr/full-app-resmoke-2026-05-26.json`, `docs/openclinxr/ui-admin-route-smoke-2026-05-26.json`, and screenshots under `docs/openclinxr/screenshots/`.

2026-05-26 evidence-gated runtime handoff adapter: added a runtime handoff adapter that consumes WebXR launch contracts and preserves patient/family/nurse actor realism requirements into blocked runtime handoff decisions. Mock attached runtime/visual/actor evidence can advance only `localRuntimeHandoffAllowed`; learner launch, Quest readiness, provider readiness, production, clinical, and scoring claims remain blocked.

2026-05-26 WebXR launch actor-badge integrity guard: launch-selection validation now rejects launch contracts that carry case-defined actor realism requirements but drop or mismatch the required per-actor realism launch badges, preventing downstream runtime handoff from losing actor-specific humanoid gates.

2026-05-26 WebXR launch contract drift guard: launch-selection validation now rejects reports whose launch contract scenario/encounter/station/runtime bundle IDs drift from the selected launch IDs, and rejects generated asset URLs that do not include the selected scenario id.

2026-05-26 materialized WebXR launch-selection contract: regenerated and validated `docs/openclinxr/encounter-local-launch-selection-2026-05-26.json`, so durable local launch-selection handoff now includes the WebXR launch contract with actor roster, case-definition coverage, blocking reasons, and non-readiness boundaries.

2026-05-26 WebXR launch contract backward-compatible validation: launch contract generation now handles older publication artifacts that lack actor runtime handoff arrays by emitting explicit blocked launch reasons such as `actor_roster_empty`, `case_definition_coverage_not_attached`, and `case_defined_actor_realism_requirements_incomplete` instead of crashing or implying readiness.

2026-05-26 WebXR launch contract positive path: focused launch-selection coverage now proves that when upstream case-defined humanoid handoff exists, the WebXR launch contract carries three actor runtime realism requirements and three per-actor blocked realism badges while keeping runtime/Quest readiness blocked until evidence attaches. Verification passed: `pnpm exec vitest run tools/openclinxr/encounter-local-launch-selection.test.ts`.

Last updated: 2026-05-24

2026-05-26 WebXR launch contract slice: encounter local launch selection now emits `launchContract` with selected scenario/encounter/station/runtime bundle, runtime actor roster, case-defined actor realism requirements when upstream handoff exists, per-actor blocked realism badges, case-definition coverage, and launch blocking reasons. The current ED fixture is correctly blocked for missing case-defined actor realism handoff/equipment alignment, preserving the boundary that local static selection is not runtime/Quest/production/clinical/scoring readiness.

2026-05-26 UI-admin humanoid handoff badge boundary: the 3D Environment Generation Queue humanoid runtime handoff summary now shows `badge realismBlocked until actor-specific humanoid gate evidence attaches` for actor work orders. Admin review therefore sees the same actor-gate boundary before runtime review or learner launch attempts.

2026-05-26 UI-XR active actor launch badge browser smoke: local Vite/browser evidence now captures pediatric asthma actor-realism mode after `Urgent Escalation` and asserts `window.__openClinXrHumanoidSpeechEvidence.activeActorRealismLaunchBadge.status === "realismBlocked"`. Evidence artifacts: `docs/openclinxr/screenshots/ui-xr-peds-active-actor-launch-badge-smoke-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-active-actor-launch-badge-smoke-2026-05-26.json`. Boundary remains desktop-browser evidence only, not Quest, clinical, scoring, production, or animation-quality readiness.

2026-05-26 UI-XR active actor launch badge evidence: `window.__openClinXrHumanoidSpeechEvidence` now includes `activeActorRealismLaunchBadge` for the active dialogue actor, carrying `realismBlocked`, actor id, actor role, badge blockers, and metadata-only claim boundary. This lets copied/browser evidence and future adversarial tools consume the same actor gate boundary shown in the in-scene panel.

2026-05-26 materialized factory actor-realism handoff reports: regenerated and validated `docs/openclinxr/encounter-local-factory-operation-manifest-2026-05-26.json` and `docs/openclinxr/encounter-local-factory-handoff-preflight-2026-05-26.json`, so durable handoff artifacts now include scenario-derived actor runtime realism requirements and per-actor blocked launch badges.

2026-05-26 preflight actor badge validation guard: local factory handoff preflight validation now rejects reports that drop all actor realism launch badges or duplicate actor role/id badge entries. This keeps case-defined actor readiness from disappearing between operation manifest, handoff preflight, and future UI/runtime badge consumers.

2026-05-26 preflight actor badge requirement preservation: local factory handoff preflight badges now consume operation-manifest `actorRuntimeRealismRequirements` when present, preserving actor id, baseline mood, required cue IDs, and required realism dimensions in each blocked launch badge. Role-only fallback remains for older manifests but no longer discards case-defined actor obligations.

2026-05-26 local factory operation actor requirements: encounter local factory operation manifests now carry scenario-bank-derived `actorRuntimeRealismRequirements` for the selected scenario, including actor id, role, baseline mood, realism dimensions, and required cue IDs. This moves the actor-realism badge/preflight path upstream from role-only metadata toward case-definition-driven factory contracts.

2026-05-26 UI-XR actor-realism badge-boundary browser smoke: local Vite/browser evidence now captures the pediatric asthma actor-realism review mode after `Urgent Escalation` and asserts the in-scene "Actor Realism Requirements" text-panel evidence includes the `realismBlocked` badge boundary. Evidence artifacts: `docs/openclinxr/screenshots/ui-xr-peds-actor-realism-badge-boundary-smoke-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-actor-realism-badge-boundary-smoke-2026-05-26.json`. Boundary remains desktop-browser evidence only, not Quest, clinical, scoring, production, or animation-quality readiness.

2026-05-26 UI-XR actor-realism badge boundary: the in-scene Actor Realism Requirements panel now explicitly shows `realismBlocked` until actor-specific humanoid gate evidence attaches. This aligns the runtime reviewer affordance with the factory/preflight badge vocabulary and prevents visible dialogue/gaze metadata from being mistaken for humanoid launch readiness.

2026-05-26 scenario-derived actor badge coverage: humanoid realism gate coverage now proves the case-defined actor launch badge mapper consumes pediatric asthma scenario-bank `actorRuntimeRealismRequirements` directly, producing patient/family/nurse badges from scenario-derived roles, baseline moods, dimensions, and cue IDs. This keeps the badge vocabulary tied to the encounter factory definition rather than UI-only metadata.

2026-05-26 humanoid gate actor-realism launch badge mapper: the humanoid realism gate now exports a case-defined actor launch badge mapper that combines actor runtime requirements with GLB gate evidence. Badges report `realismReady` only when the humanoid gate has no blockers and actor baseline mood/cue requirements are present; otherwise they enumerate blocked dimensions and blockers. This establishes a shared badge vocabulary for UI/pipeline handoff without claiming production asset, Quest, clinical, or scoring readiness.

2026-05-26 local factory actor-realism launch badges: encounter local handoff preflight reports now include per-actor `realismBlocked` launch badges for each case-defined actor role. The badges explicitly block learner/runtime launch when actor-specific humanoid realism gate evidence is not attached, preventing generic sidecar/runtime availability from implying humanoid readiness. Boundary remains metadata-only local preflight, not runtime execution, Quest readiness, clinical validity, scoring validity, or production animation quality.

2026-05-26 UI-XR actor-realism panel browser smoke: local Vite/browser evidence now captures the pediatric asthma actor-realism review mode after `Urgent Escalation`, proving copied runtime evidence includes `activeActorRuntimeRealismRequirement` and text panel evidence includes the in-scene "Actor Realism Requirements" panel. Evidence artifacts: `docs/openclinxr/screenshots/ui-xr-peds-actor-realism-panel-smoke-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-actor-realism-panel-smoke-2026-05-26.json`. Boundary is local desktop browser evidence only, not Quest, clinical, scoring, production, or animation-quality readiness.

2026-05-26 actor-realism capture panel visibility: the in-scene Actor Realism Requirements panel now remains visible during humanoid mouth/gaze/pose and explicit actor-realism capture modes, even when other generated-scene evidence panels stay hidden. This supports adversarial screenshot review of facial, gaze, dialogue, and posture behavior against case-defined actor obligations without reintroducing broad scene clutter.

2026-05-26 IWSDK/sidecar actor-realism panel target: the in-scene actor realism requirements panel is now a named IWSDK scene object and sidecar review target, so managed-browser/headset evidence collection can verify the reviewer affordance in scene hierarchy alongside the clinical, dialogue, and input panels. Boundary remains sidecar-supporting evidence metadata only, not Quest readiness or runtime realism proof.

2026-05-26 UI-XR in-scene actor-realism requirement panel: the WebXR scene now includes an "Actor Realism Requirements" panel driven by the active dialogue turn's actor runtime realism requirement. It shows role, actor id, baseline mood, required realism dimensions, cue IDs, and non-readiness caveats in-scene so adversarial screenshot review can compare visible humanoid behavior against case-defined obligations. Boundary remains display/evidence handoff only, not production animation, Quest readiness, clinical validity, or scoring validity.

2026-05-26 UI-XR evidence-panel actor-realism readability: the Quest/manual runtime evidence panel's Speech affect line now summarizes the active actor runtime realism requirement, including role, actor id, locomotion/expression/gaze/lip-sync/interaction booleans, and required cue count. This makes case-definition-driven humanoid obligations visible during runtime review without requiring raw JSON inspection. Boundary remains display/evidence handoff only, not production animation, Quest readiness, clinical validity, or scoring validity.

2026-05-26 UI-XR active dialogue actor-realism evidence: `window.__openClinXrHumanoidSpeechEvidence` now carries the active generated-bundle dialogue turn's actor runtime realism requirement, including actor id, role, baseline mood, locomotion/expression/gaze/lip-sync/interaction booleans, and required cue IDs. This lets screenshot/adversarial review tie visible speech, gaze, expression, and body-motion evidence back to the case-defined encounter factory. Focused UI-XR static/runtime evidence tests and typecheck passed. Browser smoke is deferred as a nonblocking evidence task because the local `pnpm exec node` path could not resolve Playwright from the workspace command. Boundary remains metadata/evidence handoff only, not production animation, Quest readiness, clinical validity, or scoring validity.

2026-05-26 UI-XR pediatric static generated bundle smoke: Local Vite/browser smoke now proves the pediatric asthma static generated learner bundle is consumed by the product surface via `openclinxrScenarioId`, rendering Pediatric Asthma context instead of ED Chest Pain while still displaying the generated learner-use blocked boundary. Evidence artifacts: `docs/openclinxr/screenshots/ui-xr-peds-static-generated-bundle-smoke-2026-05-26.png` and `docs/openclinxr/ui-xr-peds-static-generated-bundle-smoke-2026-05-26.json`. This is desktop-browser/local-Vite evidence only, not Quest, clinical, scoring, production, or readiness proof.

2026-05-26 UI-XR static generated visual-review loading: UI-XR now accepts `openclinxrScenarioId` as a scenario selection alias and allows matching static generated bundles to load for visual review even when learner runtime use remains evidence-blocked. This prevents scenario-selected product views from falling back to ED while preserving runtime/Quest/clinical/scoring readiness blockers. Focused verification passed for UI-XR static asset tests and typecheck.

2026-05-26 generated station bundle CLI scenario alias: Generated station bundle CLI now accepts `--scenario` as an alias for `--scenario-id`, matching the local smoke command pattern used by coordinator/adversarial agents and preventing accidental ED fallback when running scenario-selectable bundle generation. Focused verification passed for generated station runtime bundle tests.

2026-05-26 case-definition-driven runtime manifest slice: Generated station runtime bundles now derive station context and dialogue turns from the selected scenario fixture when available, including scenario objectives, environment description, scheduled-event interruption cues, actor demeanors, required trace tags, and scenario-definition dialogue text. Pediatric asthma tests now assert the generated bundle carries pediatric actor IDs, all pediatric equipment needs, all required trace tags, and scenario-definition dialogue text rather than ED-flavored defaults.

2026-05-26 runtime publication source traceability: Generated learner runtime bundle publication reports now preserve `sourceBundleReportPath` when the CLI is driven from `--bundle-report`, so scenario-selectable publication plans remain traceable to the generated bundle report that supplied the learner bundle. Focused verification passed for the learner-bundle publication test.

2026-05-26 scenario-selectable runtime publication seam: Generated learner runtime bundle publication planning now accepts an injected learner bundle and CLI `--bundle-report`, so pediatric asthma bundle metadata can flow into publication without silently rebuilding ED chest pain. The default ED local fixture path remains for compatibility, but the publication seam is no longer hardcoded to ED for scenario-driven generated bundle reports. Focused verification passed for learner-bundle publication and generated-station runtime bundle tests.

2026-05-26 pediatric generated runtime bundle alignment: The generated station runtime bundle preset for pediatric asthma now derives actor IDs and equipment asset IDs from the scenario bank fixture and creates placements for all pediatric equipment needs, not a two-item hardcoded placeholder. Focused verification passed for generated-station runtime bundle and encounter-publication payload tests.

2026-05-26 pediatric asthma case-definition-driven factory coverage: Encounter publication payloads now carry a `caseDefinitionDrivenFactoryCoverage` section proving the non-ED pediatric asthma scenario keeps its own actor roles, full required trace tags, equipment placements, asset/work-order coverage, and metadata-only boundaries aligned from scenario definition through generated learner bundle publication. The test helper now uses pediatric urgent-care station context, pediatric actor IDs, scenario-specific dialogue trace tags, and pediatric equipment placements instead of relabeling the ED chest-pain bundle. Focused verification passed for encounter publication/queue tests, scenario-fixtures tests, asset-registry typecheck, capability-gateway typecheck, and shared-schemas schema tests.

2026-05-26 adversarial equipment/clutter realism guard: Visual QA and runtime-realism evidence tests now reject generic generated-scene overview metadata as insufficient for equipment necessity and scene decluttering. A scene must carry explicit adversarial review checks and deterministic equipment/clutter runtime signals before the evidence loop can treat those dimensions as assessed; no screenshots, Quest refreshes, or readiness claims were added. Focused verification passed for visual QA and runtime-realism evidence tests.

2026-05-26 shared asset library LRU reuse regression: Shared asset library cache evidence tests now explicitly prove a reused hit preserves the first stored asset reference, skips regeneration, promotes the reused lookup key to most-recent position, and avoids evicting that reused key when a later miss forces LRU eviction. Focused verification passed for shared cache evidence and capability-gateway asset-generation job tests.

2026-05-26 external AI provider preflight no-execution guard: External AI asset provider preflight tests now explicitly lock Hunyuan3D local, Meshy cloud, Tripo cloud, and VLM adversarial-review candidates behind metadata-only/no-execution gates, including no external network use, no paid API use, and credential/approval requirements before any execution. Focused verification passed for external provider preflight and capability-gateway routing/job tests.

2026-05-26 UI-XR structured examinee locomotion evidence copy: UI-XR manual/copied evidence payloads now preserve structured examinee locomotion evidence from the runtime window state, including path cue IDs and explicit non-evidence caveats for Quest readiness, clinical validity, scoring validity, and motion-comfort validation. Focused verification passed for `@openclinxr/ui-xr` runtime-state tests and typecheck.

2026-05-26 runtime-realism locomotion evidence checker guard: Runtime-realism evidence checker tests now assert current browser capture shape with `examineeLocomotionEvidence` passes `examinee_locomotion_observed` while the report still explicitly excludes Quest-readiness evidence. This ties the copied UI-XR locomotion payload to the evidence-gated review loop without refreshing headset evidence or making runtime/Quest claims.

2026-05-26 pediatric asthma runtime handoff generalization: Encounter publication payload tests now prove the next non-chest-pain factory-planning scenario (`peds_asthma_parent_anxiety_v1`) carries case-defined humanoid runtime handoff metadata for patient, family, and nurse roles through projection-artifact CLI publication and into the generated scene manifest. This confirms the handoff path is not ED chest-pain-only while preserving metadata-only boundaries and no asset, animation, Quest, runtime, clinical, scoring, or production readiness claims.

2026-05-26 admin review-safe humanoid runtime handoff: The review replay readiness API, admin API client, and Review Replay Readiness Summary panel now propagate and display case-defined humanoid runtime handoff metadata from scene-generation actor work orders. Faculty/admin reviewers can see actor roles, required runtime signals, blockers, and non-readiness caveats as review-safe context without mutating scene manifests, wiring runtime behavior, refreshing Quest evidence, or claiming generated-humanoid, animation, runtime, Quest, clinical, scoring, or production readiness. Focused verification passed for `@openclinxr/api` tests/typecheck and `@openclinxr/ui-admin` review/API-client tests/typecheck.

2026-05-26 UI-XR scene-manifest humanoid runtime handoff preservation: UI-XR copied/manual evidence now preserves sanitized case-defined humanoid runtime handoff metadata from loaded scene manifests, including actor roles, work-order IDs, locomotion/expression/gaze/lip-sync/interactivity flags, required runtime signal IDs, blockers, and non-readiness caveats. Focused verification passed for `@openclinxr/ui-xr` runtime/static tests and typecheck.

2026-05-26 scene-manifest humanoid runtime handoff freeze: Encounter publication payloads now collect case-defined humanoid runtime handoff metadata from actor-specific humanoid/animation work orders and freeze it into generated scene manifest payloads. Projection-artifact publication tests verify the metadata reaches the scene manifest with runtime/visual evidence blockers and no generated-asset, animation-quality, Quest, runtime, clinical, scoring, or production readiness claims.

2026-05-26 admin humanoid runtime readiness handoff: Asset-registry scene-generation actor work orders now carry metadata-only humanoid runtime readiness handoff requirements derived from the scenario definition, including required WebXR realism signals, locomotion/expression/gaze/lip-sync/interactivity flags, runtime/visual evidence blockers, and non-readiness caveats. UI-admin 3D Environment Generation Queue surfaces the handoff for the featured scene pipeline so reviewers can see actor-level WebXR readiness expectations before any provider execution, asset materialization, Quest refresh, or learner/runtime binding.

2026-05-26 work-order humanoid contract consistency validation: Queue validation now verifies actor-specific humanoid GLB and animation work-order flags match the role membership and planning booleans in the case-defined humanoid performance contract. This prevents worker-facing locomotion, expression, gaze, lip-sync, interactivity, and planning requirements from drifting away from the encounter definition.

2026-05-26 admin client humanoid contract preservation: UI-admin API-client tests now guard that review replay readiness summaries preserve case-defined humanoid performance contract metadata across the stable REST client boundary. This prevents the API-derived contract from being dropped before review-route rendering.

2026-05-26 API review readiness humanoid contract summary: The station-scoped review replay readiness REST route now includes case-defined humanoid performance contract metadata derived from the scenario bank for the replay packet scenario. This makes the admin review-route propagation real API data, not only fixture data, while preserving the metadata-only/non-readiness boundary.

2026-05-26 review route humanoid contract reachability: The admin review route now passes optional case-defined humanoid performance contract metadata from the review replay readiness summary into both the review replay readiness panel and faculty decision handoff. This makes contract metadata operationally reachable in the review workflow instead of only component-testable, while keeping the data display-only and preserving all non-readiness boundaries.

2026-05-26 per-work-order humanoid performance validation: Encounter queue validation now requires actor-specific humanoid GLB and animation work orders to retain case-defined performance metadata whenever the projection queue report carries a humanoid performance contract. The validator guards metadata-only claim boundaries, locomotion/expression/gaze/lip-sync/interactivity booleans, planning flags, and non-readiness caveats so worker-facing requirements cannot silently disappear.

2026-05-26 work-order humanoid performance requirements propagation: Capability-gateway work orders can now carry case-defined humanoid performance requirements on actor-specific humanoid GLB and animation work orders. Projection-derived queue reports pass the encounter contract into the plan so each patient/family/nurse work order exposes locomotion, expression, gaze, lip-sync, interactivity, and planning-flag requirements while preserving metadata-only boundaries and no provider/Quest/runtime/clinical readiness claims.

2026-05-26 humanoid contract work-order coverage bridge: Projection-artifact queue reports now include validated case-defined humanoid performance work-order coverage, mapping each actor role from the encounter contract to its humanoid GLB and animation work orders plus required runtime realism signals. This makes the encounter factory bridge show whether patient/family/nurse role requirements are represented in queued work without executing providers, claiming generated asset readiness, animation quality, Quest readiness, runtime readiness, or clinical validity.

2026-05-26 admin humanoid contract review propagation: UI-admin review replay and faculty decision panels can now display optional case-defined humanoid performance metadata, including actor/emotion counts, locomotion/expression/gaze/lip-sync/interaction roles, planning flags, metadata-only claim boundary, and explicit not-evidence-for readiness caveats. This keeps humanoid realism requirements visible to reviewers without changing faculty safety decisions, learner launch gates, Quest posture, runtime readiness, animation-quality claims, or generated-asset readiness.

2026-05-26 queue-report humanoid contract validator hardening: Encounter asset-generation queue reports now validate the case-defined humanoid performance contract when projection artifacts are consumed, including the metadata-only claim boundary, actor/emotion counts, role arrays, boolean planning gates, and non-readiness caveats. Projection consumption must carry the same contract as the top-level queue report, preventing the encounter factory bridge from silently losing humanoid locomotion/expression/gaze/lip-sync/interactivity requirements before asset work orders are reviewed.

2026-05-24 Worker 7/8 review-safe evidence boundary slice: The admin Review-Safe Evidence Boundary now surfaces patient-note attachment/timing and latest replay timeline second using existing review packet fields only. This keeps faculty handoff context visible without raw clinical-event payloads, new persistence, or score-use claims.

2026-05-24 Worker 7/8 faculty-review posture slice: The admin Faculty Review Decision Handoff now surfaces reviewer decision posture metrics, including faculty draft status/reviewer, draft comment presence, patient-note evidence timing, and trace-quality missing-tag/provenance posture. This is projection-only UI work on the completed-station review path and intentionally avoids schema redesign, score-use claims, or persistence refactoring.

2026-05-24 generated-human rig report eyelid contract: Generated-human rigging reports now type and validate `eyelidBlinkControlsPresent` as a required true embodiment-rigging field. This makes left/right generated eyelid blink controls part of the asset pipeline contract rather than only a runtime/UI cue.

## 2026-05-24 Autonomy Stop And Repo-Agent Activation Review

Why the work appeared to stop:

- Heartbeat turns require a final heartbeat XML response. That response ends the current turn even when the project is not complete.
- A single Codex turn is not a durable daemon; work resumes only on the next heartbeat, user continuation, or automation invocation.
- Prior instructions said "do not final respond," but platform heartbeat rules override that by requiring a final XML heartbeat response.
- Recent slices repeatedly tightened evidence gates around humanoid eye realism. Those were useful, but the loop risked drifting into gate-hardening rather than broader product advancement.
- Repo-defined agents existed, but the active behavior mostly used local implementation rather than explicit repo-agent consultation or live subagent dispatch.
- Follow-up discovery found that live subagent tooling can be lazy-loaded in this Codex environment as `multi_agent_v1`; future runs should search for it before assuming only file-backed agents are available.

Corrective instruction update:

- `AGENTS.md` now records that heartbeat XML is a platform boundary, not a completion signal.
- `AGENTS.md` now records OpenClaw-style activation status: repo-agent memory and tooling are active, but no always-on agent daemon is activated by default.
- Long autonomous runs must explicitly choose one repo-agent mode: `local_role_consultation`, `live_subagents`, or `agent_loop_artifact`.
- After compaction, suspected drift, or two evidence/gate-only slices, consult Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, and VP Engineering Delivery before selecting the next slice.
- XR/humanoid/asset slices should consult XR Systems Architect and Asset Pipeline Lead when changing runtime behavior, visual evidence, generated assets, rigging, animation, Quest/WebXR posture, or IWSDK posture.
- If no live subagent tool is available or it would cost more than it saves, use local repo-agent consultation and record the role lens in this plan/backlog.
- If live subagent tooling is available and Patrick has requested agent/OpenClaw-style work, spawn narrowly scoped `explorer` or `worker` agents for independent drift review or disjoint implementation when that materially reduces cost/risk.

2026-05-24 generated eyelid first-class signal: `generated_eyelid_blink_control_cue` is now a required runtime-realism signal and a humanoid visual-QA signal, not only a hidden dependency of `dialogue_eye_micro_saccade_blink_cue`. Runtime evidence passes it only when the generated eyelid cue, blink/saccade cue, and numeric eye-motion metrics are all present.

2026-05-24 generated eyelid runtime-gate connection: Runtime realism evidence now requires `generated_eyelid_blink_control_cue` alongside `dialogue_eye_micro_saccade_blink_cue` and numeric eye-motion metrics before accepting blink/micro-saccade evidence. UI-XR copied speech evidence now preserves the generated eyelid cue too, connecting the new generated rig control to downstream evidence instead of leaving it as an isolated runtime detail.

2026-05-24 generated eyelid controls slice: The generated humanoid rig contract now includes left/right upper eyelid blink controls, and UI-XR dialogue playback drives those controls with the existing blink metric rather than only scaling eye-gaze controls. Runtime face-rig metadata now exposes `generated_eyelid_blink_control_cue`, moving the blink work from evidence-only toward actual generated-humanoid rig behavior.

2026-05-24 runtime eye-motion plausibility gate: Runtime realism evidence now bounds blink intensity to 0-1 and micro-saccade yaw/pitch to a small runtime cue range before accepting `dialogue_eye_micro_saccade_blink_cue`. This prevents malformed or exaggerated eye-motion metrics from satisfying humanoid realism evidence.

2026-05-24 runtime eye-motion metric gate: Runtime realism evidence now requires numeric `activeEyeBlinkIntensity`, `activeEyeMicroSaccadeYaw`, and `activeEyeMicroSaccadePitch` alongside `dialogue_eye_micro_saccade_blink_cue`. A cue string alone no longer satisfies blink/micro-saccade runtime evidence.

2026-05-24 copied eye-motion metrics: UI-XR humanoid speech evidence now carries numeric `activeEyeBlinkIntensity`, `activeEyeMicroSaccadeYaw`, and `activeEyeMicroSaccadePitch` values alongside the blink/micro-saccade cue ID. The copied runtime/Quest evidence contract now preserves those values so downstream visual/runtime review can reason about temporal eye behavior instead of relying only on a cue string.

2026-05-24 copied runtime evidence cue contract: UI-XR copied Quest/manual evidence payload tests now assert active humanoid speech expression metadata carries `dialogue_eye_micro_saccade_blink_cue`, active viseme/phoneme, and mouth openness. This keeps the runtime product evidence path aligned with the new blink/micro-saccade visual QA gates.

2026-05-24 temporal video MIME/path guard: Visual QA now blocks visual evidence where the artifact extension and MIME type disagree, so temporal humanoid pass claims cannot be made from mismatched `.webm`/`.mp4` metadata.

2026-05-24 temporal video frame-rate guard: Visual QA video artifacts now require duration and frame count to imply a plausible 6-120 fps review rate before blink/micro-saccade temporal claims can pass. This closes the metadata loophole where a long clip with too few frames could satisfy duration and frame-count independently.

2026-05-24 temporal video frame-count guard: Visual QA video artifacts now need `frameCount >= 12` before they can support temporal humanoid review, preventing blink/micro-saccade pass claims from metadata-only or too-few-frame clips.

2026-05-24 temporal video duration guard: Visual QA video artifacts now need `durationMs >= 1000` before they can support temporal humanoid review, preventing blink/micro-saccade pass claims from single-frame or too-short clips.

2026-05-24 temporal video anti-placeholder guard: Visual QA now blocks video artifacts smaller than 1024 bytes with `video_artifact_too_small_for_temporal_review`, preventing tiny placeholder files from carrying blink/micro-saccade temporal evidence. The fixture remains contract-only and explicitly not visual proof.

2026-05-24 temporal video evidence path: Visual QA evidence now accepts video artifacts under `docs/openclinxr/videos/` with `video/webm` or `video/mp4` MIME types. This gives the blink/micro-saccade temporal gate a valid evidence path while still blocking still screenshots from claiming passing temporal ocular quality.

2026-05-24 temporal eye-evidence guard: Humanoid visual QA now blocks a `pass` on eye blink/micro-saccade readability when the artifact is only a screenshot. This prevents still-image evidence from overclaiming temporal ocular realism and nudges the next realism loop toward short video or headset capture for blink/saccade quality.

2026-05-24 visual QA eye-analysis slice: Humanoid-focused visual QA now requires an `eye_blink_micro_saccade_readability` analysis item, and the current mouth/gaze/pose evidence records the new blink/micro-saccade signal as a concern rather than a pass. This keeps the evidence loop honest: still screenshots can acknowledge the cue exists, but future video/headset evidence must judge temporal ocular quality.

2026-05-24 eye realism gate slice: Runtime realism evidence now treats `dialogue_eye_micro_saccade_blink_cue` as a first-class required humanoid realism signal, and UI-XR speech evidence emits that cue with active expression metadata. This prevents the eye-blink/micro-saccade work from remaining only a loose runtime note and makes future screenshot/evidence loops evaluate it through the same gate as viseme/gaze mapping.

2026-05-24 eye realism slice: UI-XR generated humanoid dialogue playback now drives deterministic eye micro-saccade and blink transforms on the generated eye gaze controls, resets face rig controls when speech ends, and exposes `dialogue_eye_micro_saccade_blink_cue` metadata. This advances the visual-QA concern that gaze remained too cue-based/subtle without claiming production eye tracking or validated facial animation.

## 2026-05-24 Days-Long Autonomy Correction

Root causes that previously made autonomy stop early:

- A single Codex turn is not a durable background process; platform responses, tool completion, context compaction, and heartbeat events can interrupt a run.
- Chat progress/status replies were sometimes treated like completion checkpoints.
- Some plugin/skill workflows introduce approval gates that are useful for new scope but counterproductive for already-approved local deterministic slices.
- Evidence and verification loops can become toil when they do not unlock or validate product changes.
- Instructions held only in chat can be compacted away unless rehydrated from repo-level docs.

Durable correction now in force:

- `AGENTS.md` contains a Days-Long Unattended Autonomy Contract and must be read first after compaction or restart.
- The coordinator should loop through product-advancement slices, verification, doc updates, blocker recording, and immediate reselection of the next lane.
- Blockers are recorded with recommended defaults and work pivots unless every approved lane is blocked.
- Visual evidence is used to validate or unlock improvements, not as a standalone stopping point.
- If the platform forces a response, the response should be minimal and must not be framed as completion.

Recommended kickoff prompt:

```text
Continue autonomously in /Volumes/files/src/openclinxr for unattended day-scale work.

Read AGENTS.md first, then PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, and docs/openclinxr/worker-backlog-and-validation-matrix.md. Follow the Days-Long Unattended Autonomy Contract in AGENTS.md.

Work in LOW_TOKEN_AUTONOMY mode. Do not treat slices, verification, screenshots, evidence captures, doc updates, heartbeats, or context compaction as stop conditions. After each slice, run focused verification when appropriate, update the plan/backlog/operator files, record blockers with recommended defaults, and immediately continue to the next approved product-advancement lane.

Prioritize evidence-gated humanoid realism, facial/gaze/lip-sync quality, generated encounter scenes, dynamic asset pipeline, Quest/WebXR runtime evidence, scenario-bank maturity, review workflow, persistence, and provider gates.

Use repo-defined agents only when they materially reduce drift, review cost, or implementation risk. If a tool/skill/plugin asks for approval, ask only for new scope, destructive operations, paid/cloud/API use, production deployment, credentials, physical hardware action, or runtime dependency changes; otherwise document the assumption and continue.

Stop only if I explicitly say pause/stop, or every approved lane is truly blocked and recorded.
```

2026-05-24 realism loop update: UI-XR now has a mouth/gaze/pose review capture mode that extends humanoid dialogue playback to 45 seconds and reapplies the relaxed clinical idle posture during actor-pose review captures. This directly addresses the 2026-05-24 screenshot blockers where the mouth was static by capture time and the actor still read as mannequin-like.

2026-05-24 capture framing update: `mouth-gaze-pose` captures now reuse the actor-pose deocclusion/framing path, removing beds/room clutter from mouth, gaze, and posture screenshots so visual QA can judge the humanoid rather than surrounding props.

2026-05-24 mouth/gaze cue refinement: UI-XR reduced active eye-focus cue size/opacity and moved the mouth cue to a larger, mouth-local readable shape during speech. This reduces floating-eye visual noise while making mouth movement easier to capture for desktop/headset review.

2026-05-24 clinical idle posture refinement: UI-XR lowered generated humanoid upper-arm/forearm rotations and softened hand rotations in the runtime clinical idle posture assist, targeting the remaining stiff hand/arm blocker from mouth/gaze/pose screenshot review.

## Purpose

This file is the resume point for autonomous Codex work in `/Volumes/files/src/openclinxr`. It distills the historical conversation, current repo state, approved proposal boundaries, and next implementation slices so another agent can continue without requiring Patrick to restate context.

The stale workspace path `/Users/patrick/Documents/New project 2` should be treated as old Codex workspace metadata. The active codebase is `/Volumes/files/src/openclinxr`.

## Overall Goal

Build the first OpenClinXR planning-to-runtime skeleton for a Step 2 CS-inspired, multi-station XR clinical skills exam system. The near-term goal is a deterministic local implementation path that can author and review clinical stations, run an XR station shell, record auditable trace and clinical events, preserve package-local persistence contracts, and maintain honest evidence gates for Quest, local model, voice, IWSDK, Godot, and production asset readiness.

`AGENTS.md` now captures the original mission and should shape all continuation decisions: coordinated expert agents, adversarial critique, senior-leadership review, persistent indexed memory, scoring rubric, case-bank expansion, asset-pipeline detail, architecture documentation, and autonomous nonstop progress. When choosing the next slice, prefer work that improves at least one rubric dimension in `AGENTS.md` while staying inside approved local-only boundaries.

2026-05-21 realignment: the recent run produced useful hardening and honest Quest/IWSDK/model/asset evidence, but it also drifted toward evidence-refresh cadence. Going forward, evidence work must be subordinate to product advancement. Do not continue refreshing local voice/model/asset/benchmark reports just because a report is stale or red. Refresh evidence only when it unlocks an imminent implementation decision, captures a newly available hardware fact, or verifies code just touched. Otherwise choose build slices that make the multi-station clinical exam skeleton more complete for learners, faculty, scenario authors, reviewers, XR runtime, persistence, or asset production.

Canonical orientation docs:

- `AGENTS.md`
- `PROJECT_COORDINATION_INDEX.md`
- `docs/openclinxr/development-handoff.md`
- `docs/openclinxr/code-implementation-plan.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`
- `docs/agent-factory/README.md`
- `docs/agent-factory/operating-loop.md`
- `docs/agent-factory/model-assignment-policy.md`
- Latest `iterations/iteration-*/07-final-synthesis.md`
- `docs/superpowers/plans/2026-05-03-openclinxr-code-implementation-plan.md`
- `operator-steering-needed-questions.md`
- `operator-open-questions.md`
- `operator-suggestion-backlog.md`

Heartbeat continuation update:

- 2026-05-24: Visual QA evidence now rejects known prior humanoid realism regression cues (`persistent_gaze_readability_cue`, `floating_eye_focus_overlay_after_dialogue`, `broad_face_material_contrast_patch`) before adversarial visual QA can be considered ready. This prevents previously rejected eye/gaze/material shortcuts from re-entering screenshot evidence as "progress" and keeps the realism loop focused on product-quality mesh, material, facial, gaze, and lip-sync improvements.
- 2026-05-24: Humanoid-focused visual QA evidence now has an explicit `visualQaFocus: "humanoid_realism"` contract and must carry runtime realism signals for animated humanoid playback, authored clinical idle pose, visible mouth/eye expression cues, and dialogue viseme/gaze mapping. Older general scene screenshots can still pass as general-scene artifacts, but future humanoid realism screenshots should not be treated as ready without these linked signals.
- 2026-05-24: The humanoid visual QA signal list now derives from the runtime realism gate's exported required signal contract, excluding only visual-QA-irrelevant scenario-panel and locomotion signals. Keep future humanoid evidence updates centralized in the runtime realism gate first, then let visual QA consume the shared contract.
- 2026-05-24: Encounter runtime asset bundles now carry `evidenceGateRefs`, including pending runtime-realism and visual-QA gates on the local generated XR bundle. This makes the admin-generated encounter pipeline operationally track whether a frozen learner bundle has the evidence needed before adversarial visual/runtime review.
- 2026-05-24: Blob-compatible frozen encounter bundle writes now preserve attached `evidenceGateRefs` in the serialized bundle JSON, so Azurite/Azure storage publication can carry the runtime-realism and visual-QA gate linkage alongside generated asset references.
- 2026-05-24: The API scene-generation publication-readiness endpoint and admin queue panel now surface evidence gate refs for asset review, runtime realism, and visual QA. This prevents "publisher ready" from being mistaken for evidence-complete learner readiness and keeps the admin-triggered asset pipeline aligned with the evidence-gated encounter goal.
- 2026-05-24: The admin API client fixture/contract test now preserves publication-readiness `evidenceGateRefs`, closing the UI client contract gap so asset-review and runtime-realism gate state can flow from API to admin orchestration without being silently dropped.
- 2026-05-24: Long-running encounter asset-generation worker executions now emit `evidenceGateRefs` for asset review, runtime realism, visual QA, and Quest runtime evidence. This aligns queue processing and durable job state with the admin/API evidence-gated bundle posture.
- 2026-05-24: Mongoose encounter asset-generation job records now persist and reload worker `evidenceGateRefs`, including immutable array copies. This makes long-running Azurite/Azure queue-to-Mongoose jobs resumable with their asset-review, runtime-realism, visual-QA, and Quest evidence gates intact.
- 2026-05-24: Encounter asset-generation plans now name runtime realism, humanoid visual QA, and Quest runtime evidence as explicit executable-encounter prerequisites alongside scene manifest, blob assets, learner bundle persistence, and human review. This prevents the queue plan itself from implying readiness after publication alone.
- 2026-05-24: Scene-generation publication readiness now separates `canRunGeneratedBundlePublisher` from `canUseGeneratedBundleForLearnerRuntime`. The admin UI keeps learner runtime use blocked until runtime-realism, visual-QA, and Quest evidence gates are attached, even when the local bundle publisher can run.
- 2026-05-24: Asset-registry now exposes `evaluateEncounterRuntimeLearnerUseGate`, deriving learner-use readiness from a bundle's `evidenceGateRefs`. This centralizes the rule that generated bundles remain blocked for learner runtime until evidence gates are attached and unblocked.
- 2026-05-24: The API publication-readiness route now uses asset-registry's `evaluateEncounterRuntimeLearnerUseGate` instead of app-local readiness booleans, so learner runtime blockers are derived from the same bundle evidence-gate contract used by the asset pipeline.
- 2026-05-24: The local generated learner bundle now includes a pending `quest_runtime_evidence` gate alongside runtime-realism and visual-QA gates, so learner-use readiness reflects Quest/WebXR evidence requirements rather than only desktop/runtime proof.
- 2026-05-24: Humanoid-focused visual QA now requires structured screenshot analysis for face visibility, mouth movement readability, gaze target alignment, pose naturalness, and hand/arm naturalness. A blocked analysis item blocks adversarial visual QA readiness, turning screenshot review into concrete realism work items instead of free-form notes.

## Current State

Completed or mostly completed:

- The repo has been relocated to `/Volumes/files/src/openclinxr`; the old Documents workspace is stale.
- `@openclinxr/session-state` exists and exposes multi-actor session state, actor turn persistence contracts, emotional-state timelines, durable clinical-event record types, review projections, and websocket message design contracts.
- `@openclinxr/data-mongodb` has Mongo-backed repositories for scenarios, traces, review packets, exam forms, station-run queue snapshots, actor turns, emotional-state timelines, and durable clinical events.
- Durable clinical-event persistence is approved in `proposals/approved/proposal-durable-clinical-event-persistence.md`.
- Durable actor-turn persistence is approved in `proposals/approved/proposal-durable-actor-turn-persistence-promotion.md`.
- Quest manual performance checker supports both raw manual reports and copied UI payloads shaped as `{ manualPerformanceDraft, captureSummary }`.
- The benchmark gate can derive manual Quest posture from matching `docs/openclinxr/quest-manual-performance-*.json` reports.
- Operator blocker tracking is centralized in `operator-steering-needed-questions.md`; nonblocking questions and ideas should not interrupt autonomous work.

Important current boundaries:

- Patrick approved local tooling installs when they are necessary to advance asset generation or 3D environment work. Prefer existing installed tooling first, document any new install with license/provenance posture, and keep cloud APIs, paid APIs, hosted services, production deployment, and runtime dependency changes out of scope unless separately approved.
- Do not wire durable clinical events into `apps/api`, REST, GraphQL, WebSocket runtime behavior, or production flows without a new approval.
- Do not add Redis, Redka, Colyseus, bitECS, WebTransport, QUIC, Web3, cloud databases, paid APIs, or hosted services for the current persistence slice.
- Do not claim Quest readiness until the manual worn-headset report clears frame pacing, trace interaction, locomotion, and latency thresholds.
- Do not claim production asset readiness from placeholder or fixture evidence.
- Do not make clinical validity, licensure, ECFMG, USMLE, diagnostic-performance, or high-stakes scoring claims.

## Autonomous Continuation Contract

The 2026-05-21 run incorrectly stopped because a progress checkpoint was sent as a final response even though none of the operator-defined stop conditions had been met. Treat that as a known failure mode to avoid.

- Re-read `AGENTS.md` at the start of each new session, after context compaction, and before deciding whether to stop.
- A completed slice, focused verification pass, benchmark smoke, or documentation update is not a stop condition.
- Checkpoints are not chat events. Do not send progress updates, status updates, checkpoint summaries, file-change summaries, test summaries, "what changed" summaries, or final-response messages during autonomous continuation.
- Status belongs in this file and the worker backlog, not in chat as a final response.
- After each completed slice, update status docs, run focused verification for touched packages, choose the next approved local deterministic slice, and continue.
- A blocker on one lane is not a stop condition. Record it in `operator-steering-needed-questions.md` or `operator-open-questions.md` with a recommended default, mark the lane, then pivot to another approved product-advancement lane.
- Send a final response only when all approved work in this plan is complete, every approved lane is blocked after recording operator questions, Patrick explicitly asks to pause/stop, Patrick asks a direct question/status request, or the platform requires an answer.
- If context feels low, compact status into this file and continue with the next slice instead of finalizing.

## Active Product Advancement Queue

This section is the active source of truth for what to do next. It overrides old chronological "Next Task C" breadcrumbs lower in this file and in historical iteration notes.

`PROJECT_COORDINATION_INDEX.md` is the short coordinator dashboard for this queue, sub-agent work orders, and drift correction. If this file feels too long or scattered, read the coordination index first.

### Protected Blueprint-Factory Guardrails

`docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md` is protected coordination policy and must be applied before selecting autonomous slices. Agents must not delete, weaken, bypass, rename, or reinterpret those guardrails.

`docs/openclinxr/doc-authority-registry-2026-05-27.md` is the current Markdown authority map. Use it before relying on old plans, iteration outputs, proposals, evidence reports, temporary notes, or handoff files as instructions.

`docs/openclinxr/generated-artifact-registry-2026-05-27.md` is the current generated artifact authority map. Use it before deleting, ignoring, or committing generated JSON, screenshots, local cache outputs, or runtime asset artifacts.

Current correction: recenter on the blueprint-driven encounter factory. Visual assets, garments, screenshots, and provider gates are supporting lanes only. The active product is a reviewed encounter specification/blueprint that autonomously drives environment, actors, conversation tooling, emotional-state timelines, locomotion, gaze/lip-sync, clothing, equipment, trace interactions, persistence metadata, review packets, provider gates, shared asset-library reuse, and runtime/screenshot evidence.

Conversation tooling is first-class. If visual asset work repeats without advancing actor dialogue, learner interaction, turn-taking, emotion transitions, trace tags, replayable actor turns, or review-safe conversation evidence, the coordinator must choose a conversation/runtime/review slice next unless all such lanes are blocked.

Selection rule: choose the first safe lane that can be advanced locally without credentials, paid/cloud/API use, destructive actions, production deployment, or new unapproved runtime wiring.

1. Worker 7 plus Worker 8 completed-station faculty review path.

   Goal: make the ED chest-pain station feel more like a usable faculty workflow after a learner completes the deterministic station.

   Product advancement target: faculty can inspect a completed station through review-safe API/admin surfaces, including timeline, missing required behaviors, unsafe/late signals, note evidence, and reviewer decision posture without raw private payloads.

   Expected touch areas:

   - `apps/api`
   - `apps/ui-admin`
   - `packages/openclinxr/review-workflow`
   - `packages/openclinxr/graphql`
   - `packages/openclinxr/test-harness`

   Default next move: inspect only the existing review packet/replay API and admin workbench files, then add the smallest missing product behavior. Do not run broad evidence refreshes before this inspection.

   2026-05-21 progress: the admin Review Replay page now synthesizes completed-station evidence into a faculty review posture panel. It summarizes whether a changes-requested draft is recommended from missing required tags, safety flags, late behaviors, patient-note availability, and provider evidence posture while preserving review-safe packet data only. Focused `@openclinxr/ui-admin` test and typecheck passed.

   2026-05-21 progress: the admin "Create seed replay" path now creates a more representative completed-station review seed by recording ECG request, urgent escalation, team communication, and a patient note before opening the replay. This makes the faculty review path product-useful instead of a single-event scaffold. Focused `@openclinxr/ui-admin` test and typecheck passed.

2. Worker 9 XR trace interaction or locomotion instrumentation.

   Goal: make one concrete learner XR interaction path more observable and closer to readiness.

   Product advancement target: improve trace-button, controller/hand-select, or locomotion diagnostic capture in `apps/ui-xr`, with IWSDK sidecar considered for supporting parity/tooling but not added to the production runtime.

   Expected touch areas:

   - `apps/ui-xr`
   - `packages/openclinxr/iwsdk-spike`
   - `apps/ui-xr-iwsdk-spike`
   - `tools/openclinxr/*quest*`

   Default next move: only choose this lane when physical Quest evidence or UI instrumentation can change the readiness story; do not rerun known-failing Quest/IWSDK gates without changed instrumentation or operator action.

   2026-05-21 progress: the XR scene now serves the generated humanoid fixture through `apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb` and loads it into the named patient, nurse, and spouse actor slots in `apps/ui-xr/src/main.ts`. Each actor keeps the existing primitive mesh as a fallback if GLB loading fails, and boot evidence records generated-humanoid load success/failure without claiming Quest or production readiness. Focused `@openclinxr/ui-xr` test and typecheck passed.

   2026-05-21 progress: the XR scene now also serves generated medical-equipment GLBs through `apps/ui-xr/public/xr-assets/medical-equipment/` and loads the ECG cart plus IV pole/pump into named scene slots for IWSDK hierarchy checks. Primitive equipment fallbacks remain if GLB loading fails, and boot evidence records generated-equipment load success/failure without claiming Quest or production readiness. Focused `@openclinxr/ui-xr` test and typecheck passed.

   2026-05-21 progress: manual Quest/WebXR evidence payloads now include `sceneAssetEvidence` from `window.__openClinXrSceneAssetEvidence`, recording generated humanoid/equipment asset paths, named scene slots, pending/loaded/failed status, and fallback activation counts. This makes headset/IWSDK captures able to distinguish "GLB loaded" from "primitive fallback active" without relying on screenshots alone. Focused `@openclinxr/ui-xr` test and typecheck passed.

   2026-05-21 progress: IWSDK scene-hierarchy targets now include the generated GLB child objects for patient, nurse, spouse, ECG cart, and IV pole/pump, not just their fallback parent slots. This lets sidecar/agent review catch missing generated assets directly while preserving the fallback scene path. Focused `@openclinxr/ui-xr` test, typecheck, and build passed.

   2026-05-21 progress: the Quest Evidence panel now shows a generated scene asset status row (`Assets`) with loaded/expected counts, load failures, and active fallback count. This lets an in-headset operator see whether humanoid/equipment GLBs appeared before copying manual evidence. Focused `@openclinxr/ui-xr` test, typecheck, and build passed.

   2026-05-21 progress: `@openclinxr/ui-xr` now hash-checks the served generated humanoid, ECG cart, and IV pole/pump GLBs against their local provenance files, matching the existing hand-mesh drift guard pattern. Focused `@openclinxr/ui-xr` test/typecheck passed.

   2026-05-21 progress: generated humanoid GLBs are now role-tinted at load time for patient, nurse, and spouse slots, making the reused local fixture visually distinguishable in the VR scene without adding external assets or claiming production character fidelity. Focused `@openclinxr/ui-xr` test, typecheck, and build passed.

   2026-05-21 progress: the XR scene now adds in-scene role/name plates for Robert Hayes, Nurse Maria Alvarez, and Anna Hayes so the generated humanoids are identifiable during headset visual QA without relying only on side-panel text. Focused `@openclinxr/ui-xr` test, typecheck, and build passed.

   2026-05-21 progress: generated ECG cart and IV pole/pump scene slots now include in-scene labels (`12-lead ECG`, `IV pump`) so the local fixture equipment is identifiable in headset visual QA. Focused `@openclinxr/ui-xr` test, typecheck, and build passed.

   2026-05-23 progress: generated humanoid dialogue behavior now includes visible eye-focus cues and bounded speaker-facing yaw toward the active gaze target. The existing phoneme/viseme mouth cue and gaze line remain, but speaking actors now also expose `dialogue_eye_focus_target_cue` and `speaking_humanoid_turns_toward_gaze_target` runtime affordance evidence without claiming production lip sync or eye tracking. Focused `@openclinxr/ui-xr` test/typecheck passed.

   2026-05-23 progress: remote actor-response text now drives the same humanoid dialogue playback path as local mock dialogue. When the API returns review-safe actor text, the XR dialogue panel updates and the corresponding generated humanoid receives phoneme/viseme, eye-focus, and gaze-target behavior before optional local voice synthesis is requested. Focused `@openclinxr/ui-xr` test/typecheck passed.

   2026-05-23 progress: the initial ED chest-pain dialogue now primes the generated patient humanoid speech path as soon as the patient GLB loads. This makes local visual QA start with a speaking/gazing patient rather than waiting for a trace action, while preserving the same evidence-gated non-production caveats. Focused `@openclinxr/ui-xr` test/typecheck passed.

3. Worker 4 plus Worker 2 scenario-bank expansion.

   Goal: extend the Step 2 CS-inspired exam skeleton beyond a single deterministic proof point.

   Product advancement target: add or harden multi-actor, environment, equipment, trace-tag, rubric, communication-profile, and asset-needs records in a way that supports future scenario authoring and review.

   Expected touch areas:

   - `packages/openclinxr/scenario-fixtures`
   - `packages/openclinxr/shared-schemas`
   - `packages/openclinxr/domain`
   - `docs/openclinxr/*case*`

   Default next move: prefer schema-backed fixture expansion over free-form planning prose.

4. Worker 11 reviewed production-asset evidence ladder for one named artifact.

   Goal: move one artifact from placeholder planning toward reviewed asset-production evidence without claiming production readiness.

   Product advancement target: one named ED station artifact has manifest, provenance, license posture, optimization target, Quest QA status, and review blockers that a future asset worker can act on.

   Expected touch areas:

   - `packages/openclinxr/asset-registry`
   - `packages/openclinxr/capability-gateway`
   - `docs/openclinxr/*asset*`

   Default next move: build a stronger artifact contract or review checklist before refreshing asset evidence again.

   2026-05-21 progress: the generated-human-rigging lane now has a deterministic local Blender-scripted rigged humanoid artifact generator. It materializes `.openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb`, `canonical-skeleton-binding.json`, and `skin-weight-quality.json`; the GLB includes a canonical humanoid armature, skinned mesh, required bone names, and OpenClinXR anchor nodes. No new install was needed because `/opt/homebrew/bin/blender` was already available. The related artifact-evidence gate now distinguishes materialized fixture artifacts from missing artifacts while still blocking production readiness on evidence tier/review posture. Focused verification passed: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:human-rigging:validate`, and `pnpm asset:production:artifact-evidence:validate`.

   2026-05-23 progress: the generated-human-rigging lane now uses the previously identified preferred humanoid generator, Anny `0.3.1`, for the neutral base body mesh before wrapping it in the OpenClinXR canonical Blender armature. The local install lives under `.openclinxr/tool-runtimes/anny-py311`; source artifacts are materialized as `anny-neutral-generated-human.obj` and `anny-source-generator-manifest.json`, and the served XR humanoid GLB hash/provenance was updated. This remains an evidence-gated local authoring candidate with heuristic skinning, not a production character, Quest-readiness, clinical-validity, or scoring claim. Focused verification passed: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts` and `pnpm asset:human-rigging:validate`.

   2026-05-23 progress: the Anny-derived humanoid generator now exports additional local fixture character-detail nodes for visible hair, eyes, scrub tunic, scrub pants, and shoes, and the public XR humanoid hash/provenance was refreshed. CDP runtime evidence confirms the generated humanoid GLB loads with fallback inactive and exposes `generated_humanoid_hair_clothing_eye_detail_cue`, but the default desktop screenshot still reads too much like a primitive silhouette. Treat this as a visual-fidelity blocker for the next asset slice: improve the actual mesh/material/camera presentation rather than claiming realistic humanoid readiness. Focused verification passed: generated-human rigging tests, `pnpm asset:human-rigging:validate`, `@openclinxr/ui-xr` test/typecheck, and visual screenshot capture.

   2026-05-23 progress: asset-registry now exposes an admin-initiated `ScenarioSceneGenerationPipelineWorkOrder` contract. It models scenario configuration as the trigger for full scene generation across asset-need expansion, Anny humanoids, hair/clothing/skin, rigging/animation, equipment/environment GLBs, Azurite/Azure blob publication, runtime bundle binding, and review/Quest evidence gates. The admin environment-generation panel now states this operational pipeline boundary. Focused asset-registry and ui-admin tests/typechecks passed.

   2026-05-23 progress: the admin-initiated scene-generation pipeline is now available through a stable control-plane REST route, API client method, and admin workbench panel. The seed-bank pipeline queue exposes pending stages for scenario configuration, humanoid generation, hair/clothing/skin, rigging/animation, equipment/environment, blob publication, runtime bundle binding, and review/Quest evidence without claiming asset production or Quest readiness. Focused rest, asset-registry, api, and ui-admin tests/typechecks passed.

   2026-05-21 progress: the skin/clothing provenance lane now has repo-authored local fixture artifacts for the generated humanoid: `.openclinxr/asset-production/ed-chest-pain/skin-clothing-provenance/skin-texture-provenance.json`, `clothing-mesh-provenance.json`, and `runtime-safe-materials.json`. These capture procedural material parameters, scrub/shoe blockout provenance, runtime-safe material posture, and explicit non-production caveats without external assets or installs. Focused verification passed: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/skin-clothing-provenance-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:skin-clothing:validate`, and `pnpm asset:production:artifact-evidence:validate`.

   2026-05-21 progress: the medical-equipment lane now has local Blender-scripted ED prop artifacts for `.openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb`, `iv-pole-with-pump.glb`, and `equipment-provenance.json`. These are deterministic low-poly fixtures for ECG-request and ED-environment workflow cues only; clinical affordance, scale, visual fidelity, interaction anchors, and Quest performance review remain blockers before production use. Focused verification passed: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/skin-clothing-provenance-artifacts.test.ts tools/openclinxr/medical-equipment-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:medical-equipment:validate`, and `pnpm asset:production:artifact-evidence:validate`.

   2026-05-21 progress: the remaining asset-production support slots are now materialized through `tools/openclinxr/asset-production-support-artifacts.ts`: animation retargeting placeholders, LOD/texture/collider budget JSON, and Quest station-bundle/multi-actor/frame-pacing evidence JSON. The production artifact manifest now has all required artifact files materialized locally, while still blocking production readiness on fixture evidence tier and required review posture. Focused verification passed: `vitest run tools/openclinxr/generated-human-rigging-artifacts.test.ts tools/openclinxr/skin-clothing-provenance-artifacts.test.ts tools/openclinxr/medical-equipment-artifacts.test.ts tools/openclinxr/asset-production-support-artifacts.test.ts tools/openclinxr/asset-production-artifact-evidence.test.ts`, `pnpm asset:production:support-artifacts:validate`, and `pnpm asset:production:artifact-evidence:validate`.

5. Worker 5 plus Worker 12 replayable station evidence.

   Goal: make review-safe station evidence more durable and replayable inside the approved persistence boundary.

   Product advancement target: safer review/replay projections and persistence guards for traces, review packets, actor turns, emotional-state timelines, and approved durable clinical events.

   Expected touch areas:

   - `packages/openclinxr/review-workflow`
   - `packages/openclinxr/trace-ledger`
   - `packages/openclinxr/session-state`
   - `packages/openclinxr/data-mongodb`

   Default next move: stay package-local unless a proposal already approves API/runtime wiring.

Anti-toil defaults:

- Do not run another local voice/model/source-currentness refresh unless a concrete Worker 10 implementation slice needs it.
- Do not rerun `pnpm agent:benchmarks` after every small command; run it once after a coherent build/evidence batch.
- Do not rerun known-failing Quest/IWSDK gates unless new instrumentation, headset action, or sidecar evidence can change the result.
- If two consecutive slices would be evidence-only, force agent-factory realignment using Chief Coordinator, Implementation Planning Lead, Implementation Plan Gap Attacker, and VP Engineering Delivery memories.
- Keep operator questions out of chat unless truly blocking; write nonblocking steering to `operator-open-questions.md` with a recommended default.

## Maintenance Guardrails

The following former priority tasks are now guardrails, not active next steps:

- Durable clinical-event persistence semantics are locked unless a touched file regresses idempotency, redaction, deterministic replay, or the `database_source_of_truth` boundary.
- Quest manual payload regression coverage is locked unless a touched checker, benchmark, or XR evidence-export file changes the raw/wrapper evidence contract.
- Evidence-gate cadence should verify touched packages and coherent batches only; stale red dashboards do not outrank product advancement.

## Concrete Autonomous Task Queue

### Task A: Historical/Maintenance: Durable Clinical-Event Persistence Hardening

Goal: make the currently implemented durable clinical-event slice self-evidently safe to resume after interruption.

Status as of 2026-05-20: the first hardening pass is complete. Session-state, Mongo repository, and architecture-rule tests now lock insert-once `clinicalEventId` idempotency, deterministic same-second replay ordering, and the no-MongoDB/no-Redis/no-Redka/no-WebTransport/no-QUIC/no-Web3/no-API-runtime dependency boundary for `@openclinxr/session-state`. The Phase 2 persistence note clarifies that conflicting duplicate saves do not create revisions, mutate status history, or produce conflict audit records without a separate proposal.

2026-05-21 continuation: nested durable clinical-event private payloads are now cloned before session-state persistence and Mongo handoff, so caller-side mutation cannot alter stored private review/redaction inputs. Focused session-state and data-mongodb test/typecheck passed.

2026-05-21 continuation: the in-memory durable clinical-event store now rejects non-`database_source_of_truth` store posture at runtime, matching the Mongo boundary guard and keeping cache-backed clinical-event writes out of the approved persistence slice. Focused session-state test/typecheck passed.

2026-05-21 continuation: durable clinical-event review projections now also reject non-`database_source_of_truth` records, so direct projection and design-only websocket message helpers cannot expose cache-backed clinical-event records. Focused session-state test/typecheck passed.

Implementation outline:

- Add focused session-state tests for first-write-wins idempotency, distinct-ID status history, and redacted websocket projections.
- Add focused Mongo tests for conflicting duplicate saves, stable same-second ordering, and redacted review projections after persistence.
- Add or tighten an architecture-rule assertion only if the existing rules do not already protect session-state from MongoDB/Redis/runtime imports.
- Update the persistence Phase 2 doc with the final semantics: `clinicalEventId` is an idempotency key, not a mutable event revision key.

Verification commands when allowed:

```bash
pnpm --filter @openclinxr/session-state test
pnpm --filter @openclinxr/session-state typecheck
pnpm --filter @openclinxr/data-mongodb test
pnpm --filter @openclinxr/data-mongodb typecheck
pnpm --filter @openclinxr/architecture-rules test
pnpm security:audit-policy
pnpm security:licenses
git diff --check
```

Local command-path note: in the current Codex shell, plain `pnpm` can still resolve through a broken Homebrew Node/ICU path. Use this prefix for verification commands, especially tools that spawn `pnpm` internally:

```bash
PATH=/Users/patrick/.nvm/versions/node/v24.15.0/bin:/Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/shims:$PATH /Users/patrick/.nvm/versions/node/v24.15.0/bin/node /Users/patrick/.nvm/versions/node/v24.15.0/lib/node_modules/corepack/dist/pnpm.js
```

### Task B: Historical/Maintenance: Quest Manual Payload Regression Hardening

Goal: prevent future regressions where copied in-app Quest Evidence payloads are accepted by the checker but mishandled by the benchmark rollup.

Status as of 2026-05-20: the first regression pass is complete. The checker now has explicit raw-versus-copied readiness parity coverage, and the benchmark-gate tests now prove copied UI payloads are selected through the normal `quest-manual-performance-*.json` evidence path while the template remains excluded.
Existing benchmark coverage also confirms copied-payload `harvestSummary` data is surfaced as `harvest_summary` in the benchmark report with related blockers and next steps, so no duplicate test was added for that already-covered path.

Implementation outline:

- Add benchmark-gate tests that exercise both raw and wrapper-shaped `quest-manual-performance-*.json` files.
- Add checker tests around raw reports with reproducibility metadata.
- Update operator-facing Quest docs only if the tests reveal the existing guidance is ambiguous.

Verification commands when allowed:

```bash
node_modules/.bin/vitest tools/openclinxr/quest-manual-performance-check.test.ts
node_modules/.bin/vitest tools/agent-factory/benchmark-gate-report.test.ts
node_modules/.bin/tsx tools/openclinxr/check-quest-manual-performance.ts --input docs/openclinxr/quest-manual-performance-2026-05-04.json --output /tmp/quest-manual-performance-check.json
node_modules/.bin/tsx tools/agent-factory/build-benchmark-gate-report.ts
```

### Task C: Historical Ledger: Evidence Gate Continuation

Goal: preserve evidence and implementation history without turning it into the active task queue. The active queue above overrides historical "next slice" notes in this ledger.

Status as of 2026-05-21: Worker 0 security cadence is current. A fresh `pnpm audit --audit-level=high` snapshot found two high `fast-uri@3.1.0` advisories through `ajv`; the repo now pins `fast-uri@3.1.2` through a documented package-manager override, refreshed the lockfile/install, and records passing audit policy and license gates in `docs/openclinxr/security-audit-2026-05-21.json`, `docs/openclinxr/security-audit-policy-2026-05-21.json`, and `docs/openclinxr/security-audit-exceptions.md`.

Worker 10 provider-gateway audit-contract slice is complete. Model and voice mock provenance now carries explicit request IDs, provider/model identity, model runtime name, latency, and safety status without adding API/runtime wiring or enabling local/cloud providers. Focused verification passed for `@openclinxr/model-gateway` test/typecheck and `@openclinxr/voice-gateway` test/typecheck.

Worker 10 named local adapter stub slice is complete. `@openclinxr/model-gateway` now exports MLX, llama.cpp, and Ollama local model stubs, and `@openclinxr/voice-gateway` exports a VibeVoice local voice stub. Each remains visible through health checks but returns `not_configured` until explicitly enabled. Focused verification passed again for both gateway packages' test/typecheck scripts.

Worker 10 provider audit-record contract slice is complete. `@openclinxr/shared-schemas` now exports a `ProviderAuditRecordSchema`/type/validator, and model plus voice provenance types depend on that shared contract. Focused verification passed for `@openclinxr/shared-schemas`, `@openclinxr/model-gateway`, and `@openclinxr/voice-gateway` test/typecheck scripts.

Worker 11 asset-registry validation hardening slice is complete. Asset manifests now carry explicit Quest QA status, and manifest evaluation emits blockers for missing license status, missing optimization targets, missing Quest QA status, and placeholder assets without explicit placeholder/simulation QA status. Focused verification passed for `@openclinxr/asset-registry` test/typecheck.

Worker 11 ED placeholder manifest expansion slice is complete. The ED chest pain asset registry now includes patient, spouse, nurse, ED room, stretcher bed, bedside monitor, ECG cart, and IV stand placeholder records. Optional planning records do not expand the scenario's required runtime `assetNeeds`, and placeholder records remain production-blocked. Focused `@openclinxr/asset-registry` test/typecheck passed after fixture updates.

Worker 11 asset manifest schema-consumption slice is complete. `@openclinxr/shared-schemas` now exposes `AssetManifestSchema` and a validator, and `@openclinxr/asset-registry` validates manifests before registry upsert while keeping readiness evaluation available for diagnostic blockers. Focused shared-schemas and asset-registry test/typecheck scripts passed.

Worker 3 domain command-validation slice is complete. Station transitions now reject impossible command timestamps and empty patient notes while preserving the doorway-to-encounter-to-note-to-review path. Focused `@openclinxr/domain` test/typecheck passed.

Worker 3 deterministic scheduled-event slice is complete. Due scheduled events now sort by `atSecond` and then `eventId`, preserving deterministic replay when multiple interruptions become due together. Focused `@openclinxr/domain` test/typecheck passed.

Worker 3 domain dependency-boundary slice is complete. `@openclinxr/architecture-rules` now checks that `@openclinxr/domain` depends only on shared schemas and has no API, React, MongoDB, model, voice, REST, or app imports. Focused architecture test and architecture-rules typecheck passed.

Worker 2 `StationRun` schema slice is complete. `@openclinxr/shared-schemas` now exposes `StationPhaseSchema`, `StationRunSchema`, and `validateStationRun`, and `@openclinxr/domain` aliases its station-run type to the shared schema contract. Focused shared-schemas and domain test/typecheck passed.

Worker 2 named provider-audit schema slice is complete. `@openclinxr/shared-schemas` now exports `ModelProviderAuditSchema`, `VoiceProviderAuditSchema`, and corresponding validators as aliases of the shared provider audit-record contract, with coverage that missing provider identity fails. Focused shared-schemas test/typecheck passed.

Worker 2 `ExamBlueprint` schema slice is complete. `@openclinxr/shared-schemas` now exposes `ExamBlueprintSchema`, timing and station-slot schemas, and `validateExamBlueprint`; `@openclinxr/exam-assembly` aliases its blueprint types to the shared schema contract. Focused shared-schemas and exam-assembly test/typecheck passed.

Worker 5 trace-ledger append-only hardening slice is complete. `InMemoryTraceLedger` now clones trace events on append and replay so caller mutation cannot alter stored history. Focused `@openclinxr/trace-ledger` test/typecheck passed.

Worker 6 optional runtime skip-reporting slice is complete. The deterministic station simulation and mock benchmark report now include `optionalRuntimeSkips` for local model/voice providers that are intentionally `not_configured`, and the mock benchmark CLI emitted that field successfully. Focused `@openclinxr/test-harness` test/typecheck passed.

Worker 4 dialogue fixture seed slice is complete. The ED chest pain fixture now exports deterministic dialogue seeds for patient history, nurse escalation, spouse communication, and a hidden-truth guardrail probe. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 fixture alignment slice is complete. Scenario-fixtures tests now assert dialogue seed actor IDs exist, expected trace tags align with the required/guardrail vocabulary, and review rubric IDs remain unique. Focused scenario-fixtures test/typecheck passed.

Worker 5 review-workflow late-classification slice is complete. Late trace tags now use the earliest observed event for each tag rather than input order, preventing later duplicate events from incorrectly marking on-time behaviors late. Focused `@openclinxr/review-workflow` test/typecheck passed.

Worker 5 review timeline deterministic-order slice is complete. Timeline entries now sort by sequence, time, event type, source, actor, and tag so tied or sequence-less events do not depend on input order. Focused `@openclinxr/review-workflow` test/typecheck passed.

Worker 5 replay-sequence normalization slice is complete. Review packets now preserve source sequence values only when every timeline event has a unique explicit finite sequence; duplicate or sequence-less inputs are normalized to dense replay order after deterministic sorting, preventing ambiguous UI replay keys while keeping unambiguous source sequences intact. Focused `@openclinxr/review-workflow` test/typecheck passed.

Worker 5 patient-note consistency slice is complete. Review packet construction now rejects patient notes whose `stationRunId` differs from the packet station run. Focused `@openclinxr/review-workflow` test/typecheck passed.

Worker 5 review-packet input immutability slice is complete. Review packet construction now clones the patient note and faculty score draft into the packet so caller-side mutation cannot alter faculty review evidence after validation. Focused review-workflow test/typecheck passed.

Scenario-runtime provider audit propagation slice is complete. Actor response and voice synthesis calls now pass explicit provider request IDs, and runtime tests assert request ID, model runtime name, and safety status in trace provenance. Focused `@openclinxr/scenario-runtime` test/typecheck passed.

Worker 12 Mongo trace clone slice is complete. `MongoTraceRepository` now clones trace events before insert/upsert so Mongo driver metadata cannot mutate caller-owned trace objects. Focused `@openclinxr/data-mongodb` test/typecheck passed.

Worker 12 Mongo trace validation slice is complete. Mongo trace persistence now runs the shared trace-event validator before append or replay upsert, preventing whitespace-only identity trace records from being stored. Focused data-mongodb test/typecheck passed.

Worker 12 API sink trace station-scope guard slice is complete. The Mongo API persistence sink now rejects trace-event batches containing events whose `stationRunId` differs from the sink path station run, preventing cross-run trace writes. Focused data-mongodb test/typecheck passed.

Worker 12 review-packet index slice is complete. Mongo review packets now declare an index on `facultyScoreDraft.status` plus `scenarioId`, covering review-status query posture alongside station-run and scenario lookups. Focused `@openclinxr/data-mongodb` test/typecheck passed.

Worker 12 review-packet validation slice is complete. Mongo review-packet persistence now runs the shared review-packet validator before upsert, preventing inconsistent trace-quality or identity records from being stored. Focused data-mongodb test/typecheck passed.

Worker 12 API sink review-packet station-scope guard slice is complete. The Mongo API persistence sink now rejects review packets whose packet `stationRunId` differs from the sink path station run, preventing cross-run review packet writes. Focused data-mongodb test/typecheck passed.

Worker 12 scenario source-index slice is complete. Mongo scenarios now declare an index on `governance.sourceIds` plus `status`, covering source-ID query posture. Focused `@openclinxr/data-mongodb` test/typecheck passed.

Worker 12 scenario validation slice is complete. Mongo scenario persistence now runs the shared scenario validator before upsert, preventing invalid review-gate/governance scenario records from being stored. Focused data-mongodb test/typecheck passed.

Exam-assembly timing determinism slice is complete. Timing windows now sort by station order then slot ID, and break checkpoints sort chronologically even when blueprint input arrays are unsorted. Focused `@openclinxr/exam-assembly` test/typecheck passed.

Exam-assembly station-ref determinism slice is complete. Exam form assembly now assigns scenarios against blueprint station slots sorted by station order, so unsorted blueprint input cannot rotate scenario-to-station references. Focused exam-assembly test/typecheck passed.

Worker 11 asset listing determinism slice is complete. `InMemoryAssetRegistry.listByScenario` now returns scenario assets sorted by `assetId`, avoiding insertion-order-dependent downstream planning output. Focused `@openclinxr/asset-registry` test/typecheck passed.

Capability-gateway job-store immutability slice is complete. The in-memory asset-generation job store now clones records on save/get/list so returned job records cannot mutate stored lifecycle history or artifacts. Focused `@openclinxr/capability-gateway` test/typecheck passed.

Worker 8 admin review-gate role guard slice is complete. The scenario detail workbench now disables local clinical approval when scenario governance does not include a clinical reviewer role, shows an explicit governance warning, and prevents the UI from submitting a clinical approval mutation in that state. Focused `apps/ui-admin` App test and typecheck passed.

Worker 8 review replay evidence-flag slice is complete. The review replay workbench now exposes late-behavior tags and safety flag trace events alongside missing required tags, giving faculty a compact view of completed-station concerns without relying on hidden/private payloads. Focused `apps/ui-admin` App test and typecheck passed.

Worker 8 responsive text-fit slice is complete. Admin workbench cards, metrics, rows, compact lists, and station-run input now allow long clinical IDs/tags to wrap within desktop and mobile grids instead of forcing horizontal overflow. Focused `apps/ui-admin` production build passed.

Worker 9 XR trace readiness slice is complete. The XR runtime now summarizes progress against required trace tags only, ignoring duplicate completed tags and unmapped runtime probes so headset trace status cannot overstate completion. Focused `apps/ui-xr` runtime-state test and typecheck passed.

Worker 9 station-clock guard slice is complete. The XR runtime timer now clamps negative or non-finite inputs to `00:00`, preventing malformed encounter clock text if a caller or browser timing edge produces an invalid elapsed value. Focused `apps/ui-xr` runtime-state test/typecheck passed.

Worker 9 desktop fallback control text-fit slice is complete. Status-strip text, runtime-panel content, and trace buttons now wrap long labels/IDs on narrow desktop or headset-browser viewports, with a static asset guard to prevent regressions. Focused `apps/ui-xr` static-assets test and production build passed.

Worker 2 communication-profile schema slice is complete. `@openclinxr/shared-schemas` now exposes a bounded `CommunicationProfileSchema`/type/validator and lets actor cards carry an optional communication profile for style, mood, escalation, de-escalation, adverse response, and cultural/language notes. Focused shared-schemas test/typecheck passed.

Worker 6 benchmark unsafe-signal slice is complete. Mock benchmark reports now use `traceQuality.unsafeEventCount` as the authoritative unsafe-event review signal, avoiding undercounting when unsafe evidence is summarized in trace quality rather than enumerated strings. Focused test-harness benchmark-report test/typecheck passed.

Worker 7 API scenario-review decision ordering slice is complete. Persisted admin scenario-review decisions now sort deterministically by reviewed time, scenario ID, version, reviewer role, and reviewer ID, preventing tied timestamps from replaying in persistence-dependent order. Focused `apps/api` app test/typecheck passed.

Worker 2 provider-health semantic slice is complete. `@openclinxr/shared-schemas` now rejects provider-health records that report `ready` while still carrying blockers, preserving the optional-runtime `not_configured` posture without allowing contradictory ready status. Focused shared-schemas test/typecheck passed.

Worker 5 safety-warning unsafe classification slice is complete. Review packets now classify `unsafe_` trace tags and `safety.*` event types as unsafe review events, so safety warnings captured outside the older `unsafe.*` event namespace still appear in faculty review signals. Focused review-workflow test/typecheck passed.

Worker 3 required-trace deduplication slice is complete. Domain required trace-tag evaluation now deduplicates required tags and ignores unmapped observed runtime probes, preventing duplicate backlog/config entries from overstating observed behavior counts. Focused domain test/typecheck passed.

Worker 4 ED communication-profile fixture slice is complete. The ED chest pain patient, spouse, and nurse actors now carry bounded communication profiles for style, mood, adverse response, de-escalation, escalation, and cultural/language notes, validated through the shared schema. Focused scenario-fixtures test/typecheck passed.

Capability-gateway manifest-capability guard slice is complete. Asset-generation jobs now fail if a worker returns an artifact manifest whose `capabilityId` differs from the requested capability, preventing mismatched generated outputs from being marked succeeded. Focused capability-gateway test/typecheck passed.

Worker 11 asset-registry immutability slice is complete. `InMemoryAssetRegistry` now clones manifests on upsert, get, and scenario listing so caller mutation cannot alter stored readiness inputs after validation. Focused asset-registry test/typecheck passed.

Worker 10 model-gateway provider-health guard slice is complete. `@openclinxr/model-gateway` now validates provider health before selecting a ready adapter, so contradictory `ready` records with blockers are skipped instead of being treated as available. Focused model-gateway test/typecheck passed.

Worker 10 voice-gateway provider-health guard slice is complete. `@openclinxr/voice-gateway` now uses the shared provider-health validator before selecting transcription or synthesis adapters, so contradictory `ready` records with blockers cannot be routed. Focused voice-gateway test/typecheck passed.

Worker 2 environment-manifest schema slice is complete. `@openclinxr/shared-schemas` now exposes `EnvironmentManifestSchema`/type/validator using the existing scenario environment, equipment, and asset-need contract, with positive and negative validation coverage. Focused shared-schemas test/typecheck passed.

Worker 4 scenario-bank environment-manifest validation slice is complete. Scenario-bank tests now validate every scenario's environment, equipment, and asset needs through the shared `EnvironmentManifest` contract alongside the full scenario schema. Focused scenario-fixtures test/typecheck passed.

Worker 5 publication asset-readiness scenario guard slice is complete. Scenario publication readiness now blocks learner publication when supplied asset readiness belongs to a different scenario ID, preventing cross-scenario readiness evidence from satisfying publication gates. Focused review-workflow scenario-publication test/typecheck passed.

Worker 5 reviewer-evidence reference guard slice is complete. Scenario publication readiness now treats blank reviewer evidence references as missing evidence, so required reviewer roles are not satisfied by placeholder strings. Focused review-workflow scenario-publication test/typecheck passed.

Worker 5 reviewer-role deduplication slice is complete. Scenario publication readiness now deduplicates repeated required reviewer roles before reporting missing approval evidence, preventing duplicated governance entries from creating noisy blocker output. Focused review-workflow scenario-publication test/typecheck passed.

Scenario-runtime provider-health snapshot validation slice is complete. `@openclinxr/scenario-runtime` now validates provider-health records before exposing the runtime snapshot, so contradictory ready-with-blockers records from gateway health checks fail closed. Focused scenario-runtime test/typecheck passed.

Worker 2 asset-need kind bounding slice is complete. Shared schemas now reuse a bounded asset-kind contract for both asset manifests and scenario asset needs, so environment manifests reject unrecognized asset need types; the scenario-bank asset helper now carries that bounded type. Focused shared-schemas and scenario-fixtures test/typecheck passed.

Worker 11 repeated asset-need deduplication slice is complete. Scenario asset readiness now deduplicates repeated required asset IDs before readiness and aggregate Quest-budget evaluation, preventing duplicate scenario config entries from double-counting blockers or budgets. Focused asset-registry test/typecheck passed.

Worker 12 scenario-review decision replay-order slice is complete. Mongo scenario-review decisions now replay deterministically by reviewed time, scenario ID, version, reviewer role, and reviewer ID, matching API startup reconstruction ordering for tied timestamps. Focused data-mongodb test/typecheck passed.

Worker 12 scenario-review decision validation slice is complete. Mongo scenario-review decision persistence now rejects blank scenario/reviewer identities, blank reviewed timestamps, and missing or blank evidence refs before upsert. Focused data-mongodb test/typecheck passed.

Mongo API persistence-sink integration verification after repository validation hardening passed. Focused `@openclinxr/data-mongodb` API persistence integration test remained green.

Mongo API persistence-sink integration verification after station-scope guards passed. Focused `@openclinxr/data-mongodb` API persistence integration test remained green.

Worker 9 XR required-trace deduplication slice is complete. XR trace-readiness summaries now deduplicate repeated required trace tags before counting observed and missing behavior, keeping headset readiness aligned with domain trace evaluation. Focused ui-xr runtime-state test/typecheck passed.

Worker 8 review-replay unsafe fallback slice is complete. The admin Review Replay query now requests `unsafeEvents`, and the UI merges review-packet unsafe events with raw trace-derived safety labels so faculty still see safety flags when raw trace events are unavailable. Focused graphql and ui-admin test/typecheck passed.

Exam-assembly duplicate blueprint trace requirement slice is complete. Exam form assembly now deduplicates blueprint required trace and safety-critical trace tags before coverage and issue reporting, preventing repeated blueprint config from duplicating missing-coverage blockers. Focused exam-assembly test/typecheck passed.

Exam-assembly duplicate break-checkpoint slice is complete. Timing plans now deduplicate repeated `breakAfterStationOrders` before deriving break checkpoints, preserving deterministic station timing without duplicate break rows. Focused exam-assembly test/typecheck passed.

Worker 2 station-run note identity slice is complete. Shared `validateStationRun` now rejects station runs whose embedded patient note references a different `stationRunId`, aligning schema validation with review-workflow note consistency. Focused shared-schemas test/typecheck passed.

Worker 2 review-packet identity slice is complete. Shared review-packet validation now rejects mismatched patient-note station IDs and blank faculty reviewer IDs, aligning the schema contract with review-workflow construction guards. Focused shared-schemas and review-workflow test/typecheck passed.

Worker 2 review-packet trace-quality consistency slice is complete. Shared review-packet validation now checks trace-quality counters against timeline length, unsafe-event count, missing-required count, and patient-note presence. Focused shared-schemas, review-workflow, and test-harness test/typecheck passed.

Worker 2 review-packet provider-counter consistency slice is complete. Shared review-packet validation now checks model-generated, model-failed, and voice-audio trace-quality counters against timeline event types. Focused shared-schemas, review-workflow, and test-harness test/typecheck passed.

Worker 2 review-packet model-provenance consistency slice is complete. Shared review-packet validation now rejects `hasModelProvenance: true` when there are no model-generated timeline events. Focused shared-schemas, review-workflow, and test-harness test/typecheck passed.

Worker 2 plus Worker 5 review-packet replay-sequence schema slice is complete. Shared review-packet validation now rejects duplicate timeline sequence values, locking deterministic replay keys even for packets supplied outside `buildReviewPacket`; downstream review-workflow remains green. Focused `@openclinxr/shared-schemas` and `@openclinxr/review-workflow` test/typecheck passed.

Worker 2 patient-note nonblank semantic slice is complete. Shared patient-note validation now rejects blank station run IDs and blank note text, and those semantics propagate through station-run and review-packet validation. Focused shared-schemas, domain, and review-workflow test/typecheck passed.

Worker 2 trace-event identity slice is complete. Shared trace-event validation now rejects whitespace-only station run IDs, event types, sources, actor IDs, and tags, closing the gap left by structural `minLength` checks. Focused shared-schemas test/typecheck passed.

Worker 2 scenario trace-governance tag slice is complete. Shared scenario validation now rejects blank required trace tags and blank safety-critical trace tags before set membership checks. Focused shared-schemas and scenario-fixtures test/typecheck passed.

Worker 3 station-run identity guard slice is complete. Domain station-run creation now rejects blank scenario or learner IDs before constructing run IDs, keeping generated station runs valid against the shared schema. Focused domain test/typecheck passed.

Worker 7 session learner-id guard slice is complete. The API `POST /sessions` route now returns `learner_id_required` for blank learner IDs instead of surfacing a runtime exception, while preserving the default learner ID when the field is omitted. Focused api test/typecheck passed.

Worker 7 station-command error mapping slice is complete. API station lifecycle routes now map invalid domain transition commands to a controlled `station_command_invalid` 400 response instead of a generic runtime error. Focused api test/typecheck passed.

REST station-route identity guard slice is complete. `buildSessionRoutePath` now rejects whitespace-only station run IDs before encoding scoped URLs, matching the stricter station-run identity posture in domain and API layers. Focused rest test/typecheck passed.

Capability-gateway job-id guard slice is complete. Asset-generation submission now rejects blank generated job IDs before persisting queued/running lifecycle records, preventing malformed sandbox artifact paths and store keys. Focused capability-gateway test/typecheck passed.

Worker 10 model request-id fallback slice is complete. Mock model provenance now falls back to the deterministic station/actor/turn request ID when a caller supplies a blank request ID, preserving auditable nonblank provider records. Focused model-gateway test/typecheck passed.

Worker 10 voice request-id fallback slice is complete. Mock voice provenance now falls back to deterministic transcription/synthesis request IDs when a caller supplies a blank request ID, preserving auditable nonblank voice records. Focused voice-gateway test/typecheck passed.

Worker 10 local provider-health immutability slice is complete. Local model and voice adapter health checks now return fresh blocker arrays so caller-side mutation cannot alter future optional-runtime health posture. Focused model-gateway and voice-gateway test/typecheck passed.

Worker 2 provider-audit nonblank identity slice is complete. Shared provider audit validators now reject whitespace-only required identity/policy fields, and the named model/voice audit validators reuse that semantic guard. Focused shared-schemas test/typecheck passed.

Worker 2 provider-health nonblank identity slice is complete. Shared provider-health validation now rejects whitespace-only provider IDs in addition to contradictory ready-with-blockers records. Focused shared-schemas test/typecheck passed.

Worker 4 learner scenario view immutability slice is complete. Learner-facing scenario views now deep-clone the redacted public payload so UI/API consumers cannot mutate fixture actor communication profiles or other nested source state. Focused scenario-fixtures test/typecheck passed.

Downstream test-harness smoke after provider provenance/runtime changes passed. Focused `@openclinxr/test-harness` test/typecheck remained green.

First-sprint mock benchmark smoke after validation hardening passed. `@openclinxr/test-harness bench:mock` emitted a deterministic ED chest-pain station run with 20 events, zero missing required trace tags, ready mock providers, and local model/voice optional-runtime skips.

REST route matcher normalization slice is complete. `matchOpenClinXrRestRoute` now ignores query strings and hash fragments before segment matching. Focused `@openclinxr/rest` test/typecheck passed.

Architecture-rules verification after cross-package contract changes passed. Focused `@openclinxr/architecture-rules` test/typecheck remained green.

Architecture-rules verification after shared-schema and Mongo validation changes passed. Focused `@openclinxr/architecture-rules` test/typecheck remained green.

API downstream verification after REST and runtime contract changes passed. Focused `@openclinxr/api` test/typecheck remained green.

Historical 2026-05-21 validation-hardening note: package-local guard slices were useful for closing semantic gaps, but the active queue now prefers product-shaping work over additional routine hardening unless it directly supports a listed product lane.

Worker 9 Quest attached USB preflight is resolved for local CDP shell evidence. On 2026-05-21, `adb devices -l` initially detected the attached Quest over USB as `unauthorized`; after Patrick approved USB debugging in-headset, the device reported `Quest_3 device`, Quest Browser exposed CDP on `127.0.0.1:9222`, and the local XR server on port `5173` was reachable.

Worker 9 local Quest evidence validation checkpoint passed in the expected blocked posture. `pnpm xr:quest:smoke:validate -- --output .agent-factory/quest-cdp-smoke-check.json` wrote `classification=blocked`, and `pnpm xr:quest:manual:check -- --input docs/openclinxr/quest-manual-performance-2026-05-04.json --output .agent-factory/quest-manual-performance-check-current.json` wrote `readyToClaimFramePacing=false`. These validate the evidence gate without changing Quest readiness.

IWSDK reminder: current live Quest/CDP work did not use IWSDK because it was testing physical-device USB authorization, Quest Browser foreground/CDP exposure, and manual readiness gates. For the next Worker 9 XR slice, explicitly consider whether the approved sidecar IWSDK lane can help with input/locomotion parity, spatial UI readability, emulation evidence, or agent-assisted debugging before continuing purely in `apps/ui-xr`.

Worker 9 foreground Quest CDP shell evidence is refreshed. The first authorized smoke wrote `docs/openclinxr/quest-cdp-smoke-foreground-2026-05-21.json` but stayed blocked because the dirty Quest Browser session failed to create a WebGL context and frame sampling timed out. After a clean Quest Browser restart, `docs/openclinxr/quest-cdp-smoke-foreground-clean-2026-05-21.json` validated to `classification=foreground_ready` with shell loaded, trace interaction advanced, page visible, frame stats/text panel/input/frame-quality evidence present, and no blockers in `.agent-factory/quest-cdp-smoke-foreground-clean-2026-05-21-check.json`. This remains flat/preview WebXR shell evidence only: `immersiveFramesObserved=0`, `isPresenting=false`, approximately `33.3` FPS, `p95FrameMs=41.7`, and no manual worn-headset frame-pacing, locomotion, or latency readiness claim.

IWSDK sidecar was considered for the Worker 9 shell-evidence slice. It was not used inside `apps/ui-xr` because the slice required physical Quest Browser evidence, but the approved sidecar planning package stayed healthy: `pnpm --filter @openclinxr/iwsdk-spike test` and `typecheck` passed. Continue using IWSDK for supporting sidecar/tooling evidence where it materially advances input, locomotion, spatial UI, or agent-debugging work without replacing physical Quest proof.

Worker 9 CDP Full VR activation evidence is refreshed. A clean Quest Browser restart followed by `pnpm xr:quest:smoke -- --url 'http://localhost:5173/?questSmoke=enter-vr-clean-20260521-autonomy' --enter-vr --frame-sample-count 60 --frame-timeout-ms 8000 --output docs/openclinxr/quest-cdp-smoke-enter-vr-clean-2026-05-21.json` produced `.agent-factory/quest-cdp-smoke-enter-vr-clean-2026-05-21-check.json` with `classification=foreground_ready` and `immersiveEntryOutcome=session_started`. This proves CDP could activate the local Full VR entry path in the authorized Quest Browser session, captured `immersiveFramesObserved=74` in the frame sample, installed two primitive hand meshes, and exposed diagnostic input/locomotion fields. It is not a worn-headset readiness pass: the generated manual draft still lacks operator fields, trace headset input, locomotion, controller/hand-select latency, comfort, battery, and the required long immersive-frame window.

Worker 9 CDP-assisted manual harvest diagnostic is refreshed. `pnpm xr:quest:manual:harvest -- --output docs/openclinxr/quest-cdp-manual-harvest-diagnostic-2026-05-21.json --manual-evidence-timeout-ms 30000` wrote `harvestReady=false`; validation wrote `.agent-factory/quest-cdp-manual-harvest-diagnostic-2026-05-21-check.json` with `readyToClaimFramePacing=false`. Positive signals: text panel metadata present, `textPanelCount=3`, frame stats fresh, `immersiveFramesObserved=7913`, `sampleWindowSize=180`, and immersive/sample-window thresholds met. Remaining blockers: no headset select trace latency (`traceSource=dom_click_trace_button` only), no locomotion delta, no gamepad sources, missing hand joints, missing operator identity/audit fields, DevTools screencast not confirmed disabled, extra browser windows not confirmed closed, duration under 10 minutes, comfort/heat/battery not recorded. This is useful diagnostic evidence only, not readiness evidence.

IWSDK sidecar evidence gate was rechecked after the Quest evidence slice. `pnpm iwsdk:evidence` failed closed as expected: the sidecar remains `phase_1_install_backed_sidecar` and ready for install-backed sidecar posture, but not ready for agent tooling or production runtime. Current blockers include Vite 8 peer mismatch for the Phase 2 devtools plugin, missing adapter sync/MCP smoke evidence, scene hierarchy and ECS runtime not queryable through the sidecar agent lane, app bundle/bundle-delta over budget, average FPS and p95 frame time below/over thresholds, and missing controller-select latency. Treat this as an honest gate result, not a regression in the production `apps/ui-xr` lane.

Worker 9 hand-select capture-summary slice is complete. Copied Quest evidence now surfaces XR hand-select status, dwell time, fired count, and blocker reason in `captureSummary`, and the live Quest Evidence trace row shows the same status so faculty/operators can distinguish idle/arming/fired/blocked hand tracking select without digging through raw input evidence. IWSDK was considered but not used because this was production runtime instrumentation with focused local verification, not sidecar scene/emulation evidence. Focused `@openclinxr/ui-xr` test/typecheck passed.

Worker 12/session-state durable clinical-event identity guard slice is complete. `@openclinxr/session-state` and `@openclinxr/data-mongodb` now reject durable clinical-event records with blank `clinicalEventId`, blank `stationRunId`, blank label, blank optional `actorId`/`traceTag`/`status`, unknown `eventKind`, or non-finite/negative `atSecond` before in-memory persistence, Mongo upsert, or review projection. Focused `@openclinxr/session-state` test/typecheck and `@openclinxr/data-mongodb` test/typecheck passed.

Worker 12 durable actor-turn/timeline Mongo identity guard slice is complete. `@openclinxr/data-mongodb` now rejects conversation-turn records with blank `turnId`, `stationRunId`, `actorId`, text, emotional state, routing reason, blank trace/provenance refs, unknown source kind, raw-audio persistence, or non-finite/negative `atSecond`; emotional-state timeline records now reject blank station/actor/source-turn/emotional-state fields and non-finite/negative `atSecond`. Focused data-mongodb test/typecheck passed.

Architecture-rules verification after Quest/IWSDK evidence updates and persistence hardening passed. Focused `@openclinxr/architecture-rules` test/typecheck remained green.

The Phase 2 persistence note now documents the 2026-05-21 durable-record semantic guards for clinical events, conversation turns, and emotional-state timelines.

Worker 4 plus Worker 2 pediatric dialogue-seed slice is complete. `peds_asthma_parent_anxiety_v1` now exports deterministic dialogue and hidden-fact guardrail seeds for patient work-of-breathing, parent trigger/medication history, nurse oxygen/escalation, and hidden-truth probing. Scenario-fixtures tests verify seed IDs, actor linkage, visible/hidden fact presence, trace-tag alignment, and guardrail expectation. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 plus Worker 2 psychiatric safety dialogue-seed slice is complete. `psych_suicidal_ideation_safety_v1` now exports deterministic dialogue and hidden-fact guardrail seeds for direct safety questioning, confidentiality boundary-setting, nurse safety observation/escalation, and hidden-truth probing. Tests verify actor linkage, trace-tag alignment, visible/hidden fact presence, and guardrail expectation. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 scenario dialogue-seed coverage index slice is complete. Scenario-bank maturity now reports which scenarios have deterministic dialogue seeds, which still lack them, and which have hidden-truth guardrail probes; current seed coverage is ED chest pain, pediatric asthma, and psychiatric safety. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 ward delirium dialogue-seed slice is complete. `ward_delirium_med_rec_v1` now exports deterministic dialogue and hidden-fact guardrail seeds for orientation/infection questioning, daughter collateral medication reconciliation, nurse fall-risk planning, and hidden-truth probing; scenario dialogue coverage now includes this fourth station. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 telehealth diabetes dialogue-seed slice is complete. `telehealth_diabetes_health_literacy_v1` now exports deterministic dialogue and hidden-fact guardrail seeds for medication reconciliation/access barriers, hypoglycemia teach-back, daughter-supported shared planning, and hidden-truth probing; scenario dialogue coverage now includes this fifth station. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 OB preeclampsia dialogue-seed slice is complete. `ob_headache_preeclampsia_triage_v1` now exports deterministic dialogue and hidden-fact guardrail seeds for pregnancy red flags, nurse BP/escalation, partner explanation, and hidden-truth probing; scenario dialogue coverage now includes this sixth station. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 4 stroke alert dialogue-seed slice is complete. `ed_stroke_alert_handoff_v1` now exports deterministic dialogue and hidden-fact guardrail seeds for last-known-well family history, focused neuro/medication/glucose assessment, consultant oral handoff, and hidden-truth probing; scenario dialogue coverage now includes this seventh station. Focused `@openclinxr/scenario-fixtures` test/typecheck passed.

Worker 11 asset-readiness diagnostic hardening slice is complete. `evaluateAssetManifest()` now reports missing provenance/license posture as readiness blockers instead of throwing when called with malformed planning input, while registry upsert still rejects structurally invalid manifests through the shared schema validator. Focused asset-registry test/typecheck passed.

Worker 11 asset production-limitation gate slice is complete. `evaluateAssetManifest()` now keeps non-placeholder local fixture assets production-blocked when Quest QA limitations explicitly say the evidence is local fixture, simulation-only, or not production clinical-realism approval; `patient_robert_hayes_character` fixture coverage verifies dev readiness without production promotion. Focused `@openclinxr/asset-registry` test/typecheck passed.

Worker 2 asset-manifest semantic schema slice is complete. Shared `validateAssetManifest()` now rejects whitespace-only asset identity, provenance source refs, Quest QA limitations, pipeline stage notes, tags, generation-evidence IDs, and optimization-evidence IDs/LOD tiers beyond structural `minLength` checks. Focused shared-schemas and downstream asset-registry test/typecheck passed.

Worker 11 asset generation-evidence source-ref guard slice is complete. Direct generation-evidence scoring no longer treats whitespace-only source refs as production source evidence if a caller bypasses schema validation. Focused asset-registry test/typecheck passed.

First-sprint mock benchmark smoke remained green after Quest evidence refreshes plus persistence/schema/asset hardening. `@openclinxr/test-harness bench:mock` emitted a deterministic ED chest-pain run with 20 events, zero missing required trace tags, ready mock providers, local model/voice optional-runtime skips, and passing adversarial hidden-fact probes.

Leadership benchmark rollup was refreshed after the evidence and hardening slices. `pnpm agent:benchmarks` wrote `.agent-factory/benchmark-gate-report.json`; gates `evidence-leadership-0008-002`, `0008-003`, and `0008-004` are true, while Quest/manual, stale local runtime/voice/model/asset evidence, IWSDK agent-tooling, and production asset readiness gates remain false with grouped blockers. This is an honest aggregate posture, not a stop condition.

Local runtime probe evidence was refreshed. `pnpm local:runtime:probe -- --output docs/openclinxr/local-runtime-probe-2026-05-21.json` reports Quest USB ready, Quest foreground preflight ready, and asset pipeline ready; API Bun runtime, local model, and local voice remain blocked because those benchmark lanes were not run in this slice.

Benchmark rollup was refreshed again after the local runtime probe; the same leadership gates remain resolved/blocked, but the local runtime evidence freshness blocker is reduced by `docs/openclinxr/local-runtime-probe-2026-05-21.json`.

Asset pipeline source smokes were refreshed. `docs/openclinxr/gltf-pipeline-smoke-2026-05-21.json` and `docs/openclinxr/blender-asset-bake-smoke-2026-05-21.json` were generated and validated with their focused `asset:gltf:smoke:validate` and `asset:blender:bake:validate` commands.

Asset production evidence ladder artifacts were refreshed and validated without making production-readiness claims: `docs/openclinxr/asset-capability-job-evidence-2026-05-21.json`, `docs/openclinxr/asset-production-readiness-benchmark-2026-05-21.json`, `docs/openclinxr/asset-production-evidence-ladder-2026-05-21.json`, and `docs/openclinxr/asset-production-artifact-evidence-2026-05-21.json`.

Benchmark rollup was refreshed after asset evidence updates; leadership gate pass/fail posture remains honest, with production asset readiness still false because refreshed evidence still records placeholder/fixture limits and missing reviewed production artifact lanes.

Local provider benchmark evidence was refreshed and validated without enabling local model/voice runtimes or cloud calls: `docs/openclinxr/local-provider-benchmark-2026-05-21.json`.

Local model cache/source evidence was refreshed without running inference or downloading models. `docs/openclinxr/local-model-cache-evidence-2026-05-21.json` and `docs/openclinxr/local-model-source-currentness-2026-05-21.json` were generated; cache validation passed, and source-currentness validation compared the latest metadata record against the fresh cache evidence.

Realignment decision: pause further routine evidence refreshes, including the previously implied local realtime voice cache/source refresh, unless they are tied to a concrete Worker 10/voice implementation slice. The next autonomous slice should be product-shaping rather than report-shaping.

Implementation outline:

- Use `operator-steering-needed-questions.md` as the source of truth for physical/hardware and approval blockers.
- Prefer local deterministic validation and committed evidence reports.
- For XR/Quest slices, consider the approved IWSDK sidecar first as supporting tooling/evidence, while keeping production runtime and Quest readiness claims gated on physical Quest evidence.
- Leave live Quest re-runs until instrumentation criteria in `operator-steering-needed-questions.md` are ready.
- Keep GitHub issues/project items as planning mirrors only; repo-local evidence and verified commits remain source of truth.
- If two consecutive slices were evidence-only, read `docs/agent-factory/operating-loop.md`, the latest iteration synthesis, and the relevant repo-defined agent memories before choosing the next slice.
- Use the Implementation Plan Gap Attacker posture to reject slices whose only output is another “still blocked” report.

Recommended next build slice:

- Worker 7 plus Worker 8 completed-station review path: inspect the existing API/admin review replay flow and add the smallest missing product behavior that helps faculty inspect a completed ED chest-pain station from durable/review-safe evidence. If that path is already complete, switch to Worker 9 trace interaction/locomotion instrumentation or Worker 4 scenario-bank expansion.

## Agent Strategy

Use multiple agents when tasks are independent and their write scopes do not overlap.

Before spawning or simulating agents, consult repo-defined roles:

- Chief Coordinator for task selection and drift prevention.
- Implementation Planning Lead for file ownership and sequencing.
- Implementation Plan Gap Attacker for “is this slice just toil?” critique.
- Solution Architect for cross-package boundary checks.
- XR Systems Architect for Quest/WebXR/IWSDK slices.
- Asset Pipeline Lead for asset realism/provenance slices.
- VP Engineering Delivery for stopping optional runtime work when deterministic station simulation or user-facing flow is not advancing.

Coordinator:

- Use the strongest available model for task selection, boundary enforcement, integration review, and final handoff.
- Keep context small by reading this file, the operator steering file, the relevant proposal, and only the files in the active task.

Explorers:

- Use fast/cheap models with low reasoning for read-only questions such as "what is already implemented?", "which tests cover this?", and "which files are in scope?".
- Scope each explorer to one subsystem: Quest evidence, durable persistence, architecture rules, or benchmark rollup.

Workers:

- Use fast coding models for narrow test-only or documentation-only changes with clear file ownership.
- Use stronger coding models for cross-package implementation, persistence semantics, or architecture-rule changes.
- Tell each worker the repo is shared, the approved boundaries are strict, and they must not revert unrelated edits.

Reviewers:

- Use a stronger model for spec compliance when a slice touches approved proposal boundaries.
- Use a fast model for mechanical code-quality review of narrow test/doc patches.

## Questions And Defaults

No blocking question is open for the next slice.

Nonblocking decision for later:

- Question: Should conflicting duplicate `clinicalEventId` saves produce a separate conflict/audit record?
- Recommended default: no. Keep current first-write-wins idempotency and require distinct event IDs for status/history transitions until Patrick approves a separate conflict-audit proposal.

Nonblocking Quest default:

- Question: Should copied UI payloads become the preferred documented manual Quest evidence path?
- Recommended default: yes. Keep raw template compatibility, but prefer copied in-app payloads because they preserve frame stats, capture summary, text panel metadata, harvest summary, and reproducibility metadata from the same runtime export.

## Resume Instructions For Future Agents

Start here:

```bash
pwd
rg -n "durableClinicalEvent|clinicalEventId|manualPerformanceDraft|captureSummary|quest-manual-performance" packages tools docs operator-*.md proposals/approved
```

Then read only the active slice files. Do not bulk-read the repo.

For durable persistence work, read:

- `proposals/approved/proposal-durable-clinical-event-persistence.md`
- `packages/openclinxr/session-state/src/index.ts`
- `packages/openclinxr/session-state/src/session-state.test.ts`
- `packages/openclinxr/data-mongodb/src/repositories.ts`
- `packages/openclinxr/data-mongodb/src/mongodb-repositories.test.ts`

For Quest manual evidence work, read:

- `proposals/approved/proposal-quest-foreground-performance-capture.md`
- `tools/openclinxr/check-quest-manual-performance.ts`
- `tools/openclinxr/quest-manual-performance-check.test.ts`
- `tools/agent-factory/build-benchmark-gate-report.ts`
- `tools/agent-factory/benchmark-gate-report.test.ts`

Stop and ask only if a task requires credentials, paid/cloud/API usage, destructive operations, production deployment, local trust/security changes, or a scope expansion beyond the approved proposals.



## Historical Slice Ledger Compacted On 2026-05-27

The detailed chronological slice ledger that previously followed this point was compacted during the OpenClaw documentation realignment. Source control preserves the full pre-compaction history in cleanup checkpoints including `c30995c`, `9285713`, and `3ee468e`.

Durable active guidance now lives in:

- `AGENTS.md`
- `PROJECT_COORDINATION_INDEX.md`
- `docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md`
- `docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md`
- `docs/openclinxr/doc-authority-registry-2026-05-27.md`
- `docs/openclinxr/generated-artifact-registry-2026-05-27.md`
- `docs/openclinxr/worker-backlog-and-validation-matrix.md`

Recent cleanup checkpoints:

- `c30995c chore: protect OpenClaw doc authority guardrails`
- `9285713 chore: remove stale temporary handoff docs`
- `3ee468e chore: prune scratchpad markdown docs`

Current cleanup direction:

- Keep protected-policy files intact and linked.
- Use the documentation authority registry before treating any Markdown outside canonical control surfaces as active instructions.
- Continue pruning or compacting historical/scratchpad Markdown only after preserving source-control checkpoints.
- Do not delete templates, current references, evidence records, or historical syntheses merely because they are old; classify first, then prune only clear clutter.
- After cleanup, return to blueprint-to-runtime product slices: encounter specification intake, conversation tooling, reusable generated assets, adaptive humanoid/clothing pipeline, review/replay/persistence, and evidence that verifies touched factory behavior.
