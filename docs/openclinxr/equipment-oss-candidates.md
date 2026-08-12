# Equipment OSS / free-asset candidates (staging)

**Authority:** subordinate to MADR 0049 (licence) + 0054/0055 (lanes/catalogue).  
**Status:** research staging 2026-08-12 — **do not acquire** until a row lands in
`third-party-asset-licence-ledger.md` with VERIFIED licence text on the source page/API.  
**Researcher:** curious-researcher pass (session 2026-08-12); INFERRED rows need licence-tab re-read.

## Rules (repeat)

- CC0 or CC-BY only; **unspecified = refuse**; BY-SA / BY-NC = refuse
- Equipment is **lane 1 (bank)** when acquired; catalogue row required
- Prefer low-poly / game-ready mid-band (not photoreal medical CAD)
- CC-BY: attribution string must survive into shipped builds (#193)

## Priority gaps (from catalogue)

| Need | Why |
|------|-----|
| Hospital bed / post-op bed | Deck SSOT; currently thin parametric boxes |
| Stretcher / pediatric stretcher | High learner visibility |
| IV pole / pump | Partial GLB (`iv-pole-with-pump`) — may need cleaner mid-band |
| Medication cart / crash cart | Prose unmapped or kit-only ECG |
| Exam table | Clinic / primary-care stations |
| Privacy curtain / vitals monitor | Unmapped prose on OB/clinic/psych |

## VERIFIED candidates (licence read from API/page)

| asset | URL | licence | approx tris | subject | usable? | attribution |
|-------|-----|---------|-------------|---------|---------|-------------|
| IV Stand (teeart) | https://sketchfab.com/3d-models/iv-stand-dd3115aafb0e4a628f261d0de7a787b9 | CC BY 4.0 | 5,084 | IV pole | **Yes** | `IV Stand by teeart (Sketchfab, CC BY 4.0)` |
| Hospital Bed (Matt LeMoine) | https://sketchfab.com/3d-models/hospital-bed-9cd9464990d2456e98b69978447852aa | CC BY 4.0 | 3,058 | Hospital bed | **Yes** — top priority | `Hospital Bed by Matt LeMoine (Sketchfab, CC BY 4.0)` |
| Operating Table (shashkinv1ad) | https://sketchfab.com/3d-models/operating-table-e3a4512227d34b098e2ef0d11c8a80fd | CC BY 4.0 | 46,400 | OR table | Marginal — decimate | `Operating Table by shashkinv1ad (Sketchfab, CC BY 4.0)` |
| C-Arm Neurosurgery Table (INGSOC1984) | https://sketchfab.com/3d-models/c-arm-neurosurgery-operating-table-f92ebb77ec8249f8bb53cb9f256f55cc | CC BY 4.0 | 9,230 | Surgical table | Yes mid-band | `C Arm Neurosurgery Operating Table by INGSOC1984 (Sketchfab, CC BY 4.0)` |
| The Medical Bag (ezgi bakim) | https://sketchfab.com/3d-models/the-medical-bag-7ff695d5041640b9a6aedb88016af31e | CC BY 4.0 | 1,870 | Med bag | Yes | `The Medical Bag by ezgi bakim (Sketchfab, CC BY 4.0)` |
| Medical Stand (sc8di) | https://sketchfab.com/3d-models/medical-stand-2c22707879b04b89b9d68bd5e94fda51 | CC BY 4.0 | 171,516 | Stand | **No** — too heavy | n/a |
| Wheelchair 01 (Poly Haven) | https://polyhaven.com/a/wheelchair_01 | **CC0** | ~40K claimed | Wheelchair | Marginal — decimate | none |
| Wheelchair (Poly by Google) | https://poly.pizza/m/0gb5yuNcwbg | CC BY 3.0 | low-poly | Wheelchair | Yes GLB | `Wheelchair by Poly by Google (CC BY 3.0)` |
| Crutches (Poly by Google) | https://poly.pizza/m/2V9ccKGCo-r | CC BY 3.0 | low-poly | Crutches | Yes | `Crutches by Poly by Google (CC BY 3.0)` |
| Health pack (Quaternius) | https://poly.pizza/m/cc9Kueieyl | **CC0** | low-poly | First-aid props | Yes (props only) | none |
| Health pack (CircuitZ) | https://poly.pizza/m/cJdIysIdbC | **CC0** | low-poly | Health props | Yes | none |
| GRADD Hospital Room | https://poly.pizza/m/9sUalfQ76kn | CC BY 3.0 | scene | Room kit | Staging ref | `GRADD Hospital Room by GRADD CO (CC BY 3.0)` |

## INFERRED (re-read licence tab before acquire)

| asset | URL | licence claimed | approx tris | subject | usable? |
|-------|-----|-----------------|-------------|---------|---------|
| Emergency Cart (tutminchai) | https://sketchfab.com/3d-models/emergency-cart-7b6c0aa0f213416bbd65efbaa2d26391 | CC BY 4.0 | ~412K | Crash cart | Marginal — decimate hard |
| Medical Monitor (brodys_arts) | https://sketchfab.com/3d-models/medical-monitor-84aa2c97829b4557bc077e8006d97e58 | CC BY 4.0 | ~4.9K | Monitor | Yes |
| Bed Curtain + Vital Signs Monitor (Ethan Cragun) | https://sketchfab.com/3d-models/bed-curtain-and-vital-signs-monitor-295ed50eeaa249e8bbeed7b305d3da71 | CC BY 4.0 | ~8.8K | Monitor + curtain (VR med sim) | Yes |
| Hospital Stretcher Trolley (UsmanAzhar2256) | https://sketchfab.com/3d-models/hospital-stretcher-trolley-edfeb93b201b4c8da2c7a4fb5dea090c | CC BY 4.0 | ~2.2K | Stretcher | Yes |
| Exam Table (orphic_oasis8) | https://sketchfab.com/3d-models/exam-table-459c00d5a0524c67a4ad2fa5c6eacb15 | CC BY 4.0 | ~7.9K | Exam table | Yes |
| Gurney medevac (dudecon) | https://sketchfab.com/3d-models/gurney-medevac-patient-stretcher-rescue-litter-40c85d5457a144d3b5dc1b328a2425a3 | CC BY 4.0 | ~1.5K | Stretcher + baked patient | Caveat |
| Small Hospital Bed (qubodup) | https://opengameart.org/content/small-hospital-bed | CC BY 3.0 | 540 | Bed | Yes cheapest |

## REFUSE (do not re-litigate without new evidence)

| asset | URL | why |
|-------|-----|-----|
| Medical Monitor (pistonstone) | https://sketchfab.com/3d-models/medical-monitor-8d9b3789c39b4c789cb9e4b45bc6aa3a | API: `license: null`, not downloadable — search said free |
| Medical Cart (yazzywazzy) | https://sketchfab.com/3d-models/medical-cart-d5e03bd688394269be0ad02b8f9aae62 | CC BY-SA (ShareAlike not allowed) |
| Patient Monitor (Guardiano) | https://sketchfab.com/3d-models/patient-monitor-ce4b4459e9fa4713b56d1385997aac5b | CC BY-NC |

## Structural finding

**CC0 shortage for clinical furniture is structural:** Poly Haven/Kenney/Quaternius do not ship ward beds / IV poles / crash carts. Realistic external path is **CC-BY + attribution** (same posture as scrub-shirt garment row), or stay procedural (lane 2).

## Recommended first acquisitions (after licence-tab re-verify)

1. **Hospital Bed (Matt LeMoine)** → `hospital_bed_equipment` bank GLB (lane 1)
2. **Hospital Stretcher Trolley (UsmanAzhar2256)** → `stretcher_equipment` (after INFERRED re-verify)
3. **Exam Table (orphic_oasis8)** → `exam_table_equipment` (after re-verify)
4. Keep **ECG crash cart** on modular kit / procedural unless crash-cart decimation is worth a dedicated slice

## claimScope / notEvidenceFor

claimScope: licence-aware equipment library staging for three-lane factory.  
notEvidenceFor: clinical accuracy, Quest readiness, automatic download rights without operator policy on CC-BY volume.
