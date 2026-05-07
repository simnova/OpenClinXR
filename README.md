# OpenClinXR

OpenClinXR is an evidence-gated XR clinical simulation workspace for virtual-patient encounters, Quest/WebXR runtime evidence, local-first voice, and production asset readiness.

Project page: <https://developers.simnova.com/OpenClinXR/>

## Current Posture

This repository is early-stage infrastructure, not a clinical product. Runtime, voice, XR, and asset-generation claims are deliberately scoped by committed evidence artifacts and validator scripts.

Useful entry points:

- [OpenClinXR docs](docs/openclinxr/)
- [Implementation plan](docs/openclinxr/code-implementation-plan.md)
- [PNPM audit cadence runbook](docs/openclinxr/security-audit-cadence.md)
- [Quest 3 USB WebXR smoke checklist](docs/openclinxr/quest3-usb-webxr-smoke-checklist.md)
- [Local AI voice model strategy](docs/openclinxr/local-ai-voice-model-strategy.md)
- [Automated asset generation pipeline](docs/openclinxr/asset-generation-pipeline.md)

## Verification

Use Node `22.19.0` and pnpm `10.33.0`.

```bash
pnpm agent:verify
pnpm typecheck
pnpm test
pnpm security:audit-policy
pnpm security:licenses
```

For GitHub Pages maintenance:

```bash
pnpm pages:sync-evidence-links
pnpm pages:sync-validate
pnpm pages:validate
```

`pages:sync-evidence-links` updates the four snapshot links under `docs/index.html`
to the latest matching files in `docs/openclinxr` using the `data-pages-snapshot` keys.

`pages:sync-validate` checks whether `docs/index.html` is already up to date and then
runs `pages:validate`.

The public GitHub Pages site is static content in [docs](docs/) and is configured to publish from `main` with `/docs` as the Pages source.
