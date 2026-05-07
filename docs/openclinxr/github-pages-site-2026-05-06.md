# GitHub Pages Site

Date: 2026-05-06
Status: GitHub Pages built from `main` `/docs`

## Committed Site

## Decision

- Date: 2026-05-07
- Decision: **Use legacy branch/folder Pages delivery for now (`main` + `/docs`).**
- Reasoning: The repository is already publishing successfully through the repository Pages source settings, with HTTPS routed via committed `docs/CNAME`. This path is stable and avoids introducing a new deployment workflow until there is a compelling reason.
- Compensating rule: only revisit if we need custom deployment semantics, pull-request-only preview behavior, or multi-environment pages controls that settings-based source cannot provide.


The public project site lives under the repository Pages source directory:

- `docs/index.html`
- `docs/styles.css`
- `docs/assets/openclinxr-xr-evidence.png`
- `docs/.nojekyll`
- `docs/CNAME`

GitHub Pages can be enabled either with a committed workflow or through repository settings (`main` + `/docs` source). This repo is currently managed without requiring the committed Pages workflow file.

The root `README.md` links to the live Pages URL reported by GitHub:

<https://developers.simnova.com/OpenClinXR/>

`gh api repos/simnova/OpenClinXR/pages` reports source branch `main`, path `/docs`, status `built`, and `html_url` `https://developers.simnova.com/OpenClinXR/`.
A local `curl -I` check returned HTTP 200 for the URL on 2026-05-06 after the CNAME file was added.

## Validation

Local validation commands:

```bash
pnpm pages:sync-evidence-links
pnpm pages:sync-validate
pnpm pages:validate
```

`pages:sync-evidence-links` updates the indexed evidence snapshot links under `docs/index.html` to the
most recent committed snapshot files for each configured `data-pages-snapshot` key.

`pages:sync-validate` performs the same check in validation mode (no file writes) and then
invokes `pages:validate`.

The validator is also included in `pnpm agent:verify`.

The pages wiring and evidence snapshot integrity checks now pass when running:

```bash
pnpm pages:sync-evidence-links
pnpm pages:sync-validate
pnpm pages:validate
```

## Remaining Operator Step

Review the repository Pages/domain settings once before major domain changes, then rely on `docs/openclinxr/security-audit-cadence.md`/`docs/openclinxr/worker-backlog-and-validation-matrix.md` for recurring evidence cadence.
