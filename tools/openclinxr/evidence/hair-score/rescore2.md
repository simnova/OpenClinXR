# Canonical hair rescore v2 (orientation + bands)

All cells use `score.py` (schema openclinxr.hair-score.v2): 1024 px, 64 beauty samples, shared holdout ID pass, fixed absolute camera transforms, judge v6, hair-curtain3/landmarks.json; orientation via 180-orientation Gabor bank with judge-v6 registration; bands vs the same target crops.

| cell | IoU f / p / b | orient err f / 3q / p / b (deg) | hist EMD f / 3q / p / b (deg) | bands back ours vs TS (count) | bands ear ours vs TS (count) |
|---|---|---|---|---|---|
| hair-top1 t1 + hair-look5 BEST | 0.686926 / 0.681517 / 0.783962 | 27.29 / 33.38 / 31.67 / 24.56 | 4.53 / 6.84 / 29.24 / 9.42 | 373 vs 849 | 125 vs 89 |
| hair-real1 a1 + hair-look5 BEST | 0.688319 / 0.681019 / 0.781859 | 27.24 / 33.67 / 31.91 / 24.50 | 4.19 / 7.35 / 29.28 / 9.37 | 372 vs 849 | 133 vs 89 |
