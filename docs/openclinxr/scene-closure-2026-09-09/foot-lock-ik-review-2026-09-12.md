# Foot locking and bedside-turn follow-up: four-round Grok review

2026-09-12. Consultation only: no card created, no board mutation, no product implementation. Four completed exchanges with Grok 4.6 in one continued session. Grok had repository, configured TypeScript/Python LSP, native BothyBoard MCP with direnv authentication, and internet access; it used repository/LSP/board/web tools and independently ran the shipped approach measurement. Initial repo revision: `a02f3b1b`. Final native board inventory reported revision 4412.

## Recommendation

Add **one focused follow-up card**: **“SC-05 follow-up — physician turns, replants and stops without stance-foot drag.”** This is a quality improvement to an existing working encounter, rather than a new AI-motion umbrella. Confidence in the need is high; implementation confidence is medium to high with suitable stepping motion. Full browser A08 closure remains uncertain and must not be claimed by this card.

Use a real stepping/turn take or explicit alternating foot release and replanting first. Optional bounded leg IK can correct residual plant or transition errors. A large heading change cannot safely keep both feet fixed throughout the turn. Judge both feet across walk, turn, stop and whole run, with genuine swing and stance coverage.

## Current evidence

Grok independently ran `measureShippedApproach()` using the shipped physician rig and production approach consumers, with observation-file emission disabled. Node simulation at 60 Hz reproduced retained evidence:

| Interval | Foot-slide finding |
|---|---|
| Walk | Both toes: total and worst frame 0 m; satisfied |
| Terminal turn | Left total 0.17512 m; right total 0.21127 m; right worst frame 0.03615 m; violated |
| Stop | 0 m; satisfied |
| Whole run | Foot-slide violated because of the turn |

Arrival distance was 0.01474 m; heading error 0 degrees; stopped interval 7.183 s with no root travel. These demonstrate a useful baseline, not independent browser or clinical gait validation.

SC-05 is Landed but explicitly retains terminal-turn and browser A08 gaps. Retained browser capture is approximately 8 Hz, with maximum/median frame-gap ratio 2.82 against frozen limit 2. The SC-05 cadence instrument also derives approximately 132 Hz from source advance divided by the 0.005 m allowance. This is an instrument policy, **not a literal frozen SC-00 minimum frame rate**. Corrected-toe velocity must not be used to make cadence automatically pass. Node observations cannot substitute for actual rendered browser samples. Any cadence-policy revision needs a separately justified owner review; this follow-up should preserve honest `not_gradeable` results.

## Architecture and existing ownership

The existing stance lock translates the actor slot in XZ to preserve one toe anchor during walking. It is disabled when locomotion drive is zero, including settling. It is not a leg-joint IK solver. The approach executor owns planned path and heading; the stance-lock correction remains the single additional XZ correction authority.

Optional IK belongs after mixer evaluation and must modify the leg pose without adding a competing actor-slot/root translator. Chain ownership needs explicit ordered authority: a post-mixer modifier operates under the clip's existing leg claim, or becomes the owner when no clip owns those bones. A second owner ID does not authorize overlapping claims. Use exact rig bones; preserve leg lengths, reachable extension and valid joint poses. The compiler's existing `solveArmChain` is an arm contract and should not become the leg API.

Orange Duck's [foot-locking article](https://theorangeduck.com/page/inverse-kinematics-foot-locking) complements this architecture with leg IK and smooth per-foot lock transitions. Its [example repository](https://github.com/orangeduck/GenoView-InverseKinematics) has a first-party [MIT license](https://github.com/orangeduck/GenoView-InverseKinematics/blob/main/LICENSE). Motion datasets and imported assets require separate rights verification; that license does not clear them. This deterministic correction does not require pretrained weights.

For future generated clips, offline correction belongs after generation/retargeting and before baking, with reviewed or reconstructed uncorrected-source contact labels. It does not replace scene planning, navigation, collision or clinical positioning.

## Proposed card boundaries

**Objective:** Fix the real physician's final turn/stop through the ordinary case-owned UI-XR workflow while preserving walking, arrival, clearance, heading and stop behavior. Prove artifact-level foot quality and rerun actual browser correlation. Explicitly do not claim full browser A08 closure.

**Parent/dependency:** Scene-closure parent `tsk_a472e9e65c9bb214`; dependency on Landed SC-05 `tsk_4d39f0beaa5cdcc6`. Preserve that card and historical evidence. Do not attach this to the bake card or change SC-07–09 create-only dependencies.

**Acceptance:**
- Reproduce the current terminal-turn failure as behavioral RED; positive checks must cover both feet and walk/turn/stop/whole intervals under unchanged SC-00 limits.
- Preserve measured arrival ≤0.05 m, heading ≤10 degrees, stopped duration ≥2 s and root drift ≤0.005 m; retain swept collision, invalidation and replay behavior.
- Check applicable standing-foot floor contact/penetration, limb integrity and joint feasibility. Stretcher patient-support metrics do not become standing-foot metrics.
- Require actual swing/plant coverage and trustworthy source contact labels. Reject all-airborne labels, shortened stance windows, excluded turn frames, reduced yaw/path, frozen poses, synthetic zero traces or threshold changes.
- Rerun normal browser capture for production drive and arrival/heading/stop/floor correlation. Keep inadequate cadence and browser foot-slide `not_gradeable` explicit.
- Produce new follow-up evidence bound to the execution revision and producer-owned hashes of actual motion code/assets; preserve historical SC-05 evidence.

**Likely write scope, to finalize before creation:** bedside execution; case-owned/station motion integration; stance-lock seams if needed; clip playback/chain claims; optional internal leg module; normal encounter behavior test; shipped measurement consumer; new card-local proof/evidence. Add asset-generation/binding paths only for a verified rights-cleared turn take. Avoid new public package exposure.

**Evidence integration:** Existing SC-07–09 bounded source lists include approach consumers and physician GLB, but omit the stance-lock and bedside execution modules and any future leg module. Card-local proof must bind changed inputs. Handoff to the SC-07 owner must ensure its later versioned producer coverage includes these modules/assets; an impact note alone does not authenticate omitted logic. No shared proof contract edits are authorized by this consultation.

**Still open:** full browser A08 foot-slide verdict, generic browser performance, future offline AI-clip cleanup/bake, Quest and clinical efficacy. This card improves what the eventual demonstration will show; it does not own video or website production.

## Board overlap

Final Grok native inventory found no active terminal-turn/foot-lock duplicate. Existing cards:

- `SC-05 r2 — The case-selected physician walks to the measured bedside target and stops in UI-XR` (`tsk_4d39f0beaa5cdcc6`): Landed; declared residual defect.
- `Humanoid motion program: catalog transitions, live IK, per-encounter behaviour` (`tsk_e8ac84dd9cb6ac06`): documentation pointer, not an execution owner.
- `Bake vertical: deterministic real-rig MotionProgram → manifest GLB → UI-XR playback (A-grade canonical)` (`tsk_c0d67f74a7891719`): future bake lane; currently has cancelled dependencies. Later generated-clip cleanup belongs here after it is independently plantable.
- `Seven artifact-derived motion validators with isolated negative probes (A-grade canonical)` (`tsk_9dc69fa037b495dd`): future bake validation, not the immediate terminal-turn fix.
- SC-07–09: Idle capture/replay/promotion follow-ons; later evidence must include actual new motion inputs.

## Repository references

- [Existing root/slot stance lock](/Volumes/files/src/openclinxr/packages/openclinxr/xr-humanoid-animation/src/stance-lock-mod.ts)
- [Case-owned consumer and lock gating](/Volumes/files/src/openclinxr/packages/openclinxr/xr-humanoid-animation/src/case-owned-approach-runtime-mod.ts)
- [Approach execution and settling](/Volumes/files/src/openclinxr/packages/openclinxr/xr-runtime-state/src/bedside-approach-execution-mod.ts)
- [Playback and ownership integration](/Volumes/files/src/openclinxr/packages/openclinxr/xr-humanoid-animation/src/locomotion-clip-playback-mod.ts)
- [Existing arm solver](/Volumes/files/src/openclinxr/packages/openclinxr/motion-compiler/src/ik/solve-chain.ts)
- [Retained SC-05 findings](/Volumes/files/src/openclinxr/docs/openclinxr/scene-closure-2026-09-09/evidence/sc-05.md)
- [Actual shipped measurement consumer](/Volumes/files/src/openclinxr/tools/openclinxr/evidence/scene-closure/proofs/sc-05/runtime-approach-measurement.ts)
- [Browser recorder and cadence instrument](/Volumes/files/src/openclinxr/tools/openclinxr/evidence/scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts)
- [Pinned capture input coverage](/Volumes/files/src/openclinxr/tools/openclinxr/evidence/scene-closure/proofs/sc-09/closure-inspection.ts)

## Four-round consultation record

1. Verified access, existing root locking versus leg IK, article/example licensing and current card overlap.
2. Reproduced the real terminal-turn failure; corrected the assumption that SC-05 Landed meant A08 closed; rejected a dependency on blocked bake work.
3. Distinguished frozen rubric from derived cadence policy; bounded the new task to turn quality and browser correlation; identified omitted proof inputs.
4. Verified fresh board inventory and create-time fields; tightened chain ownership, contact-label counterweights, card-local input binding and owner handoff. Final recommendation: one focused follow-up, no card created.
