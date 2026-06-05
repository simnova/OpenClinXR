# IWSDK Spike Package

**Arena role:** typed policy, evidence, MCP/tooling, and validation contracts for the IWSDK sidecar.

**Governing decisions:** [MADR 0027](../../../../docs/madr/0027-quest3-usb-webxr-smoke-gate.md) and [MADR 0028](../../../../docs/madr/0028-iwsdk-sidecar-spike.md).

**Validation relationship:** this package is the typed contract layer for using the IWSDK sidecar during peds launch validation when XR input, scene hierarchy, MCP, or spatial UI parity evidence would materially reduce runtime risk.

**Production relationship:** this package can describe and validate IWSDK evidence, but production apps must not import IWSDK runtime dependencies or sidecar app internals.

Useful checks:

- `pnpm --filter @openclinxr/iwsdk-spike test`
- `pnpm --filter @openclinxr/iwsdk-spike typecheck`
- `pnpm arena:iwsdk:verify`

Promotion requires an updated MADR/successor MADR plus architecture-rule changes that explain the stable contract being promoted.
