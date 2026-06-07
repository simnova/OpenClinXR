---
authority: agent-methodology
scope: orchestration + all asset/XR/product slices
ties: blueprint-factory-guardrails (Q1/Q5), drift-toil-prevention, subagent-protocol, chief-coordinator Persona
---

# Chunk Visibility / Noticeability Guard (Orchestration Coordinator Ruleset)

## Rule (non-negotiable for orchestration coordinator (chief-coordinator role))

Every delegated work chunk or slice MUST be a **sizable collaborative vertical slice** (see agentic-lexicon.md for full definition) big enough to be noticeable in either:

- the tester app (Model Vetting Studio cagematch evidence: front.png, three_quarter.png, body_motion_probe.webm + artifact-map.json, rigging_report vs packed model-vetting-report.v1 with .candidates), **or**
- the sample scene (UI-XR peds sample / selectedHumanoidSourceComparator "peds_anny_real_garment_patient" or equivalent, body_motion/adaptive capture, garmentGeometry surfaces in MouthGazePoseComparatorEvidence, traverse tags like openclinxr_real_garment_*, userData.openClinXrSleeveDeformEvidence, no-frustum-cull, cyan highlight or distinct material).

The slice must be a multi-role collaborative body of work (orchestration coordinator + 2+ role-mapped agents e.g. asset-pipeline-lead + xr-systems-architect + productivity-skeptic) targeting a concrete functional area (WebXR asset and scene factory, exam running / UI-XR runtime, model harness proving ground / tester app) and provable by interacting with and showcasing it in those areas (run the pipeline, load/exercise in the apps, produce skeptic-assessable evidence). The productivity-skeptic assesses the body for effective teamwork/collaboration and demonstrable forward movement, and qualifies website/marketing evidence only when the slice meets the standard.

If post-execution / post-capture evidence shows **no visible delta** (sub-pixel at ~3.4m viewer, same-color-as-body clothing region, frustum-culled, fixture-only tube with no weights, rigid parent, <3px radial offset, hidden by existing materials, no motion in deformsWithBreathing probe), the orchestration coordinator **MUST NOT** accept the chunk as complete.

**Required action:** Immediately expand scope and re-delegate/iterate:
- Geometry: increase sleeve_len (0.16→0.27+), r0 (0.28→0.35+), rows/cols (4x8→7x12+), add ripples (sin 0.004+), bulge, folds, seam hints.
- Material/visibility: vivid separate material (e.g. (0.08,0.52,0.95) vs body), SOLIDIFY thicker, WEIGHTED_NORMAL, distinct emissive for evidence, force visible=true, frustumCulled=false, userData openClinXr* + sleeveDeform.
- Pipeline: re-orchestrate_character with full peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1 (phenotype.garmentLayers=short_sleeve_exam_tshirt drives embed in apply_role_clothing_material_regions), ensure deformsWithBreathing, weightedBones (clavicle/upper_arm etc.).
- Capture: --capture-views front,three_quarter,body_motion_probe --duration-ms 10000+ --reportUrl with proper model-vetting-report.v1 .candidates; longer wait/settle in turntable-capture.
- UI-XR: expand main.ts traverse/record for the comparator (garment name regex, sleeve-specific evidence, camera framing for peds real garment, playback register for sleeveDeformCapture).
- Verification: require skeptic-visible 3D deforming sleeve volume + motion in BOTH tester visuals **and** UI-XR runtime evidence before closing.

## Ties to Other Guards
- Anti-toil: after 1 evidence-only slice (no visible product delta or collaborative body), next **must** be construction that produces noticeable change or force Chief Coordinator + drift-police review + product pivot. Isolated minor tasks are toil even if technically "visible".
- Blueprint Q1: case definition (garmentLayers etc.) → generated runtime with **visible** actor/clothing/locomotion/emotion surfaces via collaborative vertical slice in the functional areas.
- Q5: factory verification only counts when the touched generator/consumer produces skeptic-noticeable evidence in tester or sample **and** the productivity-skeptic can assess the multi-role body of work for teamwork/collaboration + forward movement sufficient for website evidence.
- "Do not weaken": this rule lives in orchestration Persona (chief-coordinator/charter + .grok/personas) + subagent-protocol + spawn prompt builder + agentic-lexicon.md; protected like the 6 files. It now explicitly incorporates sizable collaborative vertical slice requirements.

## Enforcement
- Orchestration coordinator (Composer main thread embodying chief-coordinator role) owns selection + scope expansion decisions per the mandate in agentic-lexicon.md.
- When spawning via `pnpm grok:agent:spawn-spec`, the baked Persona + "ORCHESTRATION COORDINATOR CHUNK VISIBILITY / NOTICEABILITY MANDATE" line in `buildRepoAgentSpawnPrompt` (grok-repo-agent-spawn.ts) carries the rule to all asset-pipeline-lead / xr-systems-architect / skeptic subs.
- In state updates (only the 3 MDs): every checkpoint must cite "Per visibility/noticeability rule..." when relevant and record whether visible delta was achieved or scope was expanded.
- On heartbeat / post-slice / run-next: if last chunk left no visible evidence, the dequeue must prioritize an expansion or a new visible-impact slice.

## Examples of Invisible (reject) vs Noticeable (accept)
- Reject: 48-face rigid cylinder, parented, no weights, same blue, sub-pixel at camera distance (garment-hint-v1 abort case).
- Accept: 324-face sleeved tshirt, separate mesh, weighted to clavicle.L/R + upper_arm, deformsWithBreathing, vivid contrast, ripples/folds, visible volume in front/three_quarter + body_motion webm; distinct sleeveDeform in UI-XR peds capture with cyan/userData evidence.

See also: agentic-lexicon.md (authoritative definition of visibility/noticeability mandate + orchestration coordinator), chief-coordinator charter.md (Persona), .grok/personas/chief-coordinator.toml, subagent-protocol.md, drift-toil-prevention.md, blueprint-factory-guardrails.md, grok-tier-routing.md (orchestration coordinator never spawns grok-build for routine; flash for scouts).

After any ruleset edit touching this file, run pnpm agent:alignment && pnpm docs:drift-check before next dequeue.
