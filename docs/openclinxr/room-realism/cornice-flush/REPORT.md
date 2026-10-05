# Flush cornice material comparison

Selected **tile** for both ward and step-down: `finish.ceiling.corniceProfile: "flush"`, `corniceMaterial: "tile"`, width 24 mm. The entire trim assembly, including its thin edge closure, shares the existing ceiling-tile PBR material and world-XY UV mapping. No emissive wall material remains on the selected trim. Its underside stays exactly coplanar with the tile face; the tile field is inset 24 mm and the wall-side angle edge remains 3 mm.

The historical `cornice-ab` directory is restored byte-for-byte to `8408b14f1`, including all eight original crops. Historical step-down and floor-cast evidence is also restored. Every new capture, crop, sheet, measurement, and promotion pin lives here. The wall control is the exact PNG evidence from `7bc757730`, relocated with corrected manifest image paths; tile and T-bar are fresh learner-runtime captures using the same poses and boxes.

## Selection against the coordinator's reference targets

Rec.709 luminance points on encoded RGB; negative junction-minus-wall means darker than the adjacent wall. Selection minimizes mean absolute error over ward poses 01/02 against the supplied reference targets **−12/−5**. These targets are recorded separately from remeasuring the visual-reference JPEG in the unchanged runtime boxes: that JPEG has different composition, so those measurements are not substituted for the coordinator's targets.

| Material | Ward 01 junction − wall | Error vs −12 | Ward 02 junction − wall | Error vs −5 | Mean absolute error |
|---|---:|---:|---:|---:|---:|
| Wall control | +3.42 | +15.42 | +5.94 | +10.94 | 13.18 |
| Tile | −12.67 | −0.67 | −9.52 | −4.52 | **2.59** |
| T-bar | −5.68 | +6.32 | −2.57 | +2.43 | 4.38 |

Tile is closest, not an exact reference match: pose 02 is still 4.52 points darker than the supplied target.

## All poses and the ceiling comparison

Each triple below is **wall / tile / T-bar**. The original junction rectangle is unchanged. For trim-only measurements, one fixed mask per pose isolates pixels changed by more than two RGB levels between the three materials within that rectangle, and is reused for all arms. Adjacent ceiling tiles are sampled 8–18 pixels above the rectangle; exact boxes, mask method, counts, hashes, and visual-reference deltas are in `measurements.json`.

| Room / pose | Junction − wall | Trim pixels − adjacent ceiling |
|---|---|---|
| Ward 01 | +3.42 / −12.67 / −5.68 | +46.81 / +19.90 / +31.59 |
| Ward 02 | +5.94 / −9.52 / −2.57 | +40.38 / +13.92 / +25.82 |
| Ward 03 | +13.66 / −7.65 / +1.56 | +46.24 / +17.80 / +30.11 |
| Ward 05 | −1.73 / −12.74 / −7.63 | +44.95 / +19.96 / +31.56 |
| Step-down 01 | −12.40 / −20.59 / −16.82 | +44.36 / +20.47 / +31.46 |
| Step-down 02 | −10.95 / −16.51 / −13.87 | +30.99 / +8.38 / +19.11 |
| Step-down 04 | +29.69 / +3.83 / +15.68 | +56.27 / +30.40 / +42.26 |
| Step-down 05 | −4.58 / −14.61 / −9.91 | +44.90 / +23.30 / +33.43 |

All 24 material/pose combinations have **zero seam-run gap pixels** and **0.0000 mean absolute channel difference** between repeat captures. The existing gap rule is unchanged: luminance below wall mean minus 40 in horizontal runs of at least five pixels. Raw below-threshold texture specks are retained in the JSON, not silently counted as zero. Adjacent-wall means are unchanged from V2. Decoded budgets are 49.2983 MiB (ward) and 49.3399 MiB (step-down), below 56 MiB.

Ward sheets and 4× nearest-neighbour crop sheets contain **V2 | V4-flush-wall | V4-flush-tile | V4-flush-tbar | v2 visual reference**. Step-down has the same four runtime arms; there is no matching step-down visual-reference set.

## Promotion and reproduction

Both rooms were re-promoted through `factory:room:promote`; their six derived pose pins and decoded budgets are under their respective directories. The promotion wrapper refuses a recipe that differs from the measured winner or shipped bytes that differ from the measured candidate. The supine runtime freeze was re-derived after both promotions. The new step-down door measurements retain the existing infill and kick-plate gates without overwriting earlier evidence.

- Ward SHA-256: `8816c56eceafd02398077b623975d8948c09549fd9d43bce489040c8c58d42ea`.
- Step-down SHA-256: `4c459f7f2f2953019e397e324416ff78f973a139e12ac86669681cb6622f70f2`.
- Build: `pnpm exec tsx tools/openclinxr/evidence/room-chain-wiring/cornice-flush-build.ts`.
- Capture: `pnpm exec tsx tools/openclinxr/evidence/room-chain-wiring/cornice-flush-capture.ts`.
- Measure/sheets: `python3 tools/openclinxr/evidence/room-chain-wiring/cornice-flush-evidence.py`.
- Promote/pins: `pnpm exec tsx tools/openclinxr/evidence/room-chain-wiring/cornice-flush-promote.ts`.

These captures are not Quest-headset readiness or clinical-validity evidence.
