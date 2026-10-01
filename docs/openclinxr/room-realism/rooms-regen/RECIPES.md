# Room-chain recipe decisions

All fourteen mapped runtime rooms now have strictly validated recipes in `packages/openclinxr/factory-stations/src/room_chain/recipes.ts`. Seeds are the once-recorded source seeds from shipped provenance; fixed footprints preserve the source room’s measured floor dimensions instead of cloning the ward.

| Environment | Seed | Fixed footprint W × D × H (m) | One-line finish justification |
|---|---:|---:|---|
| `ed_exam_bay_v1` | 22 | 5.882 × 2.882 × 2.65 | Acute ED: cleanable 600 mm vinyl tile, integral cove, T-bar/troffer ceiling, vision-lite hospital door, bright ED lighting. |
| `pediatric_urgent_care_bay_v1` | 13 | 5.39 × 5.28 × 2.65 | Pediatric bay: the same cleanable clinical envelope with the calmer pediatric palette and clinic-day lighting. |
| `primary_care_clinic_room_v1` | 1 | 6.50 × 6.26 × 2.65 | Ambulatory exam room: vinyl tile/cove, acoustic grid with troffer, and a hospital-style vision-lite door. |
| `ed_stroke_bay_v1` | 2 | 6.89 × 6.77 × 2.65 | Stroke bay: acute-care washable finishes, high ambient task light, and a vision-lite clinical door. |
| `adult_ed_abdominal_bay_v1` | 0 | 6.25 × 6.25 × 2.65 | Adult ED bay: washable vinyl/cove, clinical ceiling grid and bright ED lighting. |
| `telehealth_home_visit_v1` | 14 | 9.50 × 6.38 × 2.65 | Home: maple-derived wood-plank floor, painted ceiling with no T-bar/troffer, baseboard, solid residential panel door and warm evening lighting. |
| `behavioral_health_private_room_v1` | 16 | 5.00 × 5.88 × 2.65 | Behavioral health: seamless sheet vinyl/cove, painted ceiling with no suspended or exposed fixture trim, and a solid panel door with lever and concealed-hinge/no-casing finish flags. |
| `oncology_consult_room_v1` | 17 | 5.50 × 5.26 × 2.65 | Consult room: clinical cleanability retained, softened with the evening-calm palette and lower-energy warm lighting. |
| `urgent_care_clinic_room_v1` | 22 | 7.50 × 8.00 × 2.65 | Urgent care: durable vinyl/cove, T-bar/troffer ceiling and vision-lite clinical door. |
| `surgical_ward_room_v1` | 25 | 7.40 × 7.40 × 2.65 | Surgical ward: ward finish plus a kick plate for a high-traffic inpatient door. |
| `stepdown_room_v1` | 205 | 6.20 × 3.25 × 2.60 | Existing measured ward finish retained, including transom infill and kick plate. |
| `ob_triage_room_v1` | 27 | 6.00 × 4.80 × 2.65 | OB triage: clinical washable surfaces with a softer calm palette and clinic-day light. |
| `inpatient_ward_room_v1` | 205 | 4.30 × 3.90 × 2.40 | Existing measured ward finish retained as the established room-chain control. |
| `pediatric_fever_urgent_care_bay_v1` | 34 | 6.50 × 6.50 × 2.65 | Pediatric urgent care: cleanable clinical envelope with calmer pediatric color treatment. |

Behavioral-health solid-door question for coordinator review: the recipe deliberately omits a vision lite to follow the dispatched “solid-door” direction, but observation requirements, egress code, anti-barricade hardware and the exact ligature-resistant hinge/lever product remain a facilities/code decision; the generated panel/lever is visual evidence only and not a safety certification.

The residential additions are intentionally minimal and recipe-driven: `floor.kind=wood-plank`, `ceiling.kind=painted`, `door.kind=residential`, and `cove.kind=baseboard`. Existing recipes that omit the new cove/ceiling `kind` fields continue to validate with their former clinical defaults.
