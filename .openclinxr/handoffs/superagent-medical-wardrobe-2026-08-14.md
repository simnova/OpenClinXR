# Superagent brief — medical wardrobe on the MPFB rail

**From:** hourly-loop orchestrator. **Date:** 2026-08-14.
**Source research:** `.openclinxr/handoffs/medical-clothing-options-2026-08-14.md` (accurate — verified).
**Status:** ready to assign. Patrick's go still required.

## Verified before writing this

I re-checked the research handoff against the tree rather than trusting it. It is correct.
My own first check was wrong: I looked in `provider-cache/clothes/`; the real root is
`provider-cache/garments/sources/`.

| asset | staged | `.mhclo` header |
|---|---|---|
| `makehuman-community-scrub-shirt` | yes | `# license: CC-BY` |
| `makehuman-community-scrub-pants` | yes | `# license: CC-BY` |
| `makehuman-community-crude-labcoat-female` | yes | `# license CC0` |
| `makehuman-community-crude-labcoat-male` | yes | `# license CC0` |

## Why this suits a superagent

- **D1-clean.** Every garment is an existing `.mhclo` fitted through the proven `ClothesService`
  path. Nothing is hand-authored in Blender. The failure mode this repo keeps hitting — a worker
  writing bespoke geometry — is structurally absent.
- **Genuinely multi-slice.** Four actors, three garment layers, a licence obligation, and a
  per-actor graded still. Too big for one hourly tick; the right size for a campaign.
- **Each step is independently provable** with isolated `glb-grade` lit + structure. No slice has to
  wait on a full-room capture.
- **Duration is not a constraint (D9).** These are Blender bakes; a multi-hour run is fine.

## Scope

1. **Kevin** — replace `toigo_fisherman_sweater` + `cortu_cargo_pants` with scrub shirt + scrub pants.
   **Measure whether the midriff gap closes; do not assume it.** Kevin is the cleanest subject: he
   already has real hair (`a997ae27`) and no placeholder scalp.
2. **`mpfb-clinical-nurse-adult`** (#403) — same kit. This file also dresses physician, respiratory
   therapist and medical assistant.
3. **Physician distinguisher** — crude lab coat as a THIRD layer over scrubs. This is how the
   physician stops being "the nurse in the same teal" without a third body bake.
4. **`mpfb-family-partner-adult`** — stays in street clothes. Not a staff role.

## Constraints that are not negotiable

- **CC-BY is an obligation, not just permission.** Attribution `WojackOWL, Medical Scrubs Kit, CC-BY`
  must land in `docs/openclinxr/third-party-asset-licence-ledger.md` **and** be reachable from
  anything published. A CC-BY asset shipped without attribution is a licence breach, not a to-do.
- **Do not glob `makehuman-shirts01`** — one AGPL top is still in that zip.
- **Do not default-fit** surgical mask (hides visemes and breaks lip-sync), cap, or gloves.
- **Frozen hashes:** `mpfb-ob-patient-aisha.glb`, `mpfb-peds-patient-child.glb`,
  `mpfb-peds-parent-aisha.glb`. Do not point Tara off `mpfb-peds-parent-aisha.motion-bind.glb`.
- **Do not touch #167.** No clinical, Quest, or exam-readiness claims.

## Ownership split — read this or we collide

The superagent takes **`mpfb-peds-nurse-kevin.glb`, `mpfb-clinical-nurse-adult.glb`,
`mpfb-family-partner-adult.glb`** end to end. My hourly loop stays off those three files entirely.

**Fold in the open scalp defect rather than racing it.** I planted a RED at `25c5db89`
(`a-new-mpfb-bake-does-not-reintroduce-the-placeholder-scalp.test.ts`): the two #403 adults are the
only `mpfb-*.glb` still carrying `openclinxr_mesh_native_scalp_hair_surface` at rgb(9,7,6) — 2792 t
and 2724 t. Scalp-region black at head-dominant UVs is 41.5 % / 40.6 % against 10.2 % / 8.8 % on the
four clean actors. **Any wardrobe rebake of those two files should clear the shell in the same bake**,
and the fix must be a RULE (suppress the shell wherever a fitted hair mesh exists), not two more ids
appended to a list — the contract cannot tell those apart, so the commit message must say which.

## The ceiling Patrick should know before saying go

**There is no MPFB hospital gown.** The MakeHuman clothes index has none under CC0 or CC-BY, and
inventing one in Blender is banned by D1. So this effort improves **staff** appearance and leaves
**patients** in street clothes — and the patient is the figure a learner spends the encounter
examining. It is a real win and it is not the biggest one available. Finding or commissioning a gown
stays open.

## Done means

Per actor: garment fitted through `ClothesService`, isolated `glb-grade` lit **and** structure,
orchestrator grades the pixels, midriff measured rather than eyeballed, licence ledger updated, and a
CLAIM / NOT TESTED line. A green contract is not done.
