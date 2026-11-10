# Gate red-team (round 3, adversarial), 2026-11-07 — resolved in adversarial_round3_report.md

Reviewer: fresh-context subagent, read-only. Claims labelled as the reviewer gave them; not yet re-verified by the Elephant.

| gate | cheapest false pass | sev | label | counterweight |
|---|---|---|---|---|
| V1 | `cards.py:47-49`, `textures.py:30-31` hard-code hair-light2 / hair-scalp1 / hair-cards0 inputs; stale shared input gives equal sha | 🔴 | VERIFIED | gate inputs-opened.txt names this actor's body hash; no hair-light2/hair-scalp1 paths |
| V1 seed probe | `textures.py:37` SEED=7 ignores recipe seed; seed in GLB extras changes file sha only | 🔴 | VERIFIED/INFERRED | same seed → equal; different seed → different POSITION accessor hash |
| V2 | cardBudget not a `cards.py` input; `cards.py` raises outside 300-800 cards; no selection rule | 🔴 | VERIFIED | wire budget to guide count; pick smallest budget passing V5+V7 on 3 actors |
| V3 | 2 opaque untextured prims pass; library hair may remain | 🟡 | INFERRED | exactly 1 MASK+texture prim, 1 OPAQUE shell, 0 library-hair prims |
| V4(a) | `_geom.MeshIndex.query` returns unsigned distance; probe cannot fail | 🔴 | VERIFIED | signed distance (normal side / ray parity) |
| V4(b) | root push ~1.8-2.1 mm by construction vs 2.2 cap | 🟡 | INFERRED | measure max push on hair-cards0 first, or graded sweep |
| V5 | opaque shell under cards makes bare-scalp ≈0; non-lit capturePass (`candidate-capture.ts:253,259`) drops alpha | 🔴 | VERIFIED | measure cards-only (shell hidden); capturePass=lit; scalp mask from S2 ID pass |
| V5 known-good | library bob ≠ recipe style; part band exempt with no width cap | 🟡 | INFERRED | grade Phase 0 first; cap part band width |
| V6 | "succeed" = exit 0 | 🟡 | INFERRED | per-actor V4/V5/V7; distinct head axes; no actor-name branches |
| V7 | `textures.py` ignores curl/frizz/family; root alpha ≈1 → opaque ribbons | 🟡 | VERIFIED/INFERRED | wire family into textures; alpha fraction per v band; eyes/face clear; colour matches token |
| V8 | `hair-covers-both-sides-of-the-head.test.ts` counts `/scalp_hair/` vertices, returns null for cards | 🔴 | VERIFIED | do not reuse; ID-pass L/R split, bar from Phase 0 ambient asymmetry |
| probes | OPAQUE→V7 is human grade; atlas cache keyed with cards.npz id strip | 🟢/🟡 | VERIFIED | mechanical alphaMode assertion; content-keyed atlas cache |
| CUJ1/3/4 | library hair still present; no UI-XR grade; unpinned cameras | 🟡/🟢 | mixed | V3 counterweight; UI-XR capture in Phase 4; pin camera ids + capturePass |

Missing gates: garment/shoulder penetration (signed); hair in eye/face band; per-actor head axis differs; two families → different atlas hashes; material survives `apply_actor_hair_colour.py` as MASK+texture; head-bone weights survive export. Instruments (V5 boxes, scalp mask, capture pass/cameras/cutoff) are not yet named precisely enough to reproduce.
