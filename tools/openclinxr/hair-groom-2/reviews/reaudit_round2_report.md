# Re-audit round 2 (Goldfish, fresh context)

Reviewer verdict: not a clean round. EGM allows one re-audit per stage, so the Elephant resolved the
findings below without a third round. Each was checked against the tree first.

| # | sev | finding | verified | resolution |
|---|---|---|---|---|
| R1 | fix error | round-1 D10 moved the citation to `main.ts:2834`; it is `:2835` | `grep -n "antialias: true"` → 2835 | FIX: reverted |
| R2 | 🟡 | V4 passes by construction: `cards.py` pushes vertices out, then gates ≥ 0 on its own output | `cards.py` step 6 | FIX: V4 now gates guide-centreline clearance before push and caps push displacement at the 2.2 mm layer offset |
| R3 | 🟡 | `cards.py:50` reads head axis from one actor's `hair-scalp1/scalp.npz` | `cards.py:50,96` | FIX: S2 produces a per-actor axis; listed in Modify |
| R4 | 🟡 | V5 unjudgeable for street-adult-male (mhair02, no texture to restore) | GLB material name | FIX: Phase 3 uses gown-ed-robert-hayes (toigo) instead; mhair02 actors excluded |
| R5 | 🟡 | brow "regression" may be deliberate (`--eyebrow-tris-budget`) | materializer `:7638-7648` | FIX: Phase 0 checks bake dates against #597 before re-reducing |
| R6 | 🟡 | Model Vetting S7 hook unnamed (`:225,657` are renderer constructors) | `candidate-capture.ts:283-292` | FIX: hook named |
| R7 | 🟢 | "8 toigo actors" is 7 (6 untextured); `:179` is `:181`; embed path missing directory | GLB scan | FIX |
| R8 | 🟢 | family-partner's 3,239 lash triangles unexplained | TSV | recorded as UNKNOWN in Phase 0 |
