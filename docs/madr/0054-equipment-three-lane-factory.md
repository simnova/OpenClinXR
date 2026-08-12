# 0054 — Equipment factory uses three lanes (bank / thin parametric / modular kit)

- Status: **accepted** (operator direction 2026-08-12 — bake split doctrine into factory motion)
- Date: 2026-08-12
- Deciders: Patrick (operator); chief-coordinator embodiment
- Relates to: MADR 0050 (optimize then judge; parametric kit fallback step 10), 0049 (licence posture), 0048 (scene composer placement), Approach B plan (ECG cart vertical)
- Issues / context: ECG midband kit + fitness parallel run; factory leverage for beds and multi-case bank

## Context

Equipment generation had collapsed into one mental model: *procedural kit + tune search for everything*.
That over-fits the ECG cart vertical (modular boxes + controls) and under-serves hospital beds,
stretchers, monitors, and the rest of the **14 scenario-bank blueprints** (68 prose equipment labels,
~37 runtime equipment ids).

Measured failure modes of the single-model approach:

1. **Self-referential fitness** scored tune knobs toward defaults, so “fair champions” barely moved
   while **quest-chunky** (readable controls) ranked last — pixels ≠ scalar (midband-parallel run).
2. **Beds already exist** as hand parametric builders (`buildHospitalBedEquipment`,
   `buildStretcherEquipment`) outside the kit; migrating them into cart-shaped recipes without a
   bank path is thrash.
3. **Dark factory (D9)** optimizes **multi-case throughput without LLM**, not “every mesh is a
   novel optimization problem.”

## Decision

**Route every equipment id through exactly one of three lanes:**

| Lane | Name | When | How we build | How we improve |
|------|------|------|--------------|----------------|
| **1** | **Bank + place** | Complex silhouette, little case-driven geometry variation, or already-good GLB | Authored / once-generated **GLB** under `xr-assets/medical-equipment/` + provenance + catalogue row | Multi-view pack grade; swap asset; post-opt (MADR 0050) |
| **2** | **Thin parametric** | Simple primitives, stands, trays, handhelds, family morphs (scale/color) | Small `build*Equipment` / family helpers; shared casters/poles | Structure gates + isolated harness render |
| **3** | **Modular kit** | Composable hard-surface families (carts, consoles, multi-volume decks) | Recipe + part library + assembler (`equipment-kit`) | Structure checklist; **mesh-measured** scores only; pack grade; no knob-self-score |

**Shared rails (all lanes):**

- Stable `equipmentId` → mount plan → scene graph tags (`openClinXrEquipmentId`, source).
- Semantic heights where staging needs them (`deckTopYMeters`, seat heights).
- Catalogue metadata (MADR 0055).
- Structure/assembly evidence where applicable.
- Licence ledger for any third-party source (0049).

**Non-decisions (explicit):**

- Kit is **not** the default for beds/stretchers until a deliberate lane-3 recipe exists *and*
  earns composition leverage over lane 1/2.
- Closed-loop tune search is **lane 3 only**, and only after scores measure **exported mesh**
  properties (not tune knobs).
- TRELLIS / Imagine packs are **offline bank fillers** (lane 1), not runtime generators.
- Unspecified-licence external meshes remain **refusals**.

## Consequences

### Positive

- ECG cart kit work stays valid as **lane 3 proof**, not as a template for every prop.
- Beds, monitors, clocks can improve via **bank** without fake kit abstraction.
- Multi-case factory loop can **inventory → classify → fill gaps → validate** without LLM.

### Negative / costs

- Two (or three) authoring paths must stay documented; catalogue is mandatory to avoid drift.
- Prose scenario labels (`"hospital bed"`) must map to ids (0055) or gaps stay invisible.

### Operational rule for agents

Before writing geometry or a fitness loop for equipment *X*, read the catalogue lane for *X*.
Do not invent a fourth lane. Do not re-litigate “kit everything.”

## Supersession

Does not supersede 0050; **refines** where parametric kit fallback applies (lane 3 and step-10
part replace). Complements 0049 for equipment-class third-party acquisition.
