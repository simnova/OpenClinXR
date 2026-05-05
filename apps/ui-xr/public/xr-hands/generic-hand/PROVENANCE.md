# Generic Hand Mesh Provenance

**Source package:** `@webxr-input-profiles/assets@1.0.20`  
**Source tarball:** `https://registry.npmjs.org/@webxr-input-profiles/assets/-/assets-1.0.20.tgz`  
**Inspected by:** Codex on 2026-05-05  
**License:** MIT, copied as `LICENSE.md` in this directory  
**Runtime use:** Local WebXR hand mesh assets only; no CDN fallback allowed

## Copied Files

| Source path | Destination path | SHA-256 | Modification |
| --- | --- | --- | --- |
| `dist/profiles/generic-hand/left.glb` | `apps/ui-xr/public/xr-hands/generic-hand/left.glb` | `bc67783144944ea1cda54d9247885825ea5fb9d4651469fe7d00be517a5c2b87` | None |
| `dist/profiles/generic-hand/right.glb` | `apps/ui-xr/public/xr-hands/generic-hand/right.glb` | `291790c14f7f88a7f9bd35330c47392ed8e8d395ae6728f4bb7089f1bc1f2b96` | None |
| `dist/profiles/generic-hand/profile.json` | `apps/ui-xr/public/xr-hands/generic-hand/profile.json` | `749bb0624eb032d1e726e87dad398e6729020f35d62d2e9b431d4202e4c656fc` | None |
| `LICENSE.md` | `apps/ui-xr/public/xr-hands/generic-hand/LICENSE.md` | `0ef0c87e8ffdd0681f332dc3b39f284dee2166d1f853fabc3853884fe81a6f30` | None |

## Notes

- `npm view @webxr-input-profiles/assets` did not expose a plain `license` field, so the npm tarball was inspected directly.
- The tarball `LICENSE.md` contains MIT License text with Amazon copyright attribution.
- These assets are intentionally copied as static local files so Three.js `XRHandMeshModel` does not fall back to its jsDelivr default path.
- Quest 3 hand-quality and frame-pacing claims remain blocked until a fresh worn-headset run records `avgFps`, `p95FrameMs`, and active `handRepresentationKind: "mesh"`.
