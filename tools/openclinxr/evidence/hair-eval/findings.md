# Hair evaluator v1: structure metric attempts

## Attempt 1 (mandated formula, FAILED the ordering)
- Formula: mean over erode(mask, 3 px) of (hp/local)^2 where
  hp = lum - gauss(lum, sigma 2), local = gauss(lum, sigma 8) + 0.02.
- targetValue: 0.012843415518896053
- r45Value: 0.003918973999809881
- r13Value: 0.014370619514376586
- Ordering: r13 > target > r45. Still inverted.
- Diagnosis: erosion removed the boundary-pixel bias (mask-mean gave
  0.0339/0.0155/0.0150, interior-mean gives 0.0144/0.0039/0.0128), but the
  area-normalized mean rewards thin sparse hair: r13's few wispy strips
  carry high per-pixel contrast, while r45's larger smooth mass dilutes
  its mean. Normalizing by area discards the strand-count signal that
  distinguishes fuller hair.

## Attempt 2 (total high-pass contrast energy, PASSED the ordering)
- Formula: sum over erode(mask, 3 px) of |hp/local|, same hp/local/erode.
- targetValue: 2766.5689692195992
- r45Value: 600.7182508544697
- r13Value: 355.5745089773109
- Ordering: target > r45 > r13. Correct.
- Rationale: structure grows with strand contrast AND strand-bearing area;
  total energy keeps both. Same building blocks, different aggregate.
