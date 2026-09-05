# World Compile Graph — execution brief

**Status:** execution brief (not a MADR, not a product claim, not Quest/scoring/exam-equivalence evidence)
**Date:** 2026-08-27
**Audience:** architecture / factory / ui-admin implementers
**Authority:** current-reference; subordinate to `AGENTS.md`, the six protected blueprint-factory files, and `#167` exam-start freeze
**Q-gates this work would advance when implemented:** Q1 (case → generated world as addressable nodes), Q4 (review/override/lock that survives the next bake), Q5 (hash/lock/stale verified against bakers)

**Researchers (2026-08-27, read-only):**
- DeepSeek explore `01a0448d-e872-7391-a570-134b2a8ab209` — schema/baker inventory
- grok-4.6 plan `01a0448d-e873-7623-8890-44cde87ac6f2` — DAG invalidation / cache keys / lock algorithm
- grok-4.6 plan `01a0448d-e875-7681-9c6a-98f021af4b99` — additive evidence.v1 fields, faculty Table, `@xyflow/react`

This file synthesizes those reports against the tree. File:line citations are from that pass; re-measure before dispatch if HEAD has moved.

---

## North star (keep this sentence)

**The World Compile Graph is the versioned, reviewable, lockable compile of the Encounter Blueprint Factory — every actor and generated thing is an addressable node faculty can accept or override without rewriting the case definition.**

---

## BLUF

Do not mint a fourth factory ledger. The compile record already exists as `openclinxr.encounter-materialization-evidence.v1` (`tools/openclinxr/factory/encounter-materialization-evidence.ts:5-31`) plus the input and operation manifests. Product copy may say “World Compile Graph.” Stored `schemaVersion` stays `openclinxr.encounter-materialization-evidence.v1`. Additive optional fields: `caseDefVersion`, `compileVersion`, per-row `lock` / `stale` / `overridePatch` / `cacheKey` / `contentHash`, and top-level `compileEdges`.

Partial regen is the economic reason this exists. Faculty cards are the UX. A canvas is a view of the same JSON and ships last.

Today a faculty lock cannot survive a rebake: evidence rows have no lock fields; `encounter-asset-generation-queue.ts:1223` stamps `contentHash: "local-deterministic-encounter-definition-contract"` (never invalidates); `orchestrate_character.generate()` (`:632-657`) is mesh then Blender in one call; `materialize_mpfb_humanoid_candidate.py` fuses body + clothes + hair + visemes. A graph drawn over those monoliths is one node per actor: changing the appetizer still recooks dessert.

**Execution order:** emit nodes from current evidence (Phase 0) → additive validator + faculty Table on `EnvironmentGenerationQueuePanel` → real `contentHash` + Mongo collection → split body vs wardrobe so a lock can skip a baker → engineer `@xyflow/react` view. Do not start with a canvas. Do not grow `FacultyReviewDecisionPanel`. Do not touch `#167`.

---

## Locked product intent

OpenClinXR already has:

- Case definition: `CaseAuthoringWorkbench` emits `ScenarioSchema` only (`apps/ui-admin/src/CaseAuthoringWorkbench.tsx`).
- Encounter Blueprint Factory: `tools/openclinxr/factory/` (ledgers, queues, evidence) plus `tools/openclinxr/asset-pipeline/` (actual GLB bakers).
- Dark-factory station chain (observed, not a DAG): case params → body → clothing → rigging → room → equipment → placement → render (`tools/openclinxr/dark-factory/multi-case-runner.ts`).
- Faculty review: `FacultyReviewDecisionPanel` is station-run packet promote/hold (`FacultyReviewDecisionPanel.tsx:70`, `localDecision: "hold"`). `scene-generation-review-decision-export.v1` is per-asset `RuntimeAssetReviewDecision[]`.

The gap: generation is a factory *run*. Authors cannot see every spawned actor, garment, room, or cart as a first-class lockable object. Dislike a nurse, a gown, or a crash-cart placement, and there is no typed override that survives the next compile.

This is a bake / compile DAG (hashed cache + partial regen), not a live n8n automation and not a Comfy graph faculty must draw.

Three documents, three version lines:

| Artifact | Owns | Who writes | Version token |
|---|---|---|---|
| Case definition | Objectives, gates, phenotype *intent*, roles | Faculty / case author | `caseDefVersion` ← `Scenario.version` (`packages/openclinxr/shared-schemas/src/schemas.ts`) |
| World compile graph | Generated entities, seeds, overrides, locks, evidence edges | Factory proposes; human reviews | `compileVersion` (new int on the evidence doc; product alias `worldCompileVersion`) |
| Bake / runtime bundle | Hashed GLBs, placement, physics JSON | Factory bakers | per-node `contentHash` (`bakeVersion` is that digest, not a third document class) |

If the case def changes: locked compile nodes stay; unlocked descendants become `stale` and wait for regen; never silently wipe a faculty override.

---

## Hard constraints (do not dilute)

- Two documents, two version lines (case vs compile). Bake hashes hang off compile nodes.
- Review is node state, not a sidebar. Status ∈ `proposed | accepted | overridden | rejected | stale`. `locked: boolean`. Override is a JSON Patch against TypeBox (`ActorPhenotypeSchema`), never free-text “make her nicer” as SSOT.
- Faculty never draw wires. Engineer DAG is optional and later.
- D9: no LLM in the production path except dialogue. The graph is IaC for the ward.
- D11: MPFB is the learner humanoid rail; Anny is reference (`measure_reference`). Graph must not encode Anny as the learner body.
- Physics in ui-xr is baked JSON (`generated-physics-config-artifacts.ts`). Live Rapier is not a compile node (`runtimePromotionAllowed` / `liveEngineProductionAllowed` false, MADR 0030).
- ClothesService / MakeClothes is index-fit: body topology change dirties wardrobe, hair, footwear, visemes.
- Rooms 14/14 Infinigen already bake independently of humanoids (`rooms-bake-cli.ts`, `INFINIGEN_ENVIRONMENT_ASSETS`).
- `#167` exam-start promotion stays frozen. This work is factory lock, not packet promote.
- `runtimeExecutionAllowed: false` stays on `encounter-local-factory-operation-manifest.v1`.
- `claimBoundary` / `notEvidenceFor` on evidence.v1 are copied, never reinterpreted. No Quest / scoring / exam-equivalence / clinical-validity claims.
- Do not replace `CaseAuthoringWorkbench`. Do not start with a canvas. Do not invent `WorldCompileGraph.v1` as a stored schemaVersion.

---

## What already exists (do not fork)

`factory/` owns ledgers. `asset-pipeline/` owns bakers. `dark-factory/multi-case-runner.ts:14-27` is the only chain from baker to ledger today. `packages/openclinxr/asset-registry/src/runtime-bundles.ts` is a third surface (bundle / scene-manifest assembly).

### Compile / review schemas (DeepSeek inventory)

| schemaVersion | file:symbol | records | persist path |
|---|---|---|---|
| `encounter-materialization-input-manifest.v1` | `factory/encounter-materialization-input-manifest.ts:5` | per-actor/equipment work-order inputs, blockerIds | `docs/openclinxr/encounter-materialization-input-manifest-<date>.json` |
| `encounter-local-factory-operation-manifest.v1` | `factory/encounter-local-factory-operation-manifest.ts:31` | local deterministic factory plan; `runtimeExecutionAllowed:false` (`:48`) | `docs/openclinxr/encounter-local-factory-operation-manifest-<date>.json` |
| `encounter-materialization-evidence.v1` | `factory/encounter-materialization-evidence.ts:5` | per-actor/equipment required evidence refs + blockers; `attachable` | `docs/openclinxr/encounter-materialization-evidence-*.json` |
| `encounter-materialization-evidence-attachments.v1` | `factory/encounter-materialization-evidence-attachments.ts` | slot attach/hold | dated JSON under `docs/openclinxr/` |
| `encounter-runtime-selection-review-packet.v1` | `factory/encounter-runtime-selection-review-packet.ts:23` | guarded runtime handoff | dated JSON |
| `scene-generation-review-decision-export.v1` | `factory/scene-generation-review-decision-export.ts:7` | per-asset `RuntimeAssetReviewDecision[]` | `--output` |
| `encounter-asset-generation-queue-report.v1` | `factory/encounter-asset-generation-queue.ts:81` | factory planning queue | dated JSON |
| `generated-ed-station-runtime-bundle.v1` | `factory/generated-ed-station-runtime-bundle.ts:22` | actor/equipment materialization contracts nested | dated JSON |
| `dark-factory-station-table.v1` | `dark-factory/multi-case-runner.ts:12` | 9-station chain run status per case | `.openclinxr/evidence/issue-288/` |

Queue `requestedStages` (`character-generation` … `review-evidence-gate`, `encounter-asset-generation-queue.ts:1234-1245`) are planning labels, not bakers. Mapping the DAG onto them produces a one-node meal.

### Hash / cache / lock today (VERIFIED)

| Mechanism | Where | What it actually hashes |
|---|---|---|
| Literal stub | `encounter-asset-generation-queue.ts:1223` | `"local-deterministic-encounter-definition-contract"` — never invalidates |
| Size stamp | `generated-human-rigging-artifacts.ts:457` | `bytes:${glbBytes}:declared:${declaredLength}` — size, not input |
| Params only | `orchestrate_character.py:530` | `paramsHash` of resolver params |
| Input-shaped | `generated-physics-config-artifacts.ts:140` | `phenotypeHash` — the only input-shaped hash in factory/ |
| Pair cache | `body-param-cli.ts:694,740` | force-added gitignored body-param pair |
| Partial wardrobe | `rebake_role_wardrobe_blender_only.py:611` | wardrobe on tracked `.anny_base.obj` |
| Provenance sha256 | `kenney-promote-cli.ts:197,271` | asset bytes |
| **Lock / artifact lease** | factory/ and asset-pipeline/ | **NONE** (REFUSE gates + `claimBoundary` only) |

### CASE_ACTOR_PRESETS vs resolver

`CASE_ACTOR_PRESETS` (`orchestrate_character.py:214`) is a pinned known-good fallback, explicitly “NOT the source of the people.” `resolve_case_actor_params_with_source` (`:374`) order: (1) fixture export `packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json`, (2) preset, (3) `KeyError` / REFUSE #276. Graph CaseResolve nodes must record `source ∈ {case_definition, case_actor_preset}` and refuse a bake that has neither.

Note (2026-08-23 status, re-measure at dispatch): `multi-case-runner.ts` has historically imported `CASE_ACTOR_PRESETS` directly. A compile graph that keys CaseResolve on the preset table would recertify that hole.

### Why a fourth ledger collides (top 10)

1. Duplicate work-order ledger — input-manifest already owns per-entity work-order state + blockerIds.
2. Duplicate review ledger — three review surfaces already (`FacultyReviewDecisionPanel`, scene-generation export, runtime-selection packet).
3. Duplicate provenance — kenney / body-param / fleet-census sha256 already key assets.
4. `schemaVersion` SSOT — literals scattered across `factory/*.ts`; a new product schema adds a copy.
5. Persist-path collision — every ledger writes `docs/openclinxr/*-<date>.json`; a new glob breaks `--validate-latest`.
6. Status-vocabulary collision — five-plus enum families.
7. `claimBoundary` / `notEvidenceFor` collision — a wrapper that reinterprets them is a claim rewrite.
8. Blocker-ID collision — string-invented ids (`actor_materialization_evidence_missing:<actor>:<cue>`, evidence.ts:52).
9. Queue/worker duplication — asset-generation-queue + worker + Azure encode/decode already model lifecycle.
10. contentHash basis split — two incompatible schemes already (`:457` vs `:1223`); a third silent basis breaks both.

---

## Q1. Canonical JSON schema name

**Decision:** extend `openclinxr.encounter-materialization-evidence.v1` in place. Do not store `WorldCompileGraph.v1`. A TypeScript view type may be named `WorldCompileGraph` if it only *reads* evidence + input-manifest + operation-manifest + review-packet IDs.

Bump to `.v2` only if a field becomes required. Current validator (`encounter-materialization-evidence.ts:96-110`) checks known keys and does not reject extras; dated git JSON must keep parsing. Phase 1 must teach the validator *optional* lock/stale/edge fields so a malformed lock fails closed without requiring the field on old files.

Join keys already on the row: `actorId` | `equipmentId`, `variantSemanticKey`, `requiredEvidenceRefs`, `sourceBlobName`. Graph nodes **are** those rows, plus later room/physics rows once Phase 0 stops being unsplit-only.

### Minimal example (one actor + one prop + one evidence edge)

```json
{
  "schemaVersion": "openclinxr.encounter-materialization-evidence.v1",
  "source": "generated_station_runtime_bundle_materialization_contracts",
  "generatedAt": "2026-08-27T18:00:00.000Z",
  "scenarioId": "peds_asthma_parent_anxiety_v1",
  "caseDefVersion": 1,
  "compileVersion": 3,
  "status": "blocked_missing_actor_or_equipment_specific_evidence",
  "attachableToRuntimeSelection": false,
  "actorEvidence": [
    {
      "actorId": "nurse_kevin_lee_v1",
      "actorRole": "nurse",
      "variantSemanticKey": "peds_asthma_parent_anxiety_v1:nurse_kevin_lee_v1:nurse:mpfb_humanoid_variant",
      "sourceBlobName": ".openclinxr/asset-production/.../peds_nurse_kevin.glb",
      "requiredEvidenceRefs": [
        "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:nurse_kevin_lee_v1:nurse:mpfb_humanoid_variant/actor_specific_clothing_required"
      ],
      "blockers": [],
      "workOrderInputId": "actor-materialization-input:nurse_kevin_lee_v1",
      "nodeId": "actor:nurse_kevin_lee_v1",
      "family": "Wardrobe",
      "bakerId": "unsplit_character",
      "cacheKey": null,
      "contentHash": null,
      "seed": null,
      "status": "planned_unsplit",
      "lock": {
        "locked": true,
        "lockKind": "faculty_keep_artifact",
        "lockedAt": "2026-08-27T18:00:00.000Z",
        "reviewerId": "admin_simulation_qa_reviewer",
        "lockedCacheKey": null,
        "lockedContentHash": "sha256:…",
        "lockedAgainstCaseDefVersion": 1
      },
      "stale": false,
      "staleReasonIds": [],
      "overridePatch": {
        "schema": "openclinxr.ActorPhenotypeSchema",
        "op": "replace",
        "path": "/garmentLayers",
        "value": ["makeclothes_library_scrub_shirt"]
      }
    }
  ],
  "equipmentEvidence": [
    {
      "equipmentId": "pulse_oximeter_equipment",
      "variantSemanticKey": "peds_asthma_parent_anxiety_v1:pulse_oximeter_equipment:equipment_materialization_variant",
      "sourceBlobName": ".openclinxr/asset-production/.../pulse-oximeter.glb",
      "requiredEvidenceRefs": [
        "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:pulse_oximeter_equipment:equipment_materialization_variant/equipment_scale_validation_evidence"
      ],
      "blockers": [],
      "workOrderInputId": "equipment-materialization-input:pulse_oximeter_equipment",
      "nodeId": "equip:pulse_oximeter_equipment",
      "family": "EquipBank",
      "bakerId": "unsplit_equipment",
      "cacheKey": null,
      "contentHash": null,
      "lock": { "locked": false, "lockKind": "none" },
      "stale": true,
      "staleReasonIds": ["input_hash_changed"],
      "status": "stale"
    }
  ],
  "compileEdges": [
    {
      "from": "actor-materialization-input:nurse_kevin_lee_v1",
      "to": "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:nurse_kevin_lee_v1:nurse:mpfb_humanoid_variant/actor_specific_clothing_required",
      "kind": "requires_evidence"
    }
  ],
  "blockers": [],
  "recommendedNextActions": [],
  "claimBoundary": "materialization_evidence_attachment_contract_not_runtime_readiness",
  "notEvidenceFor": [
    "runtime_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "clinical_validity",
    "scoring_validity",
    "learner_launch_readiness"
  ]
}
```

Closed edge `kind` enum: `requires_evidence` | `body_to_clothing` | `body_to_hair` | `body_to_viseme` | `body_to_motion` | `room_independent` | `equip_independent`. No Comfy free-form edges.

`overridePatch.op` ∈ `replace` | `remove`. `path` must be a pointer into `ActorPhenotypeSchema` (`schemas.ts:155-183`) — `garmentLayers`, `clothing_style`, `wardrobeRole`, `fabricPalette`. Value must `ajv.compile(ActorPhenotypeSchema)`. Comments stay on `EncounterMaterializationInputReviewDecision.comments` (`apps/ui-admin/src/api-client-types.ts:376-387`) — review rationale, not factory input.

---

## Q2. Persist and join

**Git (COLD):** keep dated `docs/openclinxr/encounter-materialization-evidence-*.json` as export. `generatedAt` is not a version. Do not invent a new filename family.

**Mongo (HOT ops):** `scenarios` stays case-only (`packages/openclinxr/data-mongodb/src/scenario-repositories.ts:18,31-34`, unique `{scenarioId, version}`). New collection `encounter_materialization_evidence` unique on `{scenarioId, caseDefVersion, compileVersion}`. Node locks and patches live *inside* that document (one writer). Jobs stay on the existing generation-job collection. Do not write locks onto `Scenario`.

**Headset / ui-xr:** consume per-node `contentHash` (and the GLB path) only. Never the graph editor, never `compileEdges`.

Triple address: `(scenarioId, caseDefVersion, compileVersion)` plus per-node `contentHash`.

MADR 0055 posture applies: file-first SSOT for CI/worktrees; Mongo is a projection.

---

## Q3. Locks vs current generators

Lock is metadata. It is **not** inside `spec`, so it does not enter `cacheKey`.

```
compile(case):
  G = emitNodes(evidence)                 # Phase 0: actorEvidence ∪ equipmentEvidence only
  for n in topo(G):
    spec' = apply(n.spec, n.overridePatch) if n.overridePatch else n.spec
    key   = cacheKey(n.bakerId, n.bakerVersion, spec', parents.outputHash[], n.seed)
    if n.status == rejected: continue
    if n.lock.locked and n.contentHash:
      n.stale = (key != n.lock.lockedCacheKey) or upstream_stale(n)
      n.status = n.stale ? stale : accepted
      continue                            # NEVER rebake a locked node
    if key == n.cacheKey and artifactExists:
      n.status = n.overridePatch ? overridden : accepted
      continue
    bake(n)
    n.cacheKey = key
    n.contentHash = sha256(bytes)
    n.status = n.overridePatch ? overridden : accepted
  # unlocked descendants of stale parents bake; locked dishes stay
```

`cacheKey` formula (INFERRED; physics `phenotypeHash` is the existing shape to copy):

```
cacheKey = sha256(canonicalJson({
  bakerId, bakerVersion,
  spec,                     # CaseResolve slice this baker reads, after overridePatch
  parentOutputHashes,       # artifact hashes, NEVER parent cacheKeys
  seed                      # from resolve_case_actor_params / pipeline_seed
}))
contentHash = sha256(artifact bytes)
```

Do not hash `cacheKey`s (tautology). Do not put `locked` / `overridePatch` inside `spec`.

Generator interactions:

- Phenotype-from-case-def: CaseResolve must call `resolve_case_actor_params_with_source`, not `CASE_ACTOR_PRESETS.get`. A locked actor whose `lockedAgainstCaseDefVersion` is behind a dialogue-only case bump stays; a body-macro bump dirties BodyMpfb unless locked.
- Physics grep-guards: physics nodes hash phenotype, not hand-authored adapter constants (`generated-physics-config-artifacts.ts:132-140`). A faculty override that writes a numeric rest pose into an adapter is a contract fail, not a patch.
- Comfy: `generate()` refuses `--use-comfy` (`orchestrate_character.py:611-612`). Not a node.
- Silent lock wipe: rebuilding evidence without copying `lock` / `overridePatch` / `contentHash` is the first failure mode. The emitter must load the previous compile doc and copy those three fields by `nodeId` before computing stale.

Locked + not stale ⇒ skip rebake. Locked + stale ⇒ faculty must relock or unlock; do not silently keep a mismatch *and* do not silently rebake.

---

## Q4. Stale / partial regen vs the station chain

Dark-factory stations are a linear narrative. The DAG is the bakers.

### Node families (real bakers)

| Family | Baker (entry) | Output | Independent of |
|---|---|---|---|
| **CaseResolve** | `resolve_case_actor_params` `orchestrate_character.py:411` | phenotype + seed; refuse if missing (`:397`) | — |
| **BodyAnnyRef** | `generate_mesh.py` via `generate()` `:632-638` | `.anny_base.obj` + manifest | rooms, equipment |
| **BodyMpfb** | `HumanService.create_human` `materialize_mpfb_humanoid_candidate.py`; macros `body_param_stage.py` | hm08 body (learner rail, D11) | rooms, equipment |
| **Wardrobe** | `ClothesService.fit_clothes_to_human` `fit_stage.py`; role map `garment-selection-by-role.ts:21-35` | fitted `.mhclo` | rooms, equipment |
| **Hair / Footwear** | `embed_library_hair.py`; `embed_library_footwear.py` | topology-indexed overlays | rooms |
| **VisemeTargets** | `install_visemes02_targets` in MPFB materializer | face shape keys | rooms, equipment |
| **MotionBind** | `motion-bind-cli.ts` → `motion_bind_stage.py` | clip on existing GLB | rooms |
| **BlenderDress** | `automate_blender.py` from `generate()` `:640-657` or `rebake_role_wardrobe_blender_only.py` | actor GLB | rooms |
| **RoomExtract** | `infinigen-single-room-extract.py` | 1 of 14 `INFINIGEN_ENVIRONMENT_ASSETS` | all humanoid families |
| **RoomAlbedo/AO** | `rooms-bake-cli.ts` | textures; geo invariant | humanoids |
| **EquipBank / Hatch / Param** | `lane-policy.ts` (bank / modular_kit / thin_parametric); hatch in `factory-case-cli.ts` | GLB or builder | humanoids (placement is Assemble) |
| **PhysicsJson** | `generatePhysicsConfigFromPhenotype` `generated-physics-config-artifacts.ts:132-140` | `physics-config.v1.json` | rooms |
| **Assemble** | `generated-ed-station-runtime-bundle.ts:21-55` | bundle + actor/equipment contracts | — |
| **Dialogue** | runtime LLM only (D9). Not a bake. | — | mesh |

Not nodes: case authoring UI, live exam state, `FacultyReviewDecisionPanel`, Comfy.

### Dirty rules (conservative; unknown edge = dirty)

| Change | Dirties |
|---|---|
| `CaseResolve.phenotype.body*` | BodyMpfb (learner) and BodyAnnyRef (reference) |
| `body.topologyHash` | Wardrobe, Hair, Footwear, VisemeTargets, MotionBind (ClothesService is index-fit; hair reconstructs `base.obj` because GLB reimport breaks indices, `embed_library_hair.py:16-23`) |
| `garmentLayers` only, topology unchanged | Wardrobe / BlenderDress |
| BodyMpfb | PhysicsJson (`phenotypeHash`) |
| RoomExtract | RoomAlbedo/AO (geo must not move) |
| any baked GLB + placements | Assemble |

**Independent (⟂):** RoomExtract ⟂ Body*; EquipBank ⟂ Body*; PhysicsJson ⟂ Room*; Dialogue policy ⟂ mesh. Fourteen rooms already enumerate without humanoids.

**Can rebake alone today:** RoomExtract / RoomAlbedo per `environmentId`; EquipBank vs hatch; PhysicsJson; MotionBind on an existing GLB; `rebake_role_wardrobe_blender_only.py` on tracked `.anny_base.obj`; `fit_stage.py` given a frozen hm08 body.

**Cannot until split:** `generate()` mesh then Blender (`orchestrate_character.py:632-657`); `materialize_mpfb_humanoid_candidate.main` create_human + clothes + hair + visemes + export; `body_param_stage.py` macros → bake body → fit → armature in one script. Partial regen *inside one human* requires splitting **body vs wardrobe** before any canvas. `factory:case` inventories; it does not lock.

Meal mapping: case def = menu; CaseResolve = mise en place; each baker family = a course; `cacheKey` = recipe hash; `contentHash` = plated dish; lock = “do not recook this course”; stale = recipe changed under a locked plate.

---

## Q5. Faculty vs engineer UX (Ant Design 6)

**Grow `EnvironmentGenerationQueuePanel`** (`apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx:29-59`). It already prints materialization input/evidence summaries on `/exam-forms`. Add an antd `Table` (or `Card` grid) of `actorEvidence ∪ equipmentEvidence`:

| Column | Source |
|---|---|
| `actorId` or `equipmentId` | existing row |
| `variantSemanticKey` | existing row |
| `family` / `bakerId` | additive |
| `lock` | additive Tag |
| `stale` | additive Tag |
| `contentHash` short | additive |
| `status` | additive |

Actions: **Lock / Unlock / Apply override**. Override Form binds to phenotype enums (`Select` of `garmentLayers`), not a textarea.

Do **not** grow:

- `FacultyReviewDecisionPanel` — debrief packet; `#167` freeze (`faculty-review-gate.test.ts`, `isActivationEligible`).
- `ScenarioReviewGatePanel` — clinical / psychometric / legal / simulationQa.
- `CaseAuthoringWorkbench` / `/authoring` — case def only.
- No new `adminWorkbenchRoutes` entry (`packages/openclinxr/ui-route-admin`).

Optional later: same table as a collapsible on `ScenarioDetailWorkbench` actor/equipment lists (`App.tsx`) — still not a route.

Faculty must not see wires. Default view is the *accepted* world. Failed candidates live in history, not the published graph.

---

## Q6. React Flow vs FlowGram

**Pick `@xyflow/react` (React Flow) for engineer canvas v1.** Skip FlowGram.ai. Skip LiteGraph / ComfyUI / n8n / AntV X6.

| | React Flow | FlowGram.ai |
|---|---|---|
| Fits ui-admin | React 19 + Vite + antd 6. Zero xyflow import in `apps/ui-admin` today. `@xyflow/react` 12.10.2 already named MIT in `sources/npm-stack-metadata-2026-05-03.json` and in `docs/openclinxr/technology-approach-brief.md` + MADR 0020 as the *planned* scenario-graph editor. Add as `xyflow-vendor` next to `react-vendor` / `antd-vendor` (`apps/ui-admin/vite.config.ts`) | Second UI kit; Form/theme fight with antd 6 |
| CSP / Quest | Admin Vite app, **not** Quest. No CSP headers in this Vite config today; xyflow is ESM, no `eval`. Lazy-split so the antd bundle does not grow | Same split cost plus another design system |
| Escape hatch | Canvas is a **view** of `compileEdges` + evidence rows. Product is the JSON. Drop the library and the Table still works | Same hatch, higher kit lock-in |

Who owns the dependency: ui-admin (Lane B). Not ui-xr. Not Quest. License: MIT (already in the 2026-05-03 stack metadata).

v1 canvas is engineer-only, behind the same `/exam-forms` panel (`Collapse`), read-mostly; writes go through the Table APIs.

---

## Q7. Evidence ports

Existing fields that become node `evidence` ports (do not invent parallel ids):

| Port | Existing field |
|---|---|
| required evidence | `actorEvidence[].requiredEvidenceRefs` / `equipmentEvidence[].requiredEvidenceRefs` (`evidence.ts:12-26`) |
| blockers | `blockers[]` on the row and the report |
| work order | `workOrderInputId` (join to input-manifest) |
| attach/hold | `encounter-materialization-evidence-attachments.v1` |
| asset review | `scene-generation-review-decision-export.v1` → `RuntimeAssetReviewDecision[]` (`approved_for_local_runtime` \| `changes_requested`) |
| station-run review | `encounter-runtime-selection-review-packet.v1` — **not** a compile-node port; that packet is `#167` territory |
| claim fence | `claimBoundary` + `notEvidenceFor` copied onto every compile export |

If an objective has no observable entity or gate, compile fails (`status` stays `blocked_missing_actor_or_equipment_specific_evidence`, `attachableToRuntimeSelection: false`). Pretty graphs are not validity.

---

## Q8. MADR outline (do not merge unless asked)

Suggested next id: **0058** (tree currently ends at `0057-model-selection-is-a-predicate-not-a-ladder.md`). Title sketch: *World Compile Graph is an additive projection on encounter-materialization-evidence, not a fourth ledger.*

**Context.** Faculty cannot lock a generated nurse, gown, or cart across rebakes. Factory already emits input-manifest, operation-manifest, evidence.v1, review packets, and a scene-generation decision export. `contentHash` on the queue is a literal stub. Humanoid bakers are monoliths.

**Options.**

- A. New `WorldCompileGraph.v1` schema + new admin route + FlowGram canvas first.
- B. Extend `encounter-materialization-evidence.v1` with lock/stale/hash/edges; faculty Table on `EnvironmentGenerationQueuePanel`; `@xyflow/react` as a later view; split body vs wardrobe so lock can skip a baker.
- C. Do nothing; keep full-encounter rebake.

**Decision (this brief, not yet a MADR):** B.

**Consequences.**

- Stored schemaVersion does not change; product copy may say World Compile Graph.
- `#167` and `FacultyReviewDecisionPanel` stay packet promote/hold.
- `CaseAuthoringWorkbench` stays case-only.
- Mongo collection `encounter_materialization_evidence` keyed `{scenarioId, caseDefVersion, compileVersion}`.
- ui-xr / Quest consume `contentHash` only.
- Phase 0 emits unsplit actor/equipment nodes and does **not** invent room/garment/physics nodes until those bakers are first-class.
- Relates to: MADR 0020 (antd + planned xyflow), 0030 (physics JSON not live Rapier), 0044 / 0051 / 0052 (MPFB rail), 0048 (placement), 0053 (Infinigen rooms), 0054 / 0055 (equipment lanes + file-first catalog).

---

## Q9. Phase plan (does not start with a canvas)

Each phase is a dispatchable slice with a tree-inspectable `done_when`. Do not implement from this brief until a board card carries those proofs.

### Phase 0 — emit node list from current evidence.v1 (no canvas, no baker split)

- Emitter walks `actorEvidence[]` and `equipmentEvidence[]` only (`evidence.ts:12-26`).
- Per row: `{ nodeId, family: ActorVariant|EquipVariant, bakerId: "unsplit_character"|"unsplit_equipment", spec: {scenarioId, actorId|equipmentId, variantSemanticKey, sourceBlobName}, parents: [], cacheKey: null, contentHash: null, lock: false, status: "planned_unsplit" }`.
- Rooms / garments / physics are **absent** — do not invent them.
- Write beside the existing evidence JSON (same schemaVersion). Copy prior `lock` / `overridePatch` / `contentHash` by `nodeId` when a previous compile doc exists.
- `done_when` sketch: `exists:` emitter output; validator still accepts pre-Phase-0 dated JSON; fixture with two actors emits two nodes; a third invented room node fails the test.

### Phase 1 — additive fields + validator

- Optional `caseDefVersion`, `compileVersion`, `compileEdges`, per-row `lock` / `stale` / `overridePatch` / `cacheKey` / `contentHash` / `status`.
- Validator: old JSON without those keys still `ok: true`; malformed `lock.locked` type fails; `overridePatch.path` outside `ActorPhenotypeSchema` fails.
- Kill the queue stub as a *follow-on in this phase or Phase 3*: `contentHash: "local-deterministic-encounter-definition-contract"` (`:1223`) must not remain the bake identity of any node that claims to be hashed.
- `done_when`: planted contract with a 2026-05-28-shaped evidence JSON still validates; a lock object with `locked: "yes"` does not.

### Phase 2 — faculty Table on `EnvironmentGenerationQueuePanel`

- antd `Table` of actor ∪ equipment rows; Lock / Unlock / Apply override (enum `Select`, not textarea).
- REST: persist lock/patch onto the evidence document (Mongo when Phase 3 lands; git JSON until then).
- No new route. No `FacultyReviewDecisionPanel` edits. No `#167` files.
- `done_when`: component test that a locked row survives a re-render; override form refuses a free-text path; `FacultyReviewDecisionPanel.test.tsx` byte-identical except unrelated.

### Phase 3 — Mongo collection + real contentHash

- Collection `encounter_materialization_evidence` unique `{scenarioId, caseDefVersion, compileVersion}`.
- `contentHash = sha256(bytes)` of the artifact at `sourceBlobName` when the file exists; `null` when missing (do not fall back to the literal stub).
- ui-xr still reads GLB paths / existing bundle hashes — no graph import.
- `done_when`: two compiles of the same caseDef increment `compileVersion`; lock copied; unique index probe.

### Phase 4 — baker split so lock skips a rebake (this is when partial regen becomes real)

- Split `generate()` at OBJ vs Blender (`orchestrate_character.py:632-657`) **or** (preferred on the D11 rail) split `materialize_mpfb_humanoid_candidate` into BodyMpfb vs Wardrobe cacheKeys.
- Typed edges `body_to_clothing`. Topology change dirties wardrobe.
- Prove: lock Wardrobe, change nothing on body, recompile → wardrobe baker not invoked; change body macros → wardrobe stale (if unlocked) or stale+locked (if locked).
- Rooms stay ⟂ humans (already true).
- `done_when`: control/treatment table with columns `body topologyHash | wardrobe cacheKey | baker invoked | lock honored`. Known failed treatment: mapping DAG onto `requestedStages` (one node per actor).

### Phase 5 — engineer `@xyflow/react` view

- Lazy vendor chunk. Read-mostly canvas of `compileEdges`. Writes still go through Table APIs.
- Faculty never see this as the default.
- `done_when`: dropping the xyflow import leaves Table + JSON green; canvas does not write `Scenario`.

### Phase 6 (later, not v1) — author-added extra nodes

- Extra confederate / distractor as a typed add against `ActorPhenotypeSchema` + a new `actorEvidence` row.
- Out of scope until Phase 4 lock actually skips a baker.

Suggested original order vs this amendment: the pasteboard listed JSON → faculty lock → engineer view → partial regen → extra nodes. Code disagrees on step 4 vs 5: **partial regen is economically empty until bakers split**, and the canvas is a view, so split (Phase 4) precedes canvas (Phase 5). Faculty lock (Phase 2) can ship on unsplit nodes as *sticky metadata* before it can skip a bake.

---

## Q10. Explicit non-goals

- Live Quest / headset editing of the graph.
- Scoring validity, exam equivalence, clinical validity, licensure, Quest readiness.
- Replacing `CaseAuthoringWorkbench` or writing case medicine in the graph.
- Faculty drawing Comfy-style spaghetti.
- New stored schema `WorldCompileGraph.v1`.
- Growing `FacultyReviewDecisionPanel` or thawing `#167`.
- Live Rapier as a compile node.
- Anny as the learner body (D11).
- LLM in the production path except dialogue (D9).
- Starting with a canvas.
- Inventing room/garment/physics nodes in Phase 0.
- `pnpm docs:authority` regeneration (hand-add registry rows only).
- Author-added extra nodes in v1.

---

## Failure modes (treat as planted negatives)

1. **Silent lock wipe** — rebuild evidence without copying `lock` / `overridePatch` / `contentHash`.
2. **Vacuous graph** — one node per actor bound to `orchestrate_character` / `requestedStages`. Appetizer change recooks dessert.
3. **Hash-of-hashes tautology** — `cacheKey = hash(contentHash)` or hashing locks into spec. Green forever or dirty forever.
4. **Literal / size hashes** — `:1223` and `bytes:` never mean “recipe changed.”
5. **Seed without CaseResolve** — repeats `#601`; preset table as SSOT.
6. **Faculty Comfy** — graph is IaC JSON; headset eats locked bake.
7. **Live Rapier node** — physics is baked JSON.
8. **Anny as learner body** — `humanoid-source-decision-tree.ts` still prefers Anny for phenotype sliders; D11 learner rail is MPFB.
9. **Clothes not dirtied on body change** — index-fit; topology change without wardrobe dirty = nude / poke-through.
10. **`changed:FacultyReviewDecisionPanel` in a brief** — defeats the `#167` freeze the way a `changed:` rule defeats an instrument-artifact stop.

---

## Execution approach (how to staff this)

| Phase | Lane | Owner roles | Isolation | Model posture |
|---|---|---|---|---|
| 0 emitter | B (factory ledger) | asset-pipeline-lead (read bakers) + implementation on `tools/openclinxr/factory/encounter-materialization-evidence.ts` | worktree | cheap for tests; grok-4.6 if the copy-prior-lock join is ambiguous |
| 1 validator | B | factory package tests | worktree | cheap |
| 2 faculty Table | B admin | ui-admin only; disjoint from `#167` files | worktree | grok-4.6 for Ant Design 6 Table/Form |
| 3 Mongo + hash | B | data-mongodb + factory | worktree | cheap |
| 4 baker split | A / C seam | asset-pipeline-lead on MPFB materializer **or** `orchestrate_character.generate`; productivity-skeptic on “did lock skip a bake” | worktree; **do not collide with a live `#576`-class hold on `materialize_mpfb_humanoid_candidate.py`** | grok-4.6; Blender wall-clock is bake-dominated (turns undercount) |
| 5 xyflow | B admin | ui-admin `vite.config.ts` vendor chunk | worktree | cheap once JSON is SSOT |

Do not dispatch Phase 4 into `materialize_mpfb_humanoid_candidate.py` while another worker holds that write root.

Board cards must carry tree proofs (`run:`, `changed:`, `exists:`). Narrative `handoff:` / `skeptic:` rules are not sufficient. A Phase 2 card must **not** include `changed:apps/ui-admin/src/FacultyReviewDecisionPanel.tsx`.

Control/treatment for Phase 4 (required in the brief, not an ordered guess):

| treatment | body topologyHash | wardrobe cacheKey | baker invoked | lock honored |
|---|---|---|---|---|
| baseline unsplit `generate()` | n/a | n/a | always both stages | no — vacuous |
| split, lock wardrobe, body unchanged | same | same | wardrobe skipped | yes |
| split, lock wardrobe, body macros change | different | stale | wardrobe skipped, node `stale` | yes (faculty must relock) |
| split, unlock wardrobe, body macros change | different | miss | wardrobe rebake | yes |

---

## Critical files

- `tools/openclinxr/factory/encounter-materialization-evidence.ts` — ledger to extend; Phase 0 emitter; keep `schemaVersion` v1
- `tools/openclinxr/factory/encounter-materialization-input-manifest.ts` — work-order join
- `tools/openclinxr/factory/encounter-local-factory-operation-manifest.ts` — `runtimeExecutionAllowed: false`
- `tools/openclinxr/factory/encounter-asset-generation-queue.ts:1223` — stub `contentHash` to kill
- `tools/openclinxr/asset-pipeline/anny/orchestrate_character.py:374,411,632-657` — CaseResolve + monolith split
- `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py` — D11 learner baker; body/wardrobe fused
- `tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py` — real Wardrobe baker; topology dirty rule
- `tools/openclinxr/asset-pipeline/environment/rooms-bake-cli.ts` — proven independent room family
- `tools/openclinxr/factory/generated-physics-config-artifacts.ts:132-140` — only input-shaped hash to copy
- `packages/openclinxr/shared-schemas/src/schemas.ts` — `ActorPhenotypeSchema` override target; `Scenario.version` = `caseDefVersion`
- `packages/openclinxr/data-mongodb/src/scenario-repositories.ts` — unique `{scenarioId, version}` join pattern to clone
- `apps/ui-admin/src/EnvironmentGenerationQueuePanel.tsx` — faculty lock Table
- `apps/ui-admin/src/FacultyReviewDecisionPanel.tsx` — do not grow
- `apps/ui-admin/src/CaseAuthoringWorkbench.tsx` — do not grow
- `apps/ui-admin/vite.config.ts` — later `xyflow-vendor` chunk

---

## Claim fence

This brief is coordination + factory-architecture guidance. It is not evidence of runtime readiness, Quest readiness, production asset readiness, clinical validity, scoring validity, or learner-launch readiness. Implementing it does not thaw `#167`. Pixel grades of any baker split remain the orchestrator’s, native resolution, DeepSeek never Reads PNGs for those grades.
