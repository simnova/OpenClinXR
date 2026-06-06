# OpenClinXR XR Medical Equipment Fixture Provenance

## Artifacts

- `ecg-cart-12-lead.glb`
- SHA-256: `c3b6f1934eb232a3c32b7d6afd830d09b0632b29bf83d3e5d776746b3cafb378`
- `iv-pole-with-pump.glb`
- SHA-256: `1a9a57932e2e0b8bd86c927527e8ea4fcb19fd3e74bf9ba33ec4490234ccfb04`
- `inhaler_spacer_equipment.glb`
- SHA-256: `16f593508e3b4aac78efd3ab8ccb19fc28da471c0c5c281c416dc56ff5197e29`
- `nebulizer_mask_equipment.glb`
- SHA-256: `91a485a9f3ec27bb75d4e5295ba1ba62a16302f63af0b0d3190ea624ccc28c3d`
- `oxygen_wall_port_equipment.glb`
- SHA-256: `d543ad97f96c95858209d267a8d1fa438a75e234d46be8ec8d860f347fd7e041`
- `parent_chair_equipment.glb`
- SHA-256: `68adbb73d39f75bfc128e317c9bddb9265a5206dd8a8a9a7c79f0e65dd36db9d`
- `pediatric_stretcher_equipment.glb`
- SHA-256: `010f3a7533d403c80e6d13d54018144d94f19d1816dd887fc1bea8b2a9ffdc23`
- `pulse_oximeter_equipment.glb`
- SHA-256: `0ddc1fa03f397d001bdf350a8e8c5ef4224274cba876c4a8879d3d56f8672c83`

## Source

- Repo-authored local Blender fixtures generated from `.openclinxr/asset-production/ed-chest-pain/medical-equipment/`.
- Generator: `tools/openclinxr/medical-equipment-artifacts.ts`
- Companion report: `.openclinxr/asset-production/ed-chest-pain/medical-equipment/equipment-provenance.json`.
- Pediatric asthma fixtures are repo-authored local Blender primitives generated for the public UI-XR runtime path after browser evidence showed the peds bundle referenced missing equipment GLBs.
- Pediatric generator scratch script: `.openclinxr/openclaw/generate-peds-runtime-fixture-assets.py` (local ignored scratch); the committed source of truth is this provenance plus the checked fixture GLBs.

## Policy

- Local fixture only.
- No external assets, cloud APIs, paid APIs, or third-party generated assets.
- No production asset readiness, Quest readiness, clinical validity, or scoring claim.
- Primitive in-scene equipment geometry remains as the fallback if these GLBs fail to load.
- Pediatric asthma fixture GLBs are local runtime continuity assets only; they are not production equipment models and do not prove clinical or scoring validity.
