# 01 T1 unlit albedo + AO bake via Shader AOVs (stub)

Source: DESIGN-realism.md:184 (T1, "R-a at source"; untested). Status: stub, not specified.
- hypothesis: baking albedo unlit with an AO term at the strand source removes the base/black mismatch that K (baseColor scale) is
  currently trading against bandProfileL8, sat and hue (SPEC counterweights).
- files: to be named (candidates: cards/atlas_bake.py, cards/atlas_from_members.py, cards/render_cards.py).
- new knobs + ranges: UNKNOWN until the bake exposes parameters (AO strength is the first candidate).
- accept rule: fill before queueing: ship rule (SPEC STOP) on the objective.json composite, all HARD, plus the G1' finalist gate.
