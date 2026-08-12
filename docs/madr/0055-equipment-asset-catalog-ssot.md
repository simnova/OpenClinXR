# 0055 — Equipment asset catalogue is file-first SSOT (optional Mongo projection)

- Status: **accepted**
- Date: 2026-08-12
- Deciders: Patrick (operator); chief-coordinator embodiment
- Relates to: MADR 0054 (three-lane equipment factory), 0049 (licence ledger), 0016 (provenance)
- Implements: catalogue for ~37 runtime equipment ids × 14 scenario-bank blueprints

## Context

Equipment identity is currently split across:

- Scenario prose lists (`scenario.equipment: string[]`) — human labels, not ids
- Runtime builders (`buildDeclaredEquipmentGeometry` switch)
- GLB map (`REAL_EQUIPMENT_GLTF_BY_ID`)
- Placement / room props in asset-registry runtime bundles

Without a single catalogue, lane doctrine (0054) cannot be enforced, OSS library work has nowhere
to land, and “does this blueprint have a mid-band stretcher?” is a chat question, not a gate.

Operator also invited **free/open-source library expansion** and **metadata in a database**.
Git-tracked factory SSOT must survive offline CI and worktrees; Mongo is a **projection**, not
the only source of truth (same split as other factory registries).

## Decision

1. **File-first SSOT**  
   Canonical catalogue (tracked; `.openclinxr/` is gitignored in this monorepo):  
   `docs/openclinxr/equipment-catalog.v1.json`  
   Schema version: `openclinxr.equipment-catalog.v1`  
   Generated/updated by CLI; committed when lanes or bank bindings change.

2. **Each row** records at minimum:
   - `equipmentId` (runtime id, `*_equipment`)
   - `lane`: `bank` | `thin_parametric` | `modular_kit`
   - `runtimeSource`: `gltf` | `parametric` | `fallback` | `unknown`
   - `gltfFileName` (if bank/hybrid)
   - `builderSymbol` (if parametric)
   - `kitRecipeId` (if modular kit)
   - `proseAliases[]` (scenario-bank strings that resolve here)
   - `scenarioIds[]` (blueprints that list an alias or id)
   - `midbandStatus`: `none` | `pack_only` | `glb_present` | `kit_default` | `graded`
   - `licenceStatus`: `internal` | `cc0` | `cc_by` | `refused` | `unspecified_blocked` | `n/a`
   - `provenancePath` / `ledgerSource` (if third-party)
   - `claimScope` / `notEvidenceFor` (short strings)
   - `notes`

3. **CLI surface** (OpenClaw-friendly):
   - `pnpm factory:equipment:catalog:inventory` — rebuild from bank + builders + GLB map
   - `pnpm factory:equipment:catalog:validate` — fail closed on missing lanes, orphan builders,
     unmapped prose labels, gltf map without file, kit lane without recipe
   - `pnpm factory:equipment:catalog:report` — human/agent summary for the 14 blueprints

4. **Optional Mongo projection**  
   When `MONGODB_URI` (or existing factory Mongo) is available, CLI may upsert the same documents
   into collection `equipment_asset_catalog_v1` for admin/query. **Validate always prefers the
   file.** Mongo never wins a conflict; file is rewritten by inventory, Mongo is refreshed after.

5. **OSS acquisition path**  
   Candidates land in the **licence ledger** first (0049). Only after CC0/CC-BY is verified do they
   get a catalogue row with `licenceStatus` + `ledgerSource` and a bank path under provider-cache
   or `xr-assets` with provenance JSON.

## Consequences

- Factory loop iteration 0 = inventory + validate green (or known allowlisted gaps).
- Agents must not add equipment ids without a catalogue row.
- Prose→id mapping gaps are first-class backlog, not silent fallbacks forever.

## Out of scope

- Clinical device fidelity claims
- Quest readiness from catalogue presence alone
- Auto-downloading unverified Sketchfab/Poly Pizza packs
