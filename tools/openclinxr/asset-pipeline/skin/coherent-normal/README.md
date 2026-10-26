# Coherent procedural skin normal — portable producer

Stylized analytic pore detail. NOT a Blender bake, NOT mesh-surface pixels,
NOT measured skin pores, NOT photoreal. Mesh geometry normals are preserved
(no geometry edit, no macro bake); detail lives only in the added
tangent-space normal field (low-frequency orange-peel + sparse pits).

Tiling note (from peer consult, NOT implemented): decoupling micro-pore
repeat via `KHR_texture_transform` on normalTexture is viable future work
iff face/body crops pass bars simultaneously; current maps are 1:1 UV.

## Inputs (read-only; full SHA256)

Under `<repo>/apps/ui-xr/public/generated-humanoids/`:

- mpfb-family-partner-adult.glb 9e5f8718be7ca2336a784d645dfdb6908fdf9112fdf9e45cbd9d859b7093a387
- mpfb-gown-adult-patient.glb 27cbf4e5ed5a007ad497a3bafe2763ac72746583374ad1718d51573ba649aa66
- mpfb-ob-patient-aisha.glb 763214e8661554ef380a0905aba8edcd76b2045fdeaa6f0fcd48d20f94537a56
- mpfb-peds-patient-child.glb 1d907f05a948a1f11c30d3bc3a4032fb568a0df6c9a7e721e60f83c8df6994c3

Sidecar `<actor>.skin-normal.png` files are the retired bad maps (archived,
never read). Source GLBs are used for binding identity/UV slot only.

## 1. Bake (deterministic; deps: python3.13 / numpy2.5 / scipy1.18)

python3 bake_coherent_pore_normal.py --actor-short family \
  --actor-glb <repo>/apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb \
  --out-dir <out> [--seed 11]

Seeds default per actor: family 11, gown 22, ob 33, child 44. No map copy
between actors. Report records derivationMode/generator/renderRecipe,
seed/params, inputGlbFullSha, outputPngSha, bakeCodeSha, runtime
(python/numpy/scipy versions; explicit NO-BLENDER/NO-MESH-BAKE).

## 2. Bind (BEFORE-write exact-gate guard, explicit raise, -O safe)

python3 bind_skin_normal.py --src <repo>/apps/.../<actor>.glb \
  --new-normal <out>/normal.png --out <ready-final>/<actor>.glb \
  --expect-src-sha <full> --expect-png-sha <full> \
  --skin-sub <mpfb_skin_...> --old-sidecar <repo>/apps/.../<actor>.skin-normal.png \
  --prov-in <repo>/apps/.../<actor>.provenance.json \
  --prov-out <ready-final>/<actor>.provenance.json \
  --code-sha $(sha256sum bind_skin_normal.py | cut -d' ' -f1) \
  --recipe coherent-pore-v6-orangepeel-sparsepits-bandlimited \
  --bake-report <out>/bake.json [--trust-name-match]

Skin substrings: family mpfb_skin_ed_chest_pain_spouse_adult (+--trust-name-match),
gown mpfb_skin_robert_reference, ob mpfb_skin_ob_patient_aisha_v1,
child mpfb_skin_peds_patient_child. Stage records report.runtime /
derivationMode / generator verbatim; old provenance fields deep-identical
except appended stage + current receipt.

## 3. Tests

python3 tests/test_bind_unittest.py -v   # 17 retained binder-guard tests
python3 tests/test_procedural_truthfulness.py -v  # receipt honesty + history append-only
node --test the-coherent-normal-binds-and-replays.test.mjs
# The wrapper locates the repo from its own path (5 parents up) or by
# walking up to apps/ui-xr/public/generated-humanoids; detached lanes
# may export OPENCLINXR_REPO=<repo-root> instead. The third check reads
# the CURRENT repo actors (never a lane ready-final dir) and requires
# normalTexture scale>=1 on each mpfb_skin_* material.

## 4. Append mode (actors whose skin has NO normal and NO retired image)

python3 bind_skin_normal.py --src <actor>.glb --new-normal <map> ... \
  --append-new-image   # --old-sidecar omitted; replacement guard stays default
# Refuses when the skin is already bound or an unbound skin-normal image
# exists (use replacement mode). Appends one image + bufferView + texture;
# old buffers/geometry/materials untouched except skin.normalTexture.
# Stage records flow=append-new-image with oldNormalSha=null (never faked).

## 5. Reuse mode (verified unbound texture reuse)

python3 bind_skin_normal.py --src <actor>.glb --new-normal <map> ... \
  --reuse-unbound-normal-texture --expect-old-sha <full>
# Requires the embedded OLD normal bytes (verified by --expect-old-sha),
# EXACTLY ONE plain root texture sourcing the target image, zero textureInfo
# index users anywhere under materials/extensions (any dict with integer
# index resolving to target, regardless of extra keys), zero opaque root
# extensions, single exact bufferView parent (no accessor/sparse/extension
# alias), actual target mime image/png plus PNG header bytes, opaque-free
# image record, and --expect-old-sha supplied without reuse preflight-refuses.
# JSON references, single bufferView parent, opaque-free image record.
# Reuses the existing orphan texture index as skin normalTexture scale 1;
# replaces only target image bytes/offsets. No --old-sidecar, no append,
# no trust-name-match, no force/bypass. Refusals write nothing.

## 6. Coherent skin tangents (OPTIONAL, off by default)

python3 bind_skin_normal.py ... --reuse-unbound-normal-texture --expect-old-sha <sha> \
  --coherent-skin-tangents

Requires strict reuse mode. Computes indexed-UV vertex tangents + handedness
(Gram-Schmidt, three r184 computeTangents port in skin_tangents.py, stdlib only)
for exactly one skin-material primitive; refuses zero/multiple targets, existing
TANGENT, non-TRIANGLES mode, sparse/non-finite/unsigned-only index violations,
view-crossing offsets, and all-degenerate inputs. Default behavior unchanged
without the flag. Provenance records tangentDerivation (target/count/tangentSHA/
helper file SHA); no historical rewrite, no readiness claim. Append is staged:
append_skin_tangents validates mode/TANGENT/indices/bounds BEFORE any
mutation, then packs all rows and commits exactly one view + one accessor +
TANGENT attr. Refusals write nothing; default (no flag) adds no
tangentDerivation key.
