# Comprehension report (Goldfish, round 1)

Reviewer: fresh-context subagent, read DESIGN.md only. 2026-11-07.

**What this proposes** (reviewer paraphrase): a deterministic station turning a JSON recipe + seed into
a hair-card mesh with an alpha atlas, fitted to one MPFB actor and embedded in its GLB. Scalp defined
once on the MPFB base mesh; Blender bundled node assets grow strands; strands clustered into ribbon
cards; Cycles atlas cached per style family; head-bone weights, one primitive, LOD. UI-XR uses
alpha-to-coverage and Kajiya-Kay. `hair.source` switches cards vs library hair.

**How the existing system works, per this document**: library `.mhclo` hair, opaque and untextured in
11 of 12 GLBs (cause unknown); brows and lashes cost more triangles than hair; v1 is a stalled
LLM-driven hill-climb with no runtime consumer.

| # | sev | section | finding | resolution |
|---|---|---|---|---|
| C1 | 🟡 | S4 vs S6/V3 | opaque shell + alpha cards vs "one primitive, one material" | PROPOSE FIX: one MASK material, shell tile alpha 1.0 |
| C2 | 🟡 | Problem 2 | "six above 20,000" but four rows shown | PROPOSE FIX: name all six |
| C3 | 🟡 | S1/S5 | "style family" undefined | PROPOSE FIX: define |
| C4 | 🟡 | numbering | OQ4 says Stage 5; phases not mapped to stages | PROPOSE FIX |
| C5 | 🟡 | jargon | D1/D9/D13, keeper, row-gap scorer, MPFB, .mhclo, EGM undefined | PROPOSE FIX: glossary |
| C6 | 🟡 | V5 | no pass condition | PROPOSE FIX |
| C7 | 🟡 | V4 | sign convention; median used as ceiling | PROPOSE FIX |
| C8 | 🟡 | G4/V2 | headroom from brows not yet available before S8 | PROPOSE FIX: phase-scoped budget |
| C9 | 🟢 | S2 | barycentric vs vertex index | see design report D1 |
| C10 | 🟢 | Target files | apply_actor_hair_colour.py delta unclear | PROPOSE FIX |
| C11 | 🟢 | S5 | "nearest cluster shape" metric undefined | PROPOSE FIX |
| C12 | 🟢 | Alternatives | 31 segments unsourced | PROPOSE FIX: cite 32-point resample |
| C13 | 🟢 | NFR | default after Phase 3 ambiguous | PROPOSE FIX |
