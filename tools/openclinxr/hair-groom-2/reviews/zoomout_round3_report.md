# EGM zoom-out + inventive catalyst (round 3, adversarial), 2026-11-07 — resolved in adversarial_round3_report.md

Reviewer: fresh-context subagent using EGM persona files; read-only. Labels are the reviewer's; not yet re-verified by the Elephant.

1. 🔴 VERIFIED. Library route rejected on a false premise ("five styles"). MakeHuman catalogue lists Hair 01 (CC0), Hair 02 (CC-BY), Hair 03 (CC-BY, Alpha 7 adaptations), system hair materials (CC0); ledger `third-party-asset-licence-ledger.md:116-119,179` permits all 25 hair01 styles since 2026-09-17. haireditor refusal may be stale under that ruling (INFERRED). Alternative: acquire Hair 02/03, classify with `hair-licence-classify.ts`, map via `HAIR_STYLE_BY_REFERENCE`; ~1-2 slices, may make S2-S5 unnecessary.
2. 🔴 VERIFIED. Visible defect is wrong-style and duplicated identity: gown-ed-robert-hayes (adult male) wears toigo_blunt_bob_with_bangs; 4 of 10 actors share it. Phase 3's male baseline is a wrong-gender style.
3. 🔴 VERIFIED. Phase 0 cannot run here: materializer reads `.openclinxr-local/provider-cache/hair/sources/makehuman-hair01/` (`:278-279`); no `hair/` in either tree's provider cache. Re-acquisition is an unstated prerequisite.
4. 🟡 VERIFIED. Materializer is 10,256 lines, 47 commits since 2026-10-01; S2-S6 inside it forbids isolated testing (D3/D4). Alternative: materializer dumps basemesh head+scalp npz before helper strip; station runs standalone, returns mesh+weights.
5. 🟡 VERIFIED. No LOD consumer (no MSFT_lod / THREE.LOD in apps/ or packages/). Cut S6 LOD or name the runtime switch.
6. 🟡 INFERRED. Library hair is 100% head-weighted and ends at chin height; long recipes will pierce shoulders in motion. Need body_motion clearance gate or neck/spine weights.
7. 🟡 INFERRED. Multi-actor overdraw and MASK shimmer without MSAA; no per-scene fill measure.
8. 🟡 VERIFIED. Clean comparator captures skip `material-tint.ts`, so V5/V7 may never see S7 shading; doc must say which path is graded.
9. 🟢 Citations `:238`, `:7480`, `:7650`, `main.ts:2835` hold.
