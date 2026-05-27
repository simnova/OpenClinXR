# License-compatible garment source options - 2026-05-27

## Recommendation

Use MakeHuman/MPFB asset packs first, with CC0-only allowlist entries. They have the clearest fit for the existing humanoid tooling and the least licensing friction.

## Option A - MakeHuman bundled/core assets

- Source: https://github.com/makehumancommunity/makehuman-assets
- License posture: repository states bundled MakeHuman assets were released under CC0 as of September 2020, while noting the transition from older AGPL/GPL licenses was a work in progress.
- Pipeline fit: high. Native MakeHuman/MPFB clothing assets are closest to the body/rig ecosystem and should be easiest to fit/retarget.
- Allowlist decision: strong candidate, but still require per-garment source URL, author, license, hash, and redistribution fields before materialization.

## Option B - MakeHuman Community asset packs, CC0 mesh clothing

- Source: https://static.makehumancommunity.org/assets/assetpacks.html
- License posture: page separates CC0 packs from CC-BY packs. Mesh asset packs include shirts, pants, dresses, suits, masks, shoes, and related clothing categories.
- Pipeline fit: high. Asset packs are designed for MakeHuman/MPFB workflows and have per-pack/per-asset metadata pages.
- First likely garment packs: `Shirts 01`, `Shirts 02`, `Shirts 03`, `Dress 01`, `Pants 01`, `Suits 01`, and selected CC0 items from `Suits 02` if clinically adaptable.
- Allowlist decision: best first target. Pick one CC0 shirt/tunic/gown-like asset and run through the ingestion wrapper.

## Option C - MakeHuman Suits 02 CC0 assets

- Source: https://static.makehumancommunity.org/assets/assetpacks/suits02.html
- License posture: asset table lists individual clothes with author, source, and CC0 license.
- Pipeline fit: medium. Some assets are fantasy/sci-fi and may need styling/material edits, but the page proves per-asset allowlist metadata shape.
- Allowlist decision: useful proof-of-process if a robe/tunic-like item is adaptable; not ideal for clinical realism unless material/shape fits.

## Option D - Public-domain/CC0 generic repositories

- Source: https://cg3d.org/
- License posture: advertises public domain mark and CC0 3D models with GLB/GLTF/OBJ/FBX-style formats.
- Pipeline fit: medium-low for humanoid clothing unless a garment mesh is found. Better for props/equipment.
- Allowlist decision: keep as secondary search space, not first garment source.

## Option E - Blend Swap CC0/CC-BY clothes

- Source: https://blendswap.com/
- License posture: assets are Creative Commons per item, including CC0, CC-BY, and noncommercial variants.
- Pipeline fit: variable. Clothing category exists, but each asset must be inspected individually. Reject NC assets for the automated runtime path.
- Allowlist decision: acceptable only for specific CC0 or compatible CC-BY garments with attribution/provenance support.

## Rejected/default-blocked for now

- BlenderKit hospital gown: promising shape, but not yet allowlisted because the page shown in search does not establish a simple CC0/permissive redistribution path for this project.
- Objaverse/Objaverse-XL: too heterogeneous. Use only with per-asset license extraction and allowlist, not as a blanket source.
- Research datasets such as CLOTH3D, DeepFashion3D, ClothesNet, CloSe-D: useful for research/tool ideas, but licensing/data-use terms are not simple enough for immediate runtime asset materialization.

## Next executable allowlist slice

1. Open MakeHuman Community `Shirts 03` or `Dress 01` asset-pack page.
2. Select one CC0 garment with clinical potential.
3. Create a concrete allowlist record using `docs/openclinxr/garment-source-allowlist-template-2026-05-27.json`.
4. Download/stage only if license/source/author/hash fields are complete.
5. Run `tools/openclinxr/garment-ingest-and-fit.mjs` through provider and promotion gates.
