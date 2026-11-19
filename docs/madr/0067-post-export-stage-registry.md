# 0067 — post-export stage registry

- Status: **accepted**
- Date: 2026-11-19
- Deciders: super-ceo-cap45 (A1/A2/B split ruling, 2026-11-19)
- Known-good inputs: `post-export-stage-registry.ts`, `apply_hair_material_maps.py`, and the family-partner post-export chain manifest

## Context

The chain runner and the teeth and garment lineage readers each need to recognize post-export tools. The material-maps stage changes hair materials while preserving the mesh data used by geometry consumers.

## Decision

Use one `POST_EXPORT_STAGE_REGISTRY` keyed by `toolPath`. Each entry declares what the stage `mutates` and `preserves`. The chain manifest validator and the `validateT3` and `edBakeLineage` readers use this registry to recognize post-export stages.

## Verification (2026-11-19)

- P1 exercises the manifest validator's refusal when registration is omitted and the chain's replay with registration present.
- P2 exercises an unregistered tool substitution with intact SHA links in the garment lineage reader and guards the existing refusal in the teeth lineage reader.

## Consequences

- The chain manifest validator refuses an unregistered tool on a stage marked `postExport: true`. In `edBakeLineage` and the levels checked by `validateT3`, including the physician's legacy neckline level, only an allowlisted command with a literal registered script in the invocation role earns stage credit. The resolver refuses unsupported script invocations and shell positional script paths. Its backstop also refuses any `tools/` script reference in the normalized record without a matching credited operand. Gown attribution requires each credited stage to preserve procedural gown lineage. Robert Hayes's terminal Blender bake is exempt from post-export registration only if exactly one `--python` occurs before `--`, with `tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py` as its operand.
- **Threat model** — Forging a shipped sidecar requires a visible committed diff to a generated provenance record. The resolver addresses producer drift and accidental attribution of stage credit. A hand-edited sidecar is outside this threat model.
- **Known limits** — The backstop scans text, so a data path that embeds a `tools/` script name followed by a delimiter (for example `--glb /tmp/tools/robert.py,pre.glb`) refuses a level whose real invocation is registered. The refusal is loud (C5) and never grants credit, and no shipped sidecar or real producer names such a path. Records crafted by hand can also earn credit through an interpreter option that does not run the script (`python3 --version <script>`), or hide a script behind quote concatenation. Both require a committed edit to a generated record. Producers writing structured tool paths per level replace this text scan for new levels.
- Geometry consumers move to accessor-digest pins in A2.
- **Known limits (Codex rv6 2026-11-19; accepted-unfixed, outside this stage's threat model)** —
  F2 MED: "Padded matrix components can change under the same pin";
  F3 MED: "The new range checks still accept malformed inputs under the committed pin";
  F8 MED: "Joint-local transforms leave the effective rig unpinned";
  F9 MED: "FU1 rejects a valid GLB with an unknown trailing chunk";
  F10 MED: "The new sparse overlay accepts duplicate and descending indices";
  F11 LOW: "CW2 and CW3 can pass on malformed fixtures";
  F12 LOW: "Clause 2 leaves combined legacy acceptance untested".
- `post-export-stage-consumers.json` records the compact consumer inventory. Its header identifies and authenticates the full inventory in the asset store at `post-export-stage-finalize/post-export-stage-consumers.full-1e06aa00.json`.
