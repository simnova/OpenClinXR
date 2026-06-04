# Generated Artifact Registry

Date: 2026-05-27

This generated registry complements the Markdown authority registry. It classifies non-Markdown artifacts so cleanup agents can prune stale evidence and local cache files without touching protected OpenClaw control surfaces or product assets.

## Protected Rule

Do not delete protected policy, templates, provenance, source records, runtime assets, or current representative evidence through this registry.

## Counts

- ignore-local-cache: 7
- keep-compatibility-input: 24
- keep-current: 44
- keep-evidence: 43
- keep-template: 5

## Cleanup Actions

- `.openclinxr/encounter-publication/local_tenant/ed_chest_pain_priority_v2/ed_chest_pain_priority_encounter_v1/learner-runtime-bundle.v1.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `.openclinxr/encounter-publication/local_tenant/ed_chest_pain_priority_v2/ed_chest_pain_priority_encounter_v1/scene-manifest.v1.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `.openclinxr/encounter-publication/local_tenant/peds_asthma_parent_anxiety_v1/peds_asthma_parent_anxiety_encounter_v1/learner-runtime-bundle.v1.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `.openclinxr/encounter-publication/local_tenant/peds_asthma_parent_anxiety_v1/peds_asthma_parent_anxiety_encounter_v1/scene-manifest.v1.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `.openclinxr/openclaw/automation-lease.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `.openclinxr/test-publication/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/learner-runtime-bundle.v1.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `.openclinxr/test-publication/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/scene-manifest.v1.json` - ignore-local-cache; ignore; Local runtime/cache artifact; should not be committed or used as durable evidence.
- `docs/openclinxr/encounter-asset-generation-queue-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/external-ai-asset-provider-preflight-2026-05-25.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/garment-fit-quality-reom-shirts01-cc0-transform-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/garment-promotion-gate-ob-reom-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/garment-provider-gate-ob-reom-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/garment-work-order-ob-reom-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/garment-work-order-ob-reom-shirts01-cc0-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/garment-work-order-ob-reom-shirts01-cc0-derived-transform-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/humanoid-collision-probe-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/humanoid-collision-probe-active-viseme-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/humanoid-realism-gate-neutral-generated-human-animated-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/iwsdk-first-slice-preinstall-proposal.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/iwsdk-npm-metadata-snapshot-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/iwsdk-phase2-devtools-preinstall-proposal.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/materialize-clinical-idle-pose-clip-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/materialize-clinical-idle-pose-clip-rerun-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/materialize-clinical-idle-pose-clip-v2-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/materialize-clinical-idle-pose-clip-v3-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/materialize-clinical-idle-pose-lower-arms-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/mpfb-makehuman-garment-license-intake-2026-05-27.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/refine-humanoid-material-contrast-v2-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/refine-humanoid-material-contrast-v3-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `docs/openclinxr/strip-humanoid-primitive-proxies-2026-05-23.json` - keep-compatibility-input; review-before-change; Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output.
- `apps/ui-xr/public/xr-assets/environment/ed-exam-bay-shell.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/clinic_abdominal_pain_interpreter_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/clinic_abdominal_pain_interpreter_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v2/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v2/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ed_stroke_alert_handoff_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ed_stroke_alert_handoff_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ob_headache_preeclampsia_triage_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ob_headache_preeclampsia_triage_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/oncology_bad_news_family_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/oncology_bad_news_family_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/postop_fever_consult_pressure_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/postop_fever_consult_pressure_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/psych_suicidal_ideation_safety_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/psych_suicidal_ideation_safety_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/stepdown_sepsis_nurse_escalation_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/stepdown_sepsis_nurse_escalation_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/telehealth_diabetes_health_literacy_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/telehealth_diabetes_health_literacy_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ward_delirium_med_rec_v1/learner-runtime-bundle.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/generated/ward_delirium_med_rec_v1/scene-manifest.v1.json` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/charmorph-antonia-ob-patient-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/charmorph-reom-ob-patient-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/reom-local-authored-curved-clinical-top-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/reom-local-fitted-scrub-top-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/reom-namuhekam-polo-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/reom-namuhekam-polo-clearance-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/reom-shirts01-cc0-elvs-crude-tshirt-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/candidates/reom-toigo-basic-tucked-tshirt-candidate.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/adult-standard-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/bariatric-adult-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/ob-nurse-williams-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/ob-partner-omar-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/ob-patient-aisha-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/older-adult-kyphotic-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/humanoids/variants/pediatric-school-age-generated-human.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart-12-lead.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `apps/ui-xr/public/xr-assets/medical-equipment/iv-pole-with-pump.glb` - keep-current; keep; Runtime asset/provenance material; preserve for product and evidence continuity.
- `.agent-factory/benchmark-gate-report.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/evidence-debt-report.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/godot-project-import-check.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/maturity-report.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/memory-index.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/quest-cdp-smoke-check.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/quest-http3-compatibility-check.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/quest-http3-compatibility-template-check.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/quest-manual-performance-report.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/quest-mixed-reality-manual-report.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/quest-mixed-reality-manual-template-check.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `.agent-factory/risk-report.json` - keep-evidence; keep; Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it.
- `docs/openclinxr/doc-authority-registry-2026-05-27.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-asset-generation-queue-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-asset-generation-worker-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-guarded-runtime-selection-intent-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-local-factory-handoff-preflight-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-local-factory-operation-manifest-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-local-launch-selection-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-materialization-attachment-plan-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-materialization-evidence-attachment-inputs-peds-asthma-parent-anxiety-partial-2026-05-28.json` - keep-evidence; keep; Generated OpenClinXR evidence artifact; keep unless a later explicit stale pattern supersedes it.
- `docs/openclinxr/encounter-materialization-evidence-attachments-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-materialization-evidence-attachments-peds-asthma-parent-anxiety-partial-2026-05-28.json` - keep-evidence; keep; Generated OpenClinXR evidence artifact; keep unless a later explicit stale pattern supersedes it.
- `docs/openclinxr/encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-materialization-input-manifest-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-publication-payloads-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-runtime-evidence-capture-scaffold-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-runtime-realism-evidence-input-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/encounter-runtime-selection-review-packet-peds-asthma-parent-anxiety-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/evidence-index-2026-05-27.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/generated-artifact-registry-2026-05-27.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/generated-ed-station-runtime-bundle-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/godot-project-import-check-2026-06-04.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/humanoid-source-bplus-scorecard-2026-05-27.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/iwsdk-evidence-contract-2026-06-04.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/iwsdk-npm-currentness-2026-06-04.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/iwsdk-npm-metadata-snapshot-2026-06-04.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/local-model-source-currentness-2026-05-21.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/local-realtime-voice-model-source-currentness-2026-05-21.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/ob-humanoid-source-variants-2026-05-27.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/peds-humanoid-materialization-handoff-2026-06-04.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/ui-xr-peds-materialization-gate-browser-smoke-2026-05-28.json` - keep-evidence; keep; Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes.
- `docs/openclinxr/garment-source-allowlist-template-2026-05-27.json` - keep-template; keep; Template/license/provenance/source artifact; never prune as generated clutter.
- `docs/openclinxr/godot-quest-voice-evidence-template.json` - keep-template; keep; Template/license/provenance/source artifact; never prune as generated clutter.
- `docs/openclinxr/quest-http3-compatibility-template.json` - keep-template; keep; Template/license/provenance/source artifact; never prune as generated clutter.
- `docs/openclinxr/quest-manual-performance-template.json` - keep-template; keep; Template/license/provenance/source artifact; never prune as generated clutter.
- `docs/openclinxr/quest-mixed-reality-manual-template.json` - keep-template; keep; Template/license/provenance/source artifact; never prune as generated clutter.
