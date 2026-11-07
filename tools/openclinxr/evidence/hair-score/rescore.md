# Canonical hair rescore

All cells use `score.py`: 1024 px, 64 beauty samples, shared holdout ID pass, fixed absolute camera transforms, judge v6, and `hair-curtain3/landmarks.json`.

| cell | IoU f / p / b | p50 front / 3q / profile / back | part/side honest | BARE tiles 0-10 / 10-20 / 20-30 / 30-50 |
|---|---:|---:|---:|---:|
| hair-top1 t1 + hair-look5 BEST | 0.686926 / 0.681517 / 0.783962 | 0.076409 / 0.108064 / 0.130209 / 0.111435 | 0.905900 | 0.7213% / 2.0027% / 0.0342% / 0.0063% |
| hair-real1 a1 + hair-look5 BEST | 0.688319 / 0.681019 / 0.781859 | 0.075858 / 0.107781 / 0.130209 / 0.110602 | 0.946884 | 0.5985% / 1.7327% / 0.0456% / 0.0125% |
| hair-int1 i1 + hair-int1 material | 0.682461 / 0.680534 / 0.782669 | 0.077757 / 0.111435 / 0.134645 / 0.115357 | 1.033052 | 1.6268% / 1.6202% / 0.0228% / 0.0626% |

BARE means crown-top ID alpha `<30`; PARTIAL (`30<=alpha<230`) is retained in `rescore.json` and each `score.json`.
