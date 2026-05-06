# GitHub Pages Site

Date: 2026-05-06
Status: Static site committed; GitHub Pages enablement blocked by token permissions

## Committed Site

The public project site lives under the repository Pages source directory:

- `docs/index.html`
- `docs/styles.css`
- `docs/assets/openclinxr-xr-evidence.png`
- `docs/.nojekyll`

The root `README.md` links to the expected Pages URL:

<https://simnova.github.io/OpenClinXR/>

## Validation

Local validation command:

```bash
pnpm pages:validate
```

The validator is also included in `pnpm agent:verify`.

## Blocked Operator Step

GitHub Pages still needs to be enabled in repository settings:

1. Open `https://github.com/simnova/OpenClinXR/settings/pages`.
2. Set **Build and deployment** source to **Deploy from a branch**.
3. Select branch `main` and folder `/docs`.
4. Save.

Attempted API enablement with:

```bash
gh api repos/simnova/OpenClinXR/pages -X POST -f 'source[branch]=main' -f 'source[path]=/docs'
```

GitHub returned `403 Resource not accessible by personal access token`, so the local token can push the site files but cannot change Pages settings.
