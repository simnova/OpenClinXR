RESULT::st-vitdark r1
VERDICT::go

UPSTREAM::`WithinAmnesia/Vitruvian-Project` commit `c036e5376108dc44065beb0a3f4ef8eac463e039`
LICENSE::`LICENSE` at that commit, CC0-1.0 Universal
LIGHT::`Vitruvian Project/Textures/4K/Vitruvian_Face_BaseColor_Utility - Linear - sRGB.exr` / SHA256 `e28f1154c88bd4eb08bfb25ba2a7e8892b486877bf69b8fdd8f4af1cbacb87a4`
AFRICAN::`Vitruvian Project/Textures/4K/Vitruvian_African_Face_BaseColor.exr` / SHA256 `20d9c249b66c32dc6327e1fa6682b47a9ff4efc58a2f1c9ad2c7a054d8b4bfa6`
MOUTH::not fetched; the inspected 1024 px Face previews contain the full lip vermilion. Upstream has a light Mouth BaseColor but no African Mouth BaseColor.

METHOD::fixed same-map boxes from `patches.json`; scene-linear EXR RGB; D65 Lab and CIEDE2000 imported from the existing `tone-check.py`; cheek multiplier `k_RGB=(0.111948, 0.084793, 0.068996)`.
NOISE::African-cheek patch-to-own-mean CIEDE2000 sample SD `0.400671`; floor `2×SD=0.801341`.

| Region | CIEDE2000 predicted→African | Floor | Margin |
|---|---:|---:|---:|
| forehead | 2.483269 | 0.801341 | +1.681928 |
| cheek | 0.000000 | 0.801341 | -0.801341 |
| lip | 5.079108 | 0.801341 | +4.277767 |
| ear | 4.025808 | 0.801341 | +3.224466 |
| nose | 3.375779 | 0.801341 | +2.574437 |

| Region | Map | region−forehead a* | region−forehead b* |
|---|---|---:|---:|
| lip | light | 13.370464 | -5.338883 |
| lip | African | 0.875432 | -6.027201 |
| lip | predicted | 5.159900 | -2.921531 |
| ear | light | 4.748234 | 0.442886 |
| ear | African | 1.796750 | -2.049577 |
| ear | predicted | 1.974481 | -0.066285 |

G1::lip residual margin `+4.277767`; predicted-vs-African separation differences are `a*=4.284468 > 2×SD 3.787422` and `b*=3.105670 > 2×SD 0.871542`. Ear residual margin `+3.224466`; `b*=1.983292 > 2×SD 0.914254` (`a*` does not pass). Both candidates independently pass.

G2::foreground-control rule records “similar” as forehead margin ≥75% of the strongest passing lip/ear margin. Actual forehead ratio is `0.393179`; therefore the global-offset counterweight does not fire. The nose control margin is `+2.574437` and is retained in the table.

G3::light-as-both-inputs substitution produced `k=(1,1,1)`, CIEDE2000 `0.000000` in every region, and `VERDICT::kill`; see `probes.md`.

DECISION::the African Face BaseColor contains lip and ear chroma structure that a single cheek RGB multiply does not reproduce; run the remap slice.

NOT TESTED::rendered appearance on a Vitruvian mesh; alternate patch placements; dynamic blush/pallor; headset/WebXR appearance; any GLB or atlas output.
