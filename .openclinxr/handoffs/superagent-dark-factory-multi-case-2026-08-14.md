# Superagent brief — close the dark factory: N cases in, a runnable encounter out, no LLM in the production path

**Written 2026-08-14 by the orchestrator. Every number below was measured on this tree today, not
recalled.** Where I could not measure something I say so. If a premise here turns out to be false,
that finding is worth more than the work — say so immediately and stop.

---

## 1. The goal, in the operator's own words

> **D9, 2026-08-08:** *"Build a **dark software factory with minimal LLM involvement necessary**. The
> tooling we've discussed are more **deterministic components**… it's a **pipeline**, so each step is
> part of the factory. **Duration of execution is not the issue**, that can be refined; the ability to
> take **multiple cases** and run them through it and get a **full experience** at the end, **capable
> of allowing an examination to perform with no further LLM involvement**, is ideal. LLMs can only be
> used in the final product for narrow purposes (e.g. dynamic dialogue generation) where absolutely
> necessary."*

**The deliverable:** take **three scenarios that are not `ed_chest_pain_priority_v1`**, run them
through the pipeline end to end with **zero hand-authored per-asset code**, and produce a graded
capture of each. The success measure is **throughput of cases**, not greenness of contracts.

**Why three and not one:** one case can always be carried by hand. The factory only exists if the
second and third cost nothing extra. Pick cases that differ on axes the pipeline claims to handle —
suggest `peds_asthma_parent_anxiety_v1` (paediatric, 3 actors), `ob_headache_preeclampsia_triage_v1`
(adult female, supine), `psych_suicidal_ideation_safety_v1` (adult, seated, no equipment).

---

## 2. Why this cannot be done by the hourly loop

I run one contract-gated slice per hour, each with a planted RED, counterweights and a destructive
probe. That machinery is good at *"this specific thing is wrong, prove it fixed"* and structurally bad
at *"this station does not exist yet"*. The measured symptom, from a peer review of my own work on
2026-08-11:

> *"Your process is drifting into a measurement lab that protects the factory instead of extending it.
> Instruments should thin out as generators improve; yours are thickening."*
> *"**Avoidance pattern:** anything without a pre-written RED path and a known file:line. You optimize
> for dispatchable certainty, not factory capability."*

That is accurate and it is why this is being handed over rather than sliced. **You are expected to
build things that have no RED yet**, and to accept multi-hour bakes (D9: duration is not a constraint).

---

## 3. Measured state of every pipeline station, 2026-08-14

| station | today | deterministic? | evidence |
|---|---|---|---|
| case definition → scenario | authored TypeScript fixtures, 14 in bank | **yes** | `packages/openclinxr/scenario-fixtures` |
| body generation | MPFB macro solve from authored stature | **yes, on the MPFB rail** | stature deltas nurse 0.44 cm, parent 0.01 cm, child 0.18 cm (#329) |
| wardrobe | `.mhclo` fitted via `ClothesService` | **yes** | aisha/child/kevin all carry fitted t-shirt + cargo pants + footwear |
| **garment colour** | **one literal per role class** | **NO** | **all four patient/family garments are `(0.720,0.680,0.550)`; nurse both layers `(0.050,0.480,0.520)`** |
| hair | `.mhclo` fitted, licence-gated | **yes, where licence permits** | aisha 4,976 tris; kevin is a licence-blocked skip; child in flight (#399) |
| rigging | MPFB standard rig, 137 joints | **yes** | vs 23 on the Anny rail |
| **motion** | **hand-authored procedural clips** | **NO** | MPFB: `ClinicalIdleConversation` (411 ch), `ClinicalExpressionMicroTransition` (1 ch). Anny: 5 clips incl. `openclinxr_clinical_idle_breathing` |
| **lip-sync** | **none** | **NO** | 32 morph targets exist on MPFB actors; nothing drives them from audio |
| gaze / eyes | `rotateOnWorldAxis`, verified live | **yes** | 10.85 mm iris travel, lateral/vertical 5.59:1 (#395) |
| rooms | parametric shells, 14 environments | **yes** | Infinigen path exists but its declared aspect is unreachable (#342) |
| equipment | parametric builders | **yes** | — |
| staging / placement | descriptor + framing passes | **yes** | camera now derived, not literal (#398) |
| **dialogue at runtime** | seeded | **the ONE sanctioned LLM use** | — |

**Three stations are not deterministic: garment colour, motion, lip-sync.** Those are the effort.

---

## 4. The three workstreams

### A. Garment colour — the smallest and the most visible

**Measured:** `mpfb-ob-patient-aisha` and `mpfb-peds-patient-child` each wear a t-shirt and cargo
pants, and **all four garments carry the identical `baseColorFactor` `(0.720, 0.680, 0.550)`** — one
pale tan. It is skin-adjacent, so in the station capture the parent **reads as unclothed** while
actually being dressed. Nurse kevin is correct: both layers `(0.050, 0.480, 0.520)`, the locked
clinical teal.

So the role-keyed path works; there is **no variation within the patient/family class**, and none
between top and bottom. The lever is `garment_shell_color` / `_FABRIC_PALETTE_KIND_COLORS`
(`automate_blender.py:1723`).

**What "deterministic" means here:** the colour must be a function of the *case definition*
(phenotype / actor identity), not a literal and not a random. Two patients in one station must differ
because their authored data differs, reproducibly across bakes.

**Blocked on one decision — see §7.** Do not guess it.

### B. Motion — the largest, and the one with a licence trap

**Measured:** every clip on both rails is hand-authored. MPFB actors carry exactly two
(`ClinicalIdleConversation`, 411 channels over 137 joints; `ClinicalExpressionMicroTransition`, 1
channel). There is no retargeting step in the repo.

**The path is already chosen and the obvious alternative is already refuted.** MADR 0052 P5:

> *"**#70's premise is FALSE and is withdrawn here:** Mesh2Motion is a **browser web app** — no CLI,
> DOM-coupled, its retarget tool is manual drag-and-drop — so it cannot run headless and was never a
> viable motion path, only an unused one. Salvage: its ~150 clips are CC0 and export as GLB. The real
> path is **`retarget_bvh`** (Diffeomorphic, ex-MakeWalk), which is headless-capable
> (`setSilentMode(True)`) and ships bone maps that match MPFB rigs exactly."*

**`retarget_bvh` is GPL-2.0-or-later: BUILD-TIME TOOLING ONLY**, same posture as MPFB's AGPL. It must
never become a shipped dependency. Retargeted clip data is output, not linked code — but confirm that
reading before you rely on it, and record the reasoning in the licence ledger.

**Scope:** one deterministic retarget stage that takes a BVH/GLB clip + an MPFB-rigged actor and emits
a bound animation, then at least three distinct clinical motions applied across the three cases. Not
a motion library — a *stage*.

### C. Lip-sync — unblocked by D11, and I deferred it twice for a bad reason

I ranked this low twice on the grounds that the library body has no morph stack. **That was wrong**:
D11 says the morph stack is a *reason* to use MPFB, not an obstacle, and the measurement agrees —
**MPFB actors ship 32 morph targets, against 25 on the Anny rail.**

The path in the D9 table: **Rhubarb → viseme JSON → existing morphs**, offline, no NVIDIA, no cloud.

**Known trap, measured (#316):** on the **Anny** rail, `smile`, `frown`, `pain`, `anxious`,
`brow_raise`, `eye_blink_l/r`, `jaw_open` and 8 others are **whole-body morphs — they displace 100% of
every vertex**. When the peds child blinks, her feet move. The cause is ~30 lines of hand-authored
per-vertex arithmetic in `add_required_morph_targets` (`automate_blender.py:547`) whose only region
gate is one `if v.co.y > 1.55`. **Verify whether the MPFB rail's 32 targets have the same defect
before building on them** — I have not measured that, and it decides whether this workstream starts
with a fix or a wiring.

---

## 4b. MEASURED 2026-08-14 13:0x with your own new `factory:case` CLI — the rail split, which exit 0 hides

You added `factory:case` (`44987bc1`) and its invocable list is exactly the three cases this brief
proposed. I ran all three with `--dry-run`:

```
peds_asthma_parent_anxiety_v1        EXIT=0   missingGlbs: []
ob_headache_preeclampsia_triage_v1   EXIT=0   missingGlbs: []
psych_suicidal_ideation_safety_v1    EXIT=0   missingGlbs: []
```

**All nine cast GLBs exist. That is the good news and it is not the whole picture** — `exit 0` means
*present*, not *graduated* (§7k: a presence check is not a substance check). Resolving each asset to
its rail:

| case | patient | nurse | family | MPFB |
|---|---|---|---|---:|
| **peds asthma** | `mpfb-peds-patient-child` | `mpfb-peds-nurse-kevin` | `mpfb-peds-parent-aisha` | **3/3** |
| OB triage | `mpfb-ob-patient-aisha` | `ed_chest_pain_nurse_adult` | `ed_chest_pain_spouse_adult` | 1/3 |
| psych safety | `ed_chest_pain_adult_cast` | `ed_chest_pain_nurse_adult` | `ed_chest_pain_spouse_adult` | **0/3** |

**4 of 9 actors are MPFB; 5 are still on the Anny rail.** And the same two Anny assets are cast into
**both** OB and psych.

**Why this matters for the three-case deliverable.** The Anny-rail actors carry the defects I graded
this morning and they are **not independently fixable**:

- **80-triangle blob footwear** (vs 30,768 for kevin's real MakeClothes boots)
- **painted clothing bands** — a `1.04 x 0.13 x 0.24 m` brown slab at 57–64% of stature that reads as
  a plank across the chest (measured, recorded on #126)
- **23-joint rigs**, against 137 on MPFB, with `hand.L/R` and `foot.L/R` carrying zero dominant vertices

They cannot be fixed in place because **`ClothesService` refuses non-basemesh topology** — the Anny
mesh is not MakeHuman topology, so no `.mhclo` garment or shoe can be fitted to it. The only route is
migration to MPFB, which is what #341 is doing one actor at a time.

**So the honest state of "three cases end to end": one case is fully graduated, two are not.** If the
deliverable is a graded capture of all three, psych will show three legacy figures. Either migrate the
two shared Anny adults (`ed_chest_pain_nurse_adult`, `ed_chest_pain_spouse_adult`) — which fixes **5
of the 9 slots at once**, since they are reused — or pick three cases that are already MPFB, of which
there is currently one.

**NOT TESTED:** whether an MPFB adult male exists that could replace `ed_chest_pain_adult_cast` (kevin
is the only MPFB adult male and he is cast as a nurse); whether the `--hatch` / `--motion-bind` /
`--viseme` stations run (all default OFF and I did not enable them).

## 5. Traps that will cost you days if you do not know them

Each of these cost this project real time. They are not hypotheticals.

1. **`orchestrate_character` without the `anny` package silently emits ~0.8 MB stub GLBs** that pass
   every file check. #73 lost ~40 turns to it. Rebake through
   `materialize_mpfb_humanoid_candidate.py` on existing solved bodies instead.
2. **Do NOT set `OPENCLINXR_RUN_GARMENT_BAKES=1`, and do NOT run a broad `vitest run tools/…` sweep.**
   Either starts the #195 garment bake matrix or the #288 case chain. Both hijacked this machine today
   — one drove load to 67 and spawned Blender for 40 minutes.
3. **Killing a dev server by its Vite pid does nothing.** The orphan is the `pnpm … dev:portless`
   wrapper, re-parented to init; kill the wrapper or the process group (#397, measured today).
4. **Vite 8 splits its port with ANSI escapes** — `127.0.0.1:^[[1m5173^[[22m`. A
   `127\.0\.0\.1:[0-9]+` match returns nothing. `spawnPortlessDevServer` handles it; ad-hoc probes do
   not (#69, and it caught me again today).
5. **`apps/ui-xr/dist` is uncorrelated with `public/`** — 9 of 12 scene manifests differ on
   `roomProps`, 12 of 12 differ overall, and 3 scenarios exist only in source. A bank scan that does
   not exclude `dist` reads history as present state. **Measured today: the dev server serves
   `public/`, so no capture is affected** — this is a scanning trap only.
6. **`exists:` proofs on gitignored paths are refused at land.** A pre-flight now catches it at
   dispatch (#396), but check your own artifact paths are tracked.
7. **Do not glob the MakeHuman asset packs.** `hair01`: 10 of 25 styles are **AGPL3**, 4 unlicensed.
   `shirts01`: 1 of 10 is AGPL3 inside an archive named `_cc0`. Read each `.mhclo` header. The
   attribution-free usable hair set is the six `toigo_*` bobs.
8. **A pixel grade tells you THAT something looks wrong, never WHY.** Six of my premises have been
   withdrawn after measurement. Measure the mechanism before filing or fixing.

---

## 6. What "done" looks like

Not "contracts green". The acceptance evidence:

- **Three scenarios**, none of them `ed_chest_pain_priority_v1`, each producing a full actor cast with
  bodies solved from authored phenotype, fitted wardrobe with **case-derived** colour, retargeted
  motion, and driven visemes.
- **A graded capture of each**, at native resolution, that a skeptical viewer would accept — and the
  orchestrator (me) grades the pixels, not the producer.
- **A single command** that takes a scenario id and produces the whole set, with **no per-asset code
  path** and no LLM in the run. Multi-hour is fine.
- **A written statement of what is still LLM-authored**, if anything.

---

## 7. Decisions only the operator can make — do not guess these

1. **Garment colour policy.** What drives a patient's top vs bottom colour? This is product/clinical
   voice, not an implementer decision (§8d/§8y). There is an open question on **#388** and a peer
   decision file at `.openclinxr/handoffs/decision-388-colour-collision-2026-08-14.md`; I measured
   that the peer's proposed implementation **moves the collision to OB** rather than removing it, and
   I am holding dispatch pending an answer.
2. **Scenario approval.** `canStartLearnerExam` is **false**: 1 of 12 stations is `activation_ready`,
   11 are `draft_blocked` on `scenario_not_approved`, because **13 of 14 bank scenarios are
   `status: "draft"` with all four review gates `draft`**. That is **52 human review decisions**
   (13 × 4: clinical, psychometric, legal, simulation-QA). The promotion machinery exists and is wired
   (`apps/api/src/scenario-review-promotion.ts`); what is missing is the judgements, and #167 correctly
   bans agents from shortcutting them. **Recorded with three options and a default in
   `operator-steering-needed-questions.md`.**
   **This does not block workstreams A–C** — it blocks only the claim that a learner can *sit* the
   multi-station exam. Build the pipeline; the gate is separate.
3. **A masculine hairstyle.** Every licence-clean style in `hair01` is a feminine bob, so
   `mpfb-peds-nurse-kevin` is a recorded skip. Unblocking him is a procurement decision.

---

## 8. Non-goals — do not do these

- **Do not touch scenario approval state**, `isActivationEligible`, `STEP2CS_STATION_COUNT`, or
  `scoreUseLabel`. Banned by #167 and the ban is correct.
- **Do not delete `apps/ui-xr/dist`.** Something may depend on it; #152 records that assumptions here
  have bitten before.
- **Do not hand-author geometry or per-asset Python** to make one figure look right. That is the
  anti-pattern D1 exists to prevent — the next case needs a human to write it again.
- **Do not make claims about clinical validity, licensure, or exam equivalence.** `claimScope` /
  `notEvidenceFor` discipline applies to everything you produce.
- **No AGPL/GPL/copyleft in a shipped dependency.** Build-time only, recorded in the ledger.

---

## 9. Where the ground truth lives

| what | where |
|---|---|
| operating contract | `AGENTS.md`, `agents/rules/` |
| the plan this effort extends | `docs/madr/0052-mpfb-graduation-plan.md` |
| delegation lessons (long, but §§6–12 are hard-won) | `agents/rules/PROTO_VERIFY_DELEGATION.md` |
| licence ledger — **read before touching any pack** | `docs/openclinxr/third-party-asset-licence-ledger.md` |
| operator blockers | `operator-steering-needed-questions.md` |
| board | `gh issue list` — #338 and #341 are adjacent SUB-MANAGER items |

**One request.** When you find that something in this document is wrong — and on past form something
will be — correct it *where it is stated*, not in an appendix. A wrong premise at the top is what the
next reader acts on.
