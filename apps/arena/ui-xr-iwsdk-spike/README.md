# UI-XR IWSDK Sidecar

**Arena role:** Meta Immersive Web SDK sidecar for Quest/WebXR/MR fit experiments.

**Governing decisions:** [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md) and [MADR 0028](../../../docs/madr/0028-iwsdk-sidecar-spike.md).

**Validation relationship:** this sidecar is promoted as the preferred IWSDK validation lane for peds launch checks that need XR input, spatial UI, MCP/tooling, scene hierarchy, bundle, or Quest/WebXR parity evidence.

**Production relationship:** this sidecar may prove IWSDK capability, MCP/tooling, scene hierarchy, bundle, and Quest behavior. It is not the production learner runtime. `apps/ui-xr` remains the production XR shell until a MADR update or successor MADR explicitly promotes IWSDK behind stable runtime contracts.

**Current IWSDK pin:** `@iwsdk/core@0.4.2`, `@iwsdk/xr-input@0.4.2`, `@iwsdk/vite-plugin-dev@0.4.2`, and `@iwsdk/vite-plugin-uikitml@0.4.2`. The IWSDK Vite plugins still declare `vite: ^7.0.0`; OpenClinXR keeps this as a sidecar validation exception while the repo remains on Vite `8.0.10`.

Useful checks:

- `pnpm arena:iwsdk:dev`
- `pnpm arena:iwsdk:verify`
- `pnpm iwsdk:workspace:posture -- --approved-sidecar --approved-phase2-devtools --approved-sharp-libvips-exception --approved-uikitml-spatial-text`

Do not add IWSDK dependencies to production apps or non-arena packages as part of sidecar work.
