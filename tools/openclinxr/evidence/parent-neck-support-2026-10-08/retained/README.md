# Parent front-neck support repair

This is a bounded repair of the active parent motion-bind asset, from SHA256 `1c94d737877d9cc2a9fb1e9fe9d1b7a7f49702ec0129d630c420140bf0597333` to `c2192d06115c940d17dee6614b6d23128806c54b340cea1a7a4f99a091e48d0e`.

The owner-reviewed support recipe restores 124 exposed triangles and keeps 2,758 affected triangles masked under clothing. It fills 7,453 connected contaminated atlas texels from neighboring original skin. Original geometry attributes, rig, morphs, normals, teeth, clips and the original 11,942,584 binary bytes are preserved. The two added material primitives reuse existing attributes and morphs; appended indices use UINT32. Actual loader skin-weight rounding is at most `2.98e-8`; sampled skinned world-position differences are at most `1.04e-8 m`.

The four native images are retained source/candidate captures bound to those same hashes. They were not recaptured or restamped for adoption. Independent visual acceptance covers this asset's front and three-quarter views. Original faceted shading remains unchanged. This is not evidence for all poses, back-neck continuity, other garments, other actors, improved skin realism or automatic factory prevention.

To reproduce, recover the historical original source with `git show cd355b723625e250fac96cbf841b4e7913152e3b:apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb`, then run:

```text
mise exec -- python3 tools/openclinxr/asset-pipeline/skin/repair_exposed_skin_support.py ORIGINAL.glb tools/openclinxr/evidence/parent-neck-support-2026-10-08/support-recipe.json NEW-IMMUTABLE-OUTPUT-DIR
```

Already-repaired input and existing output directories are refused. The frozen recipe identifies specific source triangles; it is not a general anatomical policy. The helper's raw receipt is supplemented with the current helper's SHA256 in `report.json`, which the protected validator checks against the actual file.

The protected validator, tests, recipe and verifier are owner-planted. Tests replay the actual helper and reject incorrect source, overwrite, polluted reference rings, alteration of isolated dark marks and forged report hashes. Automated post-bind repair remains unresolved. The original historical retarget report is unchanged; this material/index repair has a separate receipt.
