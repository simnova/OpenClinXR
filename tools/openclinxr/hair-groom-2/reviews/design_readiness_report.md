# Design critic + implementation readiness report (Goldfish, round 1)

Reviewer: fresh-context subagent with the GoldfishContext reading list, read-only. 2026-11-07.
Resolution by the Elephant (EGM resolve categories: PROPOSE FIX, CONTEST, ESCALATE, DECLINE).
Each FIX was re-verified against the tree before applying.

| # | sev | finding | verified by Elephant | resolution |
|---|---|---|---|---|
| D1 | 🔴 | v1 `hair-groom/cards/` + `shell/` already implement clustering, frames, widths, UVs, clearance, seeded atlas; draft said no card bake exists | `cards.py:1-30`, `textures.py:1-15`, `evidence/hair-cards0/RESULT.txt` (360 cards, hash-identical, min clearance 1.502 mm) | FIX: S4/S5 adopt v1; Problem 3 rewritten |
| D2 | 🟡 | basemesh vertex transfer breaks post-export (53,672 vs 13,380 verts) | `embed_library_hair.py:16-24`, materializer `:7444-7456` | FIX: S2-S6 run in the materializer session |
| D3 | 🟡 | 3 `mhair02` actors have no source diffuse; toigo loss is per bake | materializer `:7474-7483` HAIR_TEXTURE_SKIP | FIX: Problem 1 and Phase 0 rewritten |
| D4 | 🟡 | V2 baseline includes un-reduced brows and regressed lashes; `-inspect` GLBs counted | `EYEBROW_REDUCTION` at materializer `:7650`; baseline TSV | FIX: V2 is a sweep pending OQ1; brow/lash regression moved to Phase 0; `-inspect` excluded |
| D5 | 🟡 | V4 threshold source (strand median clearance) does not support a root bound | `operator-hair-muse4h.md` 16:30Z entry | FIX: V4 reuses v1 `cards.py` gate ≥ 0 after 1.5 mm push-out |
| D6 | 🟡 | V5 known-good column is the opaque defect; no instrument | reasoning | FIX: known-good = Phase 0 alpha library hair; instrument defined |
| D7 | 🟡 | S7 in UI-XR alone misses Model Vetting captures | `generated-loaders.ts:225-231` read | FIX: both renderers named |
| D8 | 🟡 | wrong registration files; schema path; style is a code table | paths read | FIX: target files corrected |
| D9 | 🟢 | probe UVs probably constant | GLB parsed: U ∈ {0.0}, V ∈ {1.0} | FIX: prior-art row corrected; Curve to Mesh dropped |
| D10 | 🟢 | `main.ts:2834` not 2835 | — | FIX |

Comprehension findings C1-C13 (`comprehension_report.md`) resolved in the same revision: glossary
added (C5), style family defined (C3), phase-to-stage table (C4), two primitives with V3 = 2 (C1),
V4 sign stated (C7), V5 pass condition (C6), V2 no longer spends brow headroom (C8), vertex-index
transfer (C9), `apply_actor_hair_colour.py` delta stated (C10), 32-point resample cited (C12),
rollout default stated (C13). C11 (nearest cluster shape) is moot: v1 assigns atlas cells by
`card_idx % 4`.
