# Claude review — initial scene planner scope extension

Completed 9 September 2026 after the extension was written. Reviewer: **claude-opus-5**, through Claude Code 2.1.266. Conversation: `713504a0-e625-4d00-bfa1-c038315b8739`. Result: **accept with exact corrections**.

Scope was limited to deciding initial room contents, initial states and placement inputs. The existing motion/research scope was retained. Repository reads succeeded against working-tree commit `9c6d56f0a95f46537759aa443ab27c858170ec4a`; unrelated active changes were left alone. Native LSP and web tools were permitted but not used. Actual tool counts: {"Bash": 12, "Read": 1, "Grep": 2}. The reviewer's narrative count below differs from these event receipts.

The initial invocation failed authentication because an inherited API key took precedence over the local Claude login; it produced no review. The successful invocation omitted that environment override for this process only and used the existing login. No saved auth configuration was changed. The CLI additionally reported auxiliary Haiku usage; the review model was Opus 5.

## Disposition

- Accepted: expose the descriptive-equipment-string versus asset-ID binding gap and require a reviewed mapping/precedence.
- Accepted with narrower wording: runtime placement is keyed by `equipmentId`. Do not imply a separate instance facility exists. Multiple copies require distinct realized identities and consumer proof; the record types alone do not establish that duplicate kinds are categorically impossible or require a particular new field.
- Accepted: separate planned initial conditions from scheduled events, including time-zero events. The planner does not pre-apply them or invent a new clock.
- Corrected rather than copied: Claude proposed direct encounter entry “before the first START_ENCOUNTER transition.” The domain rejects START_ENCOUNTER outside doorway. The brief instead records the actual runtime entry phase/time and forbids a second transition. Root also verified that current `startSession` invokes default `createStationRun` without the domain helper's optional doorway setting; direct entry is not claimed as wired there.
- Retained: compiled view of reviewed case intent; required/optional/intentionally absent/unavailable distinctions; present versus ready; actual state-consumer acknowledgement; no pre-completion of learner tasks; one-room prototype; no new physiology, dynamic task planner, general room synthesis or procurement system.

Root independently checked the cited source and applied these scoped corrections after Claude's reply. No second Claude pass, implementation, runtime capture, inference or clinical/license validation is claimed.

## Exact review prompt

Review the requested scope extension AFTER it has been written. User asked: extend the OpenClinXR brief to include figuring out the initial room state, what needs to be in it, and where it is placed; extend scope to JUST that, then review with Claude. You are the independent Claude reviewer. Read the full revised brief at docs/openclinxr/scene-layout-consultation-records-2026-09-09/../humanoid-scene-layout-research-brief-2026-09-09.md. The added subsection is 'Initial scene planner: requirements before placement'; pipeline/prototype/deliverables were also updated.

Repository /Volumes/files/src/openclinxr is available for full read-only inspection, with LSP and internet permitted. No product code edits, artifact edits, installations, model inference, task dequeue, board operations, autonomy loops or delegation. Existing working changes are unrelated and must remain untouched. Root edits the deliverable. If native LSP is unavailable, the existing real TypeScript LSP helper is callable via python3 /Users/patrick/Documents/Codex/2026-09-08/referenced-chatgpt-conversation-this-is-an/work/codex-consultation/lsp-query.py RELATIVE_FILE documentSymbol (also definition/references with one-based line/column). Do not confuse no results with absence.

Challenge constructively and with precise source evidence:
- Does the initial planner fill the requirements→contents→starting states→spatial placement gap while reusing ScenarioSchema/EnvironmentManifestSchema, environment descriptors, asset catalogue and actual session/runtime state owners?
- Is a compiled initial-scene specification scoped rather than a duplicate source of clinical truth? Are required/optional/intentionally absent/unavailable and present-vs-ready unambiguous, without pre-completing learner tasks?
- Is 'first interactive encounter state' a coherent boundary with existing doorway/session phases and scheduled events? Identify a concrete mismatch if there is one; don't invent a new simulator lifecycle.
- Does the scope stay restricted to initial setup? Are proposal and current implementation clearly distinguished? Is the prototype realistically bounded, with exact acceptance evidence rather than metadata claiming readiness?
- Flag any omission that makes the extension misleading, but avoid reopening every earlier motion/license research decision or adding general-purpose task planning, procurement or room generation.

Return accept / accept with exact corrections / reject, up to FOUR prioritized concrete findings, exact short replacement passages, and sources with file:line links. Also name what should remain. Keep under 1100 words and preferably <=12 targeted tool calls. Review only; do not edit files. Internet optional unless you introduce an external factual claim; use first-party sources. The earlier Grok/Codex reviews are not authority. Report actual repo/LSP/web use honestly.

## Claude reply

**Accept with exact corrections.** The four planner steps do fill the requirements→contents→starting-states→placement gap, and the three new citations resolve: `ScenarioSchema` at `packages/openclinxr/shared-schemas/src/schemas.ts:472` carries `clinicalObjectives`, `actors`, `eventSchedule` and optional `environment`/`equipment`/`assetNeeds`; `EnvironmentManifestSchema` at `schemas.ts:396`; session startup at `packages/openclinxr/scenario-runtime/src/scenario-runtime.ts:93` creates `run`, `multiActorSession` and `emotionEngines`. Four corrections below, ordered by cost if left.

## 1. The acceptance boundary does not name the existing phase it sits in

`StationPhase` is `"doorway" | "encounter" | "note" | "review"` (`packages/openclinxr/domain/src/station-state.ts:3`). `createStationRun` starts a run in `doorway` unless a scenario opts out (`station-state.ts:57`), and `transitionStation` throws `Cannot start encounter during ${run.phase}` for any non-doorway phase (`station-state.ts:62-64`). The learner is already in an assembled world during `doorway`, so "the learner's first interactive encounter state" (line 69) reads onto two different moments: scene assembled at doorway, or `phase === "encounter"` after `START_ENCOUNTER`. Replace the boundary sentence with:

> The acceptance boundary is the assembled scene as it stands when `createStationRun` yields `phase: "doorway"` and, for scenarios that opt out of the doorway, at `phase: "encounter"` before the first `START_ENCOUNTER` transition. It is the state the learner meets on entry; the existing station phase machine, not the planner, owns every later transition. [Station phases][R53]

Adding `[R53]: packages/openclinxr/domain/src/station-state.ts:3`.

## 2. "Exact instance IDs" names a facility the runtime does not have

Runtime equipment identity is a single `equipmentId` per kind, tagged into `userData.openClinXrEquipmentId` (`packages/openclinxr/xr-station/src/station-equipment.ts:135-158`) and keyed one-record-per-id in `equipmentPlacements: Record<string, EncounterRuntimeEquipmentPlacement>` (`packages/openclinxr/asset-registry/src/runtime-bundles.ts:187`, id field at `:86`). Two IV poles cannot be distinguished today. Step 2 currently implies reuse. Replace the binding clause with:

> Bind required equipment capabilities to existing catalogue assets by `equipmentId`. Runtime records are keyed one per `equipmentId`, so any case needing two of the same asset requires a proposed instance identity on both the placement record and the runtime tag; treat that as new work, not existing capability. [Equipment identity][R54], [placement records][R55]

## 3. The requirement carrier is free text, and the extension does not say so

`ScenarioSchema.equipment` is `Type.Optional(Type.Array(Type.String({ minLength: 1 })))` (`schemas.ts:490`), populated with prose: `["12-lead ECG machine", "bedside monitor", "stretcher", "IV pole", ...]` (`packages/openclinxr/scenario-fixtures/src/ed-chest-pain.ts:266`). The runtime side is id-shaped, with `equipmentDisplayLabel` converting id to label (`station-equipment.ts:236`). `assetNeeds` does carry `assetId` (`schemas.ts:389`, fixture at `ed-chest-pain.ts:293`), so the two case fields disagree about identity. This is the same unaligned-payload class the brief documents precisely for placement at line 33, and omitting it makes step 2 look like a lookup. Add after the first sentence of step 2:

> Case equipment is currently free-text strings while `assetNeeds` carries `assetId`, so the requirement-to-catalogue binding starts from an unaligned pair, mirroring the placement vector/scalar mismatch above. Resolve which case field is the authoritative requirement carrier before building the binding. [Case equipment field][R56], [fixture values][R34]

## 4. "Before scenario actions advance" is not a defined instant

`EventScheduleEntrySchema.atSecond` is `Type.Integer({ minimum: 0 })` (`schemas.ts:307-310`), so a scheduled event is permitted at second 0 and would coincide with the boundary. Once §1 pins the boundary to a phase, add one sentence to the same paragraph:

> Scheduled events remain owned by the runtime, including any entry at `atSecond: 0`; the planner specifies the state those events act on and never pre-applies them.

## What should remain unchanged

The four-way required-at-start / optional / intentionally absent / unavailable split and the present-versus-ready statement ("A monitor being present does not prove it is powered, connected or showing the correct case data", line 66) are the two things that stop this becoming a readiness-metadata layer, and step 3's restriction to states "only where a runtime consumer can represent it" is what makes them checkable. Keep the "compiled view of case intent, not a second source of clinical truth" framing (line 60), the return-the-conflict rule against silent dropping or room generation (line 65), the deferral to existing session-state owners with the verified `scenario-runtime.ts:93` anchor, the "if connecting equipment is a learner task, do not pre-complete it" clause (line 71), and the explicit exclusion of dynamic task planning, physiology, room synthesis and procurement. Prototype step 0 is realistically bounded: one existing room, one encounter, four named rejection cases, and it correctly refuses metadata-only success at line 69.

Scope stayed on initial setup. Proposed and implemented are labelled consistently in the new subsection ("Scope addition — proposed", line 60; "these are inputs, not proof of a complete requirements-to-starting-scene planner").

## Method

Repository read only, at the working tree on `main` (`9c6d56f0`), no edits. Eight tool calls: `schemas.ts`, `scenario-runtime.ts`, `station-state.ts`, `station-equipment.ts`, `station-equipment-support-surfaces.ts`, `runtime-bundles.ts`, `ed-chest-pain.ts`, plus two greps. Native LSP not used; ripgrep and line reads were sufficient and the helper script was not needed. No internet use, and no external factual claim introduced. Not checked: whether any consumer already reads `assetNeeds` for staging, and whether `EnvironmentManifestSchema` is produced anywhere in the factory chain.

## Artifact integrity

Final brief SHA-256: `cd7c1de2fe1753b87833e43defc809978498d2cfc26dbd73506c325dc53899e2`. Internal reasoning and raw tool outputs are omitted.
