# Humanoid Texture Budget (2026-09-12)

Subject: all 17 GLBs in `apps/ui-xr/public/generated-humanoids/` (excluding inspection-only
`mpfb-viseme-inspect.glb` and `mpfb-gown-inspect.glb`). Read from GLB JSON chunks.

## Population summary

| Body | GLB (MB) | Tris | Texture (MB) | Images | Largest image | Largest % |
|---|---|---|---|---|---|---|
| adult_male_street_casual | 9.02 | 43,054 | 0.20 | 1 | openclinxr_skin_micro_normal | 100% |
| ed_chest_pain_adult_cast | 7.00 | 32,208 | 0.20 | 1 | openclinxr_skin_micro_normal | 100% |
| ed_chest_pain_nurse_adult | 7.46 | 34,572 | 0.20 | 1 | openclinxr_skin_micro_normal | 100% |
| ed_chest_pain_spouse_adult | 8.04 | 38,828 | 0.21 | 1 | openclinxr_skin_micro_normal | 100% |
| mpfb-clinical-nurse-adult | 8.40 | 38,958 | 4.02 | 4 | MJ-shoes3 | 35.3% |
| mpfb-clinical-physician-adult | 9.46 | 41,718 | 4.37 | 5 | MJ-shoes3 | 32.4% |
| mpfb-family-partner-adult | 10.41 | 39,974 | 6.11 | 6 | jeanstex1 | 26.0% |
| mpfb-gown-adult-patient | 18.58 | 64,140 | 4.33 | 5 | MJ-shoes3 | 32.8% |
| **mpfb-ob-patient-aisha** | **13.93** | **69,093** | **9.57** | **6** | **tightjeans** | **56.9%** |
| mpfb-peds-nurse-kevin | 7.51 | 68,100 | 3.40 | 5 | skin-normal | 31.3% |
| **mpfb-peds-parent-aisha** | **14.02** | **68,898** | **9.59** | **6** | **tightjeans** | **56.7%** |
| mpfb-peds-patient-child | 11.36 | 77,422 | 4.45 | 5 | MJ-shoes3 | 31.9% |
| mpfb-street-adult-male | 15.72 | 115,552 | 5.23 | 6 | jeanstex1 | 30.4% |
| peds_anxious_parent | 8.00 | 38,931 | 0.21 | 1 | openclinxr_skin_micro_normal | 100% |
| peds_fever_patient_child | 6.47 | 31,736 | 0.23 | 1 | openclinxr_skin_micro_normal | 100% |
| peds_nurse_kevin | 7.56 | 35,099 | 0.20 | 1 | openclinxr_skin_micro_normal | 100% |
| peds_patient_child | 6.37 | 31,468 | 0.21 | 1 | openclinxr_skin_micro_normal | 100% |

Eight bodies carry a single texture image (all `openclinxr_skin_micro_normal`, ~198–226 KB).
Nine bodies carry multi-image texture sets (4–6 images each).

## Per-body detail (multi-image bodies only)

### mpfb-ob-patient-aisha (the punkduck tightjeans body)

| Image | Bytes | % of body |
|---|---|---|
| tightjeans | 5,441,511 | 56.9% |
| MJ-shoes3 | 1,418,657 | 14.8% |
| skin-normal | 1,081,018 | 11.3% |
| skin-baked | 625,252 | 6.5% |
| brown_eye | 610,817 | 6.4% |
| T-shirt_basic.png | 392,852 | 4.1% |

### mpfb-peds-parent-aisha (same tightjeans texture)

| Image | Bytes | % of body |
|---|---|---|
| tightjeans | 5,441,511 | 56.7% |
| MJ-shoes3 | 1,418,657 | 14.8% |
| skin-normal | 1,092,180 | 11.4% |
| skin-baked | 634,799 | 6.6% |
| brown_eye | 610,817 | 6.4% |
| T-shirt_basic.png | 396,924 | 4.1% |

### mpfb-family-partner-adult

| Image | Bytes | % of body |
|---|---|---|
| jeanstex1 | 1,589,579 | 26.0% |
| MJ-shoes3 | 1,418,657 | 23.2% |
| skin-normal | 1,091,596 | 17.9% |
| skin-baked | 687,440 | 11.3% |
| green_eye | 662,241 | 10.8% |
| T-shirt_basic.png | 656,736 | 10.8% |

### mpfb-street-adult-male

| Image | Bytes | % of body |
|---|---|---|
| jeanstex1 | 1,589,579 | 30.4% |
| skin-normal | 1,066,447 | 20.4% |
| skin-baked | 842,869 | 16.1% |
| T-shirt_basic.png | 656,736 | 12.6% |
| brown_eye | 610,817 | 11.7% |
| boot | 461,286 | 8.8% |

### mpfb-clinical-nurse-adult

| Image | Bytes | % of body |
|---|---|---|
| MJ-shoes3 | 1,418,657 | 35.3% |
| skin-normal | 1,071,173 | 26.7% |
| skin-baked | 860,888 | 21.4% |
| blue_eye | 666,029 | 16.6% |

### mpfb-clinical-physician-adult

| Image | Bytes | % of body |
|---|---|---|
| MJ-shoes3 | 1,418,657 | 32.4% |
| skin-normal | 1,075,699 | 24.6% |
| skin-baked | 830,955 | 19.0% |
| brown_eye | 610,817 | 14.0% |
| Scrubs_BaseColor | 437,089 | 10.0% |

### mpfb-gown-adult-patient

| Image | Bytes | % of body |
|---|---|---|
| MJ-shoes3 | 1,418,657 | 32.8% |
| gown-skin-normal | 1,063,690 | 24.6% |
| gown-skin-baked | 845,321 | 19.5% |
| brown_eye | 610,817 | 14.1% |
| T-shirt_basic | 392,852 | 9.1% |

### mpfb-peds-nurse-kevin

| Image | Bytes | % of body |
|---|---|---|
| skin-normal | 1,066,450 | 31.3% |
| skin-baked | 829,133 | 24.4% |
| brown_eye | 610,817 | 17.9% |
| boot | 461,286 | 13.5% |
| Scrubs_BaseColor | 437,089 | 12.8% |

### mpfb-peds-patient-child

| Image | Bytes | % of body |
|---|---|---|
| MJ-shoes3 | 1,418,657 | 31.9% |
| skin-normal | 1,164,112 | 26.1% |
| skin-baked | 814,450 | 18.3% |
| green_eye | 662,241 | 14.9% |
| T-shirt_basic.png | 394,051 | 8.8% |

## Outlier verdict: tightjeans is an extreme outlier

Across 9 multi-image bodies, the max/median image-size ratio per body:

| Body | Median image (B) | Max image (B) | Max/Median |
|---|---|---|---|
| mpfb-ob-patient-aisha | 853,135 | 5,441,511 (tightjeans) | **6.38x** |
| mpfb-peds-parent-aisha | 863,490 | 5,441,511 (tightjeans) | **6.30x** |
| mpfb-street-adult-male | 749,803 | 1,589,579 (jeanstex1) | 2.12x |
| mpfb-family-partner-adult | 889,518 | 1,589,579 (jeanstex1) | 1.79x |
| mpfb-peds-nurse-kevin | 610,817 | 1,066,450 (skin-normal) | 1.75x |
| mpfb-peds-patient-child | 814,450 | 1,418,657 (MJ-shoes3) | 1.74x |
| mpfb-clinical-physician-adult | 830,955 | 1,418,657 (MJ-shoes3) | 1.71x |
| mpfb-gown-adult-patient | 845,321 | 1,418,657 (MJ-shoes3) | 1.68x |
| mpfb-clinical-nurse-adult | 966,031 | 1,418,657 (MJ-shoes3) | 1.47x |

The non-aisha population ceiling is 2.12x (jeanstex1 on street male). The aisha bodies
with tightjeans are at 6.3x — roughly **3x above the population ceiling**.

tightjeans is 5,441,511 bytes (5.44 MB), the single largest garment diffuse in the fleet.
It is 3.8x the next largest image (jeanstex1 at 1.59 MB) and 57% of its body's total
texture. The same map ships on two actors.

## Gate threshold derivation

The test asserts: for each multi-image body, no single image exceeds `THRESHOLD_MULTIPLE`
times that body's median image size.

Threshold = 3.0x the body's median.

Derived from the measured population: non-aisha max/median ceiling is 2.12x; 3.0x is
~1.4x above that ceiling with room for normal variation. This catches tightjeans at
6.3x with clear margin and passes every other body in the fleet.

Population proof the gate bites:
- mpfb-ob-patient-aisha: max 5,441,511 / median 853,135 = 6.38x > 3.0x → **FAIL**
- mpfb-peds-parent-aisha: max 5,441,511 / median 863,490 = 6.30x > 3.0x → **FAIL**
- All 7 other multi-image bodies: max/median < 2.12x < 3.0x → PASS

## Factory step

`clothing_consume` — the mhclo garment pipeline delivered a 5.44 MB diffuse that
dwarfs every other image on its bodies. The gate lives in the consume verification
to catch the next one.

## Counterweights observed

- Geometry unchanged: 69,093 / 68,898 tris for aisha bodies match the fp-r0.4 baseline.
- MJ-shoes3 (1.42 MB) is the second-most-repeated large texture (7 bodies) but is
  consistently 23–35% of body texture — proportionate, not an outlier.
- jeanstex1 (1.59 MB) on street/family is 26–30% of body texture — proportionate.
- Tightjeans is a CC BY 3.0 asset correctly fitted; the gate does not re-open fitting.
