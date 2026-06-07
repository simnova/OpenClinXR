# OpenClinXR GLB Optimization Cagematch

Generated: 2026-06-07T01:32:33.545Z

Claim boundary: local browser benchmark only. Not evidence for Quest, production, learner, clinical, scoring, or B+ readiness.

## Samples

| Sample | Category | Source | Notes |
| --- | --- | --- | --- |
| peds_patient_child_animated | animated_humanoid | `apps/ui-xr/public/generated-humanoids/peds_patient_child.glb` | Large generated pediatric patient with skin, morph targets, and procedural role animations. |
| adult_standard_humanoid | medium_humanoid | `apps/ui-xr/public/xr-assets/humanoids/variants/adult-standard-generated-human.glb` | Medium generated humanoid variant for baseline body/runtime delivery. |
| ecg_cart_prop | equipment_prop | `apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart-12-lead.glb` | Small multi-mesh clinical prop. |
| pediatric_bay_environment | environment | `apps/ui-xr/dist/xr-assets/environment/pediatric_urgent_care_bay_environment.glb` | Environment shell from built UI-XR assets; copied for benchmark only. |

## Results

| Sample | Variant | Family | Original | Optimized | Smaller | Browser load | Draw calls | Triangles | Avg frame | Review usable | Blockers |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| peds_patient_child_animated | original_copy | combination | 33.31 MB | 33.31 MB | 0% | 76.9ms | 6 | 54840 | 0.16ms | no | baseline_not_an_optimization_candidate, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltf_transform_meshopt | gltf-transform | 33.31 MB | 2.32 MB | 93% | 27.8ms | 6 | 54840 | 0.12ms | no | browser_visual_visibility_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltf_transform_draco | gltf-transform | 33.31 MB | 30.8 MB | 8% | 94.7ms | 6 | 54840 | 0.11ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltf_transform_webp | gltf-transform | 33.31 MB | 2.32 MB | 93% | 25.2ms | 6 | 54840 | 0.1ms | no | browser_visual_visibility_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltf_transform_ktx2 | gltf-transform | 33.31 MB | failed | - | failed | - | - | - | no | optimizer_command_failed, optimized_glb_metrics_unavailable, size_reduction_below_2_percent, browser_load_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltfpack_cc | gltfpack | 33.31 MB | 2.13 MB | 94% | 23ms | 6 | 54840 | 0.1ms | no | browser_visual_visibility_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltfpack_cc_tc_si | gltfpack | 33.31 MB | 2.13 MB | 94% | 22.9ms | 6 | 54584 | 0.13ms | no | browser_visual_visibility_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | blender_decimate_draco | blender | 33.31 MB | 30.9 MB | 7% | 95.4ms | 6 | 54840 | 0.08ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| peds_patient_child_animated | gltfpack_then_gltf_transform | combination | 33.31 MB | 10.34 MB | 69% | 40.3ms | 6 | 54840 | 0.08ms | no | browser_visual_visibility_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | original_copy | combination | 5.34 MB | 5.34 MB | 0% | 29.2ms | 22 | 29500 | 0.09ms | no | baseline_not_an_optimization_candidate, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltf_transform_meshopt | gltf-transform | 5.34 MB | 625.55 KB | 89% | 25ms | 4 | 29500 | 0.03ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltf_transform_draco | gltf-transform | 5.34 MB | 3.06 MB | 43% | 22.9ms | 4 | 29500 | 0.03ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltf_transform_webp | gltf-transform | 5.34 MB | 625.55 KB | 89% | 15ms | 4 | 29500 | 0.04ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltf_transform_ktx2 | gltf-transform | 5.34 MB | failed | - | failed | - | - | - | no | optimizer_command_failed, optimized_glb_metrics_unavailable, size_reduction_below_2_percent, browser_load_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltfpack_cc | gltfpack | 5.34 MB | 519.19 KB | 91% | 11.7ms | 22 | 29500 | 0.08ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltfpack_cc_tc_si | gltfpack | 5.34 MB | 507.35 KB | 91% | 12.7ms | 20 | 28366 | 0.07ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | blender_decimate_draco | blender | 5.34 MB | 2.04 MB | 62% | 26.7ms | 22 | 28505 | 0.07ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| adult_standard_humanoid | gltfpack_then_gltf_transform | combination | 5.34 MB | 2.31 MB | 57% | 16.9ms | 4 | 29500 | 0.04ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | original_copy | combination | 22.45 KB | 22.45 KB | 0% | 2.4ms | 8 | 288 | 0.02ms | no | baseline_not_an_optimization_candidate, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltf_transform_meshopt | gltf-transform | 22.45 KB | 4.45 KB | 80% | 4.8ms | 1 | 288 | 0ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltf_transform_draco | gltf-transform | 22.45 KB | 2.22 KB | 90% | 3.1ms | 1 | 288 | 0ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltf_transform_webp | gltf-transform | 22.45 KB | 4.45 KB | 80% | 2.4ms | 1 | 288 | 0ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltf_transform_ktx2 | gltf-transform | 22.45 KB | failed | - | failed | - | - | - | no | optimizer_command_failed, optimized_glb_metrics_unavailable, size_reduction_below_2_percent, browser_load_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltfpack_cc | gltfpack | 22.45 KB | 5.08 KB | 77% | 4.4ms | 8 | 288 | 0.02ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltfpack_cc_tc_si | gltfpack | 22.45 KB | 5.08 KB | 77% | 2.4ms | 8 | 288 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | blender_decimate_draco | blender | 22.45 KB | 10.59 KB | 53% | 3ms | 8 | 184 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| ecg_cart_prop | gltfpack_then_gltf_transform | combination | 22.45 KB | 14.16 KB | 37% | 2.7ms | 1 | 288 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | original_copy | combination | 9.98 KB | 9.98 KB | 0% | 1.9ms | 6 | 72 | 0.01ms | no | baseline_not_an_optimization_candidate, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltf_transform_meshopt | gltf-transform | 9.98 KB | 5.5 KB | 45% | 2.6ms | 4 | 72 | 0.02ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltf_transform_draco | gltf-transform | 9.98 KB | 4.3 KB | 57% | 2.7ms | 4 | 72 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltf_transform_webp | gltf-transform | 9.98 KB | 5.5 KB | 45% | 2.6ms | 4 | 72 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltf_transform_ktx2 | gltf-transform | 9.98 KB | failed | - | failed | - | - | - | no | optimizer_command_failed, optimized_glb_metrics_unavailable, size_reduction_below_2_percent, browser_load_failed, webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltfpack_cc | gltfpack | 9.98 KB | 5.95 KB | 40% | 2.5ms | 6 | 72 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltfpack_cc_tc_si | gltfpack | 9.98 KB | 5.95 KB | 40% | 2.4ms | 6 | 72 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | blender_decimate_draco | blender | 9.98 KB | 6.75 KB | 32% | 2.8ms | 6 | 42 | 0.01ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |
| pediatric_bay_environment | gltfpack_then_gltf_transform | combination | 9.98 KB | 7.17 KB | 28% | 2.4ms | 4 | 72 | 0.02ms | yes | webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence |

## Winners

| Sample | Size winner | Browser review winner | Recommendation |
| --- | --- | --- | --- |
| peds_patient_child_animated | gltfpack_cc_tc_si | gltf_transform_draco | gltf_transform_draco is the best current browser-visible review fixture candidate for this sample. |
| adult_standard_humanoid | gltfpack_cc_tc_si | gltfpack_cc | gltfpack_cc is the best current browser-visible review fixture candidate for this sample. |
| ecg_cart_prop | gltf_transform_draco | gltf_transform_draco | gltf_transform_draco is the best current browser-visible review fixture candidate for this sample. |
| pediatric_bay_environment | gltf_transform_draco | gltf_transform_draco | gltf_transform_draco is the best current browser-visible review fixture candidate for this sample. |

## Recommendation

- Current browser-visible winner: gltf_transform_draco across 4 sample(s), average savings 49.5%.
- For virtual patients, do not adopt quantization/Meshopt/Draco into WebXR runtime assets until Model Vetting Studio and UI-XR loader evidence both show visible skinned bodies, animations, and morph targets.
- For mobile VR, KTX2/BasisU remains the desired texture path when assets actually contain textures and local encoder/browser support is proven.

## Not Evidence For

- b_plus_visual_realism_gate
- quest_readiness
- production_asset_readiness
- learner_readiness
- clinical_validity
- scoring_validity
