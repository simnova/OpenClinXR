# Equipment factory 15-minute loop contract

**Status:** ACTIVE  
**Interval:** 15m  
**MADRs:** 0054 (lanes), 0055 (catalogue), 0049 (licence)  
**Plan:** `.openclinxr/plans/equipment-three-lane-factory.md`  
**Stop:** `PROJECT_STATUS.md` contains `PAUSED` or equipment-factory loop marked STOP; or zero unmapped prose + zero fallback + deck bank filled.

## Each tick (mandatory)

1. `cd /Volumes/files/src/openclinxr`
2. If `PROJECT_STATUS.md` top or latest checkpoint says equipment-factory **STOP/PAUSED** → exit 0 with one line, no work.
3. Read `docs/openclinxr/equipment-catalog-report.md` + plan next gap (priority: bed/stretcher → monitor → IV → ECG kit → chairs/exam → unmapped prose).
4. `pnpm factory:equipment:catalog:loop` (inventory + validate + report).
5. **One fill only** (anti-toil):
   - map one honest prose→id, OR
   - add thin builder/id for a real class, OR
   - re-verify one INFERRED OSS licence + stage acquisition notes, OR
   - acquire one VERIFIED CC0/CC-BY asset with provenance + catalogue bank row, OR
   - wire one bank GLB into `REAL_EQUIPMENT_GLTF_BY_ID`, OR
   - progress ECG modular_kit merge (worktree `feature/equipment-kit-approach-b`) only if higher-priority deck bank is not actionable.
6. Re-run `pnpm factory:equipment:catalog:validate`.
7. Append one line to `docs/openclinxr/equipment-factory-loop-log.md` (tick, action, validate ok/warn count).
8. Commit product/docs when meaningful (not every empty tick). No force-push.

## Cadence consults (from loop state counter)

State file: `docs/openclinxr/equipment-factory-loop-state.json`

| When | Role | Action |
|------|------|--------|
| every tick | orchestrator | one fill + catalog loop |
| every **3rd** tick | **curious researcher** | spawn explore: OSS/licence/existing tool for *next* gap; update `equipment-oss-candidates.md` / ledger refused/candidates only |
| every **4th** tick | **architect** | spawn plan/explore: topology of catalogue↔runtime, kit merge safety, multi-case dark path; write short notes under `docs/openclinxr/equipment-factory-architect-notes.md` |

Do not block the fill on consults — spawn background, integrate findings next tick if ready.

## Hard rules

- No clinical/Quest claims.
- Unspecified licence = refuse (0049).
- No silent wrong prose maps.
- Kit is modular_kit only (ECG until more recipes).
- Beds/stretchers prefer bank (lane 1) when CC-BY/CC0 verified.
- Main session posture: orchestrator; implementation via tools/CLI/spawn, not sprawl.
