# OpenClinXR XR Medical Equipment Fixture Provenance

## Artifacts

- `ecg-cart-12-lead.glb`
- SHA-256: `c3b6f1934eb232a3c32b7d6afd830d09b0632b29bf83d3e5d776746b3cafb378`
- `iv-pole-with-pump.glb`
- SHA-256: `1a9a57932e2e0b8bd86c927527e8ea4fcb19fd3e74bf9ba33ec4490234ccfb04`

## Source

- Repo-authored local Blender fixtures generated from `.openclinxr/asset-production/ed-chest-pain/medical-equipment/`.
- Generator: `tools/openclinxr/medical-equipment-artifacts.ts`
- Companion report: `.openclinxr/asset-production/ed-chest-pain/medical-equipment/equipment-provenance.json`.

## Policy

- Local fixture only.
- No external assets, cloud APIs, paid APIs, or third-party generated assets.
- No production asset readiness, Quest readiness, clinical validity, or scoring claim.
- Primitive in-scene equipment geometry remains as the fallback if these GLBs fail to load.
