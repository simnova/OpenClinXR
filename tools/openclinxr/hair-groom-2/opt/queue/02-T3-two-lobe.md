# 02 T3 dual shifted specular lobes (stub)

Source: DESIGN-realism.md:186 (T3, Kajiya-Kay/Scheuermann dual lobes with shift; "R-b: band and streaks"; untested). Status: stub.
- hypothesis: one anisotropic lobe cannot give both the target's band row/continuity and its low peak; a second, shifted lobe
  can (counterweights: peakCeil, bandRowVec, bandCont).
- files: to be named (runtime shader path in the app; transplant_donor.py runtime-sheen block).
- new knobs + ranges: lobe 2 intensity, shift, roughness; ranges UNKNOWN.
- accept rule: fill before queueing; same ship rule as 01.
