# UI-XR IWSDK Sidecar

**Arena role:** Meta Immersive Web SDK sidecar for Quest/WebXR/MR fit experiments.

**Governing decisions:** [MADR 0027](../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md) and [MADR 0028](../../../docs/madr/0028-iwsdk-sidecar-spike.md).

**Production relationship:** this sidecar may prove IWSDK capability, MCP/tooling, scene hierarchy, bundle, and Quest behavior. It is not the production learner runtime. `apps/ui-xr` remains the production XR shell until a MADR update or successor MADR explicitly promotes IWSDK behind stable runtime contracts.

Useful checks:

- `pnpm arena:iwsdk:dev`
- `pnpm arena:iwsdk:verify`
- `pnpm iwsdk:workspace:posture -- --approved-sidecar --approved-phase2-devtools --approved-sharp-libvips-exception --approved-uikitml-spatial-text`

Do not add IWSDK dependencies to production apps or non-arena packages as part of sidecar work.
