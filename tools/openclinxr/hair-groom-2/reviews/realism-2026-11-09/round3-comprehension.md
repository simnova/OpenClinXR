# Round 3, comprehension (Goldfish), raw findings, unresolved

Paraphrase failed for: none (Problem 3 second sentence hard to parse, R3U12).

- R3U1 Major [G1/P3] G1 says "every rig in use", P1 builds 3 rigs, P2/P3 gates name fitted and default only. Fix: say whether room rig is gated.
- R3U2 Major [P1] "one shipped-room rig" names no room or rig JSON. Fix: name it.
- R3U3 Major [P2] data map A "shift amount" has no source; G depth has no normalisation/units.
- R3U4 Major [P2 gate] ID equality-share pixel population and pair direction undefined.
- R3U5 Major [Glossary/gates] seed spread is one difference of two seeds (n=2) used as noise floor everywhere; undefined for target-relative (.49) and card-vs-card (P3a) checks.
- R3U6 Major [P3 gate] "beats BEST3" compared against target or strand reference?
- R3U7 Major [G4] 12 MB: mips counted?
- R3U8 Major [P5] artifact count, class, split threshold undefined.
- R3U9 Major [Metrics] "outside the card hull" undefined for strand renders.
- R3U10 Nit [P1 parity] .033 is fitted-rig vs target error, reused as renderer parity tolerance for rigs with no target.
- R3U11 Nit [P2] SP undefined (run_cards.sh:36).
- R3U12 Nit [Problem 3] "56 outlier strands make ... and card means drop them" does not parse.
- R3U13 Nit [Glossary] isolated-subject-rig-variants.ts is in packages/openclinxr/xr-scene/src/; default rig has a rim light.
- R3U14 Nit [P2] cards_from_strands.py:36 not about card_uv; lines 45, 662-664.
- R3U15 Nit [P3] three uses a supplied tangent attribute only with anisotropy or normal map; does not build tangents; line 302.
- R3U16 Nit [Files] surface-meter.test.ts lives under packages/openclinxr-verification/architecture-rules/.
- R3U17 Nit [P3 0a] spec .15 unexplained.
- R3U18 Nit [Glossary vs What worked] 63,024 vs 62,996 not reconciled.
- R3U19 Nit [P0] runtime sha not recorded anywhere; BEST3 material not covered by gate.
- R3U20 Nit [Metrics] target mask PNG path missing from file table.

All cited commits, prior-art claims, fitted-rig values, probe3.json, parting.json, scripts, lighting-rig.v1, lab:271, finalize-equipment-glb.ts:38, three r184 resolve.
