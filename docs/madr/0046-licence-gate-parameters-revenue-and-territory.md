# 0046 — Licence gate parameters: revenue band and operating territory

- Status: accepted
- Date: 2026-08-07
- Deciders: Patrick (operator)
- Supersedes: nothing. Amends the conditional readings in 0043, 0044, 0045.

## Context

Several asset-generation candidates carry licences whose terms are **conditional on facts about the
product, not about the code**. A 2026-08-07 licence-engineering consult established the mechanisms but
could not evaluate them, because nobody had stated where OpenClinXR sits. Its conclusions were
therefore written as "workable while X", and X was unknown.

The two unknowns that mattered:

- **Revenue band** — Stability AI's Community License grants free commercial use and then *terminates*
  above roughly USD 1,000,000 annual revenue, at which point an Enterprise licence is required.
- **Operating territory** — Tencent's Hunyuan3D-2 Community License defines Territory as worldwide
  **excluding the European Union, the United Kingdom and South Korea**, and its AUP §5.c bars
  distributing or displaying the Materials *or their Outputs* outside that Territory.

## Decision

The operator stated on 2026-08-07:

> "Won't be above 1m and runs in the USA only"

Recorded as the standing parameters for licence evaluation:

| parameter | value |
|---|---|
| annual revenue | **below USD 1,000,000** |
| operating territory | **United States only** |

## Consequences

**Stable Fast 3D moves from revenue-gated to workable**, subject to two conditions that are now
engineering obligations rather than open questions:

1. register at `stability.ai/community-license` before any commercial use of the model
2. treat crossing USD 1M as a **hard product gate** — the licence terminates automatically, so this
   needs a tripwire, not a reminder

**Hunyuan3D-2 moves from territory-blocked to workable in the United States.** Both gates clear:

- generation and Output display occur inside Territory
- the 1M-monthly-active-user threshold (measured at the 2025-01-21 release date) is not met
- the AUP clauses that caused my earlier over-broad reading — §14 *high-stakes automated decisions* in
  medicine/health, and §20 *unauthorized or unlicensed practice* — restrict **automated clinical
  decision-making and practising medicine**, not the generation of props for a training simulator.
  Generating a sharps bin makes no clinical decision. This was corrected once already; the operative
  verbs are the restriction, not the word "health".

**Expanding to the EU, UK or South Korea re-blocks any Hunyuan-derived asset**, including meshes
already generated, because §5.c covers Outputs. If that becomes a possibility, every asset with
Hunyuan provenance has to be identified and replaced — which is an argument for recording the
generator in the MADR 0016 manifest for anything produced this way, not merely the licence.

Nothing here changes the copyleft posture. GPL tools (MPFB2, StableGen, ComfyUI) remain out-of-repo
authoring tools whose outputs ship and whose code does not — see 0044.

## NOT DETERMINED

- **Distribution model.** SaaS, self-hosted, or a shipped application changes what counts as
  "distributing Materials" and therefore what notice obligations attach. It matters much less for an
  offline bake pipeline where only meshes ship, but it is unstated.
- Whether the revenue tripwire should live in code, in a checklist, or in a review gate.
- Whether TRELLIS's non-commercial render dependencies (`diffoctreerast` and the Inria
  gaussian-splatting family) can be excluded from a mesh-only install. That is a dependency question,
  not a revenue or territory one, and it is unaffected by this decision.

## Provenance

Operator statement, 2026-08-07, in response to a direct question about the three assumptions the
licence consult could not evaluate. Two of three answered; distribution model still open. The licence
mechanisms cited above were read from the LICENSE texts during the 2026-08-07 consult and are recorded
in more detail in that session's findings; **this record captures the product-side parameters, not a
legal opinion.** Counsel should still sign anything that ships.

## Amendment 2026-08-07 — deployment model answered

The operator answered the open question directly:

> "It's going to run on this workstation for testing and validation and ideally a single instance in
> the cloud in the future"

Recorded as the third standing parameter:

| parameter | value |
|---|---|
| annual revenue | below USD 1,000,000 |
| operating territory | United States only |
| **deployment model** | **self-hosted single instance** — this workstation now, one cloud instance later. Not SaaS multi-tenant, not a distributed application. |

### Consequences

**Copyleft distribution obligations largely do not trigger.** GPL-3 obligations attach to
*conveying* — distributing the work to a third party. A single self-hosted instance the operator runs
is not conveyance, so MPFB2, StableGen, and `comfy-3d-viewers` (GeometryPack) remain out-of-repo
authoring tools with no source-offer obligation, which is what MADR 0044 already assumed and this now
grounds in a stated fact rather than an assumption.

**The AGPL question stays live and is the one to watch.** AGPL-3's §13 network clause triggers on
*network interaction*, not conveyance — so a cloud instance that users reach over a network WOULD
trigger source obligations for any AGPL component. The repo's standing posture already avoids
AGPL/copyleft runtime dependencies; that avoidance is now load-bearing for the cloud step rather than
merely preferred. **Nothing AGPL may enter the runtime.**

**Stability AI's Community License** terms are unaffected — the revenue band governs, not the
deployment shape.

**Hunyuan3D-2's Territory clause** is unaffected for a US-hosted instance. If the cloud instance is
ever placed in, or served to, the EU/UK/South Korea, §5.c re-blocks Outputs — see the existing
consequences section. Deployment region is therefore a licence-relevant decision, not only an
operational one.

### Still NOT DETERMINED

- whether the future cloud instance is reachable by third parties (which would make the AGPL clause
  and any "public-facing service" terms operative) or is single-operator access only
- the MADR 0044 CC-BY allowlist for MakeHuman system assets — unchanged by this, and now blocking any
  product use of the hm08 candidate, which ships wearing MakeHuman clothing and hair (#156)
