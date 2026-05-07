# GitHub Pages Site

Date: 2026-05-06
Status: GitHub Pages built from `main` `/docs`

## Committed Site

The public project site lives under the repository Pages source directory:

- `docs/index.html`
- `docs/styles.css`
- `docs/assets/openclinxr-xr-evidence.png`
- `docs/.nojekyll`

GitHub Pages can be enabled either with a committed workflow or through repository settings (`main` + `/docs` source). This repo is currently managed without requiring the committed Pages workflow file.

The root `README.md` links to the live Pages URL reported by GitHub:

<http://developers.simnova.com/OpenClinXR/>

`gh api repos/simnova/OpenClinXR/pages` reports source branch `main`, path `/docs`, status `built`, and `html_url` `http://developers.simnova.com/OpenClinXR/`. A local `curl -I` check returned HTTP 200 for that URL on 2026-05-06. HTTPS for the custom domain is not yet claimable from this machine because the certificate response did not match `developers.simnova.com`.

## Validation

Local validation commands:

```bash
pnpm pages:sync-evidence-links
pnpm pages:validate
```

`pages:sync-evidence-links` updates the indexed evidence snapshot links under `docs/index.html` to the
most recent committed snapshot files for each configured `data-pages-snapshot` key.

The validator is also included in `pnpm agent:verify`.

## Remaining Operator Step

Review the repository Pages/domain settings before publishing the URL externally. The HTTP URL serves the site, but HTTPS certificate posture for `developers.simnova.com` still needs DNS/certificate cleanup before using an `https://` public link.
