import {
  decideHumanoidSourcePath,
  PEDS_ASTHMA_PATIENT_DECISION_INPUT,
  PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT,
  type HumanoidSourceDecision,
} from "./humanoid-source-decision-tree.js";
import type { CagematchReportPage } from "../../../packages/openclinxr/arena/model-vetting/src/cagematch-report.js";

const NOT_EVIDENCE = [
  "b_plus_visual_realism_gate",
  "scene_placement_readiness",
  "quest_readiness",
  "production_asset_readiness",
  "learner_readiness",
  "clinical_validity",
  "scoring_validity",
];

export function buildHumanoidSourceSideBySideReportPage(input: {
  runId: string;
  generatedAt: string;
  mediaUrlPaths: Array<{ mediaId: string; label: string; urlPath: string; caption: string }>;
}): CagematchReportPage {
  const patientDecision = decideHumanoidSourcePath(PEDS_ASTHMA_PATIENT_DECISION_INPUT);
  const parentMpfbProbe = decideHumanoidSourcePath(PEDS_ASTHMA_PARENT_MPFB_COMPARE_INPUT);

  return {
    schemaVersion: "openclinxr.cagematch-report-page.v1",
    reportId: `humanoid-source-side-by-side-${input.runId}`,
    lane: "humanoid-source-side-by-side",
    runId: input.runId,
    title: "Anny Comfy masked-face vs MPFB pediatric comparator",
    subtitle: "Humanoid source generation cagematch — school-age pediatric asthma patient",
    generatedAt: input.generatedAt,
    canonicalPlanPath: "docs/openclinxr/asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md",
    family: "Humanoid source generation",
    claimScope: "isolated_cagematch_report_page_no_runtime_or_readiness_promotion",
    objectives: [
      "Compare Anny parametric forward-pass + Comfy RealVisXL masked-face skin against an MPFB/MakeHuman pediatric basemesh comparator under the same case actor profile.",
      "Record repeatable side-by-side isolated Model Vetting Studio captures (front and three-quarter) before any scene-placement or production claim.",
      "Document feasibility criteria and a factory routing decision tree so future scenarios can choose Anny, MPFB, or hybrid paths deliberately.",
      "Keep all promotion gates false until license/provenance, rig/morph inventory, and adversarial visual review pass.",
    ],
    processSteps: [
      "Generate Anny Comfy v6 pediatric patient GLB (UV masks → RealVisXL masked-face inpaint → UV composite with face_no_scalp).",
      "Materialize MPFB/MakeHuman pediatric comparator GLB via local Blender background stage (pnpm asset:mpfb:pediatric-patient-cagematch).",
      "Build dual-candidate model-vetting report and capture front + three-quarter side-by-side screenshots in Model Vetting Studio.",
      "Run humanoid-source decision tree (pnpm asset:humanoid-source:decide) and record interim verdict with blocked promotion gates.",
      "Publish this cagematch report page (pnpm asset:cagematch:report-page) for reviewer-readable objectives, media, criteria, and routing guidance.",
      "Optional next: add turntable/viseme/emotion videos per model-vetting capture manifest before scene-placement evidence.",
    ],
    caseContext: {
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorRole: "patient",
      actorProfile: "school-age pediatric asthma patient (Maya Johnson)",
    },
    technologies: [
      {
        technologyId: "anny_parametric_forward_pass",
        displayName: "Anny parametric forward pass + Blender factory",
        toolVersions: ["anny 0.3.1", "Blender 5.1", "RealVisXL V5.0 (local cagematch only)"],
        summary:
          "Case-driven phenotype sliders generate a pediatric Anny mesh, canonical rig/morph contract, mesh clothing regions, and optional Comfy UV-mask face skin.",
        strengths: [
          "Binds case phenotype sliders (age, build, anxiety, clothing cues) directly to generation parameters.",
          "Default pediatric topology includes embedded eyes/tongue for UV-mask face cagematches.",
          "Same factory path already feeds UI-XR peds runtime bundles and review packets.",
          "Apache-2 Anny code path is locally reproducible on the M1 Max workstation.",
        ],
        limitations: [
          "Visible fidelity remains mannequin-grade; Comfy face pass improves islands but not hair/production wardrobe.",
          "Mesh clothing regions are procedural bounds-based panels, not MakeClothes-grade garments.",
          "Not a substitute for license-reviewed MakeHuman output when MPFB shape keys or basemesh wardrobe libraries are required.",
        ],
      },
      {
        technologyId: "mpfb_makehuman_basemesh",
        displayName: "MPFB2 / MakeHuman pediatric comparator",
        toolVersions: ["MPFB2 2.0.15", "Blender 5.1"],
        summary:
          "Local Blender background stage materializes a MakeHuman-compatible pediatric basemesh for isolated comparison and decision-tree context.",
        strengths: [
          "Native MPFB standard rig, face shape keys, and MakeHuman wardrobe/hair ecosystem when license review clears.",
          "Useful adult parent/nurse basemesh probe when case does not require Anny parametric binding.",
          "Clean basemesh export can be a neutral reference for rigging/retargeting cagematches.",
        ],
        limitations: [
          "MakeHuman output license not reviewed for promotion in this repo snapshot.",
          "Comparator child scale is a local Blender materialization, not yet case-parameter bound like Anny.",
          "Does not automatically carry OpenClinXR morph/viseme/emotion contract without additional rigging work.",
        ],
      },
      {
        technologyId: "comfy_realvisxl_masked_face",
        displayName: "Comfy RealVisXL masked-face skin (Anny UV islands)",
        toolVersions: ["ComfyUI 0.24.0", "RealVisXL_V5.0_fp16"],
        summary:
          "Mask-constrained face albedo using source UV face_front/eye_region islands with mandatory UV composite (face_no_scalp) after inpaint.",
        strengths: [
          "Improves face/scalp tone without cheek spill when UV composite + TQDM_DISABLE headless Comfy are used.",
          "Reuses licensed local checkpoint cache; no paid API.",
          "Extends to parent/nurse GLBs via the same mask report when topology matches.",
        ],
        limitations: [
          "Texture-only; does not fix hair, wardrobe, or rig quality.",
          "Still fixture-grade — not B+ realism or website-worthy evidence.",
        ],
      },
    ],
    feasibilityCriteria: buildFeasibilityCriteria(patientDecision, parentMpfbProbe),
    decisionBranches: buildDecisionBranches(patientDecision, parentMpfbProbe),
    interimVerdict: {
      summary:
        "For peds_asthma_parent_anxiety_v1 pediatric patient: retain Anny parametric forward-pass + Comfy masked-face as the primary factory path. Keep MPFB/MakeHuman as the local comparator and adult-rig/shape-key probe until MakeHuman license review and isolated cagematch wins a promotion gate.",
      recommendedPrimary: patientDecision.recommendedPath,
      recommendedFallback: patientDecision.fallbacks[0] ?? "mpfb_makehuman_basemesh",
      blockedReasons: [...new Set([...patientDecision.blockedReasons, ...parentMpfbProbe.blockedReasons])],
      compareBeforePromotion: patientDecision.compareBeforePromotion,
    },
    media: input.mediaUrlPaths.map((item) => ({
      mediaId: item.mediaId,
      kind: "image" as const,
      label: item.label,
      urlPath: item.urlPath,
      caption: item.caption,
      role: "comparison" as const,
      lookFor: lookForComparisonView(item.mediaId),
    })),
    processExplanations: buildProcessExplanations(input.mediaUrlPaths),
    relatedCommands: [
      "pnpm asset:humanoid-source:side-by-side-cagematch",
      "pnpm asset:humanoid-source:decide",
      "pnpm asset:mpfb:pediatric-patient-cagematch",
      "pnpm asset:anny-skin:comfy-masked-texture",
    ],
    notEvidenceFor: NOT_EVIDENCE,
  };
}

function buildFeasibilityCriteria(
  patientDecision: HumanoidSourceDecision,
  parentMpfbProbe: HumanoidSourceDecision,
): CagematchReportPage["feasibilityCriteria"] {
  return [
    {
      criterionId: "local_reproducibility",
      label: "Local reproducibility",
      question: "Can the path run on the M1 Max workstation without cloud, paid APIs, or credentials?",
      weight: "required",
      technologies: {
        anny_parametric_forward_pass: { rating: "pass", note: "anny 0.3.1 + Blender background stages verified." },
        mpfb_makehuman_basemesh: { rating: "pass", note: "MPFB2 2.0.15 Blender addon detected; comparator GLB materialized." },
        comfy_realvisxl_masked_face: { rating: "pass", note: "ComfyUI 0.24.0 + licensed RealVisXL cache; TQDM_DISABLE=1 for headless." },
      },
    },
    {
      criterionId: "license_provenance",
      label: "License and provenance",
      question: "Is the source legally usable with recorded provenance before any production adapter?",
      weight: "required",
      technologies: {
        anny_parametric_forward_pass: { rating: "pass", note: "Apache-2 Anny code path; provenance sidecars on generated GLBs." },
        mpfb_makehuman_basemesh: { rating: "warn", note: "MakeHuman output license not reviewed for promotion." },
        comfy_realvisxl_masked_face: { rating: "pass", note: "Licensed local RealVisXL checkpoint for cagematch only." },
      },
    },
    {
      criterionId: "case_parameter_binding",
      label: "Case parameter binding",
      question: "Does generation consume case phenotype sliders and actor role cues?",
      weight: "required",
      technologies: {
        anny_parametric_forward_pass: { rating: "pass", note: patientDecision.rationale[0] ?? "Case-driven sliders map to Anny forward pass." },
        mpfb_makehuman_basemesh: { rating: "warn", note: "Comparator uses child scale parameter; not full case phenotype binding yet." },
        comfy_realvisxl_masked_face: { rating: "warn", note: "Skin pass only; inherits base mesh from Anny path." },
      },
    },
    {
      criterionId: "rig_morph_contract",
      label: "Rig, morph, and viseme contract",
      question: "Does the GLB satisfy OpenClinXR runtime morph/viseme/emotion contract?",
      weight: "required",
      technologies: {
        anny_parametric_forward_pass: { rating: "pass", note: "Canonical armature, required morph targets, role clips in factory output." },
        mpfb_makehuman_basemesh: { rating: "warn", note: "MPFB standard rig available for basemesh; Anny GLB blocks direct mpfb.add_standard_rig." },
        comfy_realvisxl_masked_face: { rating: "not_evaluated", note: "Material-only pass; rig unchanged." },
      },
    },
    {
      criterionId: "visible_realism",
      label: "Visible realism (adversarial)",
      question: "Does isolated capture clear mannequin-grade gaps for skeptical external review?",
      weight: "important",
      technologies: {
        anny_parametric_forward_pass: { rating: "fail", note: "Bald, low-detail, mesh clothing artifacts; improved face tone only." },
        mpfb_makehuman_basemesh: { rating: "fail", note: "Untextured basemesh comparator; useful structural reference only." },
        comfy_realvisxl_masked_face: { rating: "warn", note: "Face islands improved; still fixture-grade overall." },
      },
    },
    {
      criterionId: "webxr_runtime_fit",
      label: "WebXR runtime fit",
      question: "Can UI-XR load and drive the asset without hidden fallbacks?",
      weight: "important",
      technologies: {
        anny_parametric_forward_pass: { rating: "pass", note: "Public peds bundle + scene evidence path exists." },
        mpfb_makehuman_basemesh: { rating: "warn", note: "Comparator isolated to model vetting; not default runtime bundle." },
        comfy_realvisxl_masked_face: { rating: "pass", note: "Optional UI-XR comparator mirror at /cagematch/anny-comfy-masked-skin/current/." },
      },
    },
    {
      criterionId: "adult_actor_probe",
      label: "Adult actor MPFB probe",
      question: "When the case needs MPFB rig/shape keys (parent/nurse), what does the tree recommend?",
      weight: "advisory",
      technologies: {
        anny_parametric_forward_pass: { rating: "warn", note: "Still available; not primary when MPFB rig required." },
        mpfb_makehuman_basemesh: { rating: "warn", note: parentMpfbProbe.rationale.join(" ") || "MPFB path for adult rig probe." },
        comfy_realvisxl_masked_face: { rating: "pass", note: "Can extend masked-face bind to parent/nurse on shared topology." },
      },
    },
  ];
}

function lookForComparisonView(mediaId: string): string[] {
  if (mediaId.includes("three_quarter")) {
    return [
      "Silhouette and child proportions relative to adult comparator scale.",
      "Mesh clothing region edges (blue torso panels) — jagged geometry vs smooth basemesh.",
      "Face read at angle: Comfy skin tone on Anny vs untextured MPFB basemesh.",
      "Hair absence on both paths — not a differentiator in this cagematch.",
    ];
  }
  return [
    "Left (Anny Comfy): face island tone, embedded eyes, procedural mesh clothing.",
    "Right (MPFB): neutral basemesh topology and child scale without case-bound phenotype.",
    "Rig pose: both should load in isolated studio without scene-placement props.",
    "Do not treat either capture as production-ready — compare structural and visible gaps only.",
  ];
}

function buildProcessExplanations(
  mediaUrlPaths: Array<{ mediaId: string; urlPath: string }>,
): NonNullable<CagematchReportPage["processExplanations"]> {
  const frontPoster = mediaUrlPaths.find((item) => item.mediaId.includes("front"))?.urlPath;
  return [
    {
      stepNumber: 1,
      title: "Generate both candidates locally",
      narrative:
        "Anny path runs parametric forward-pass + optional Comfy masked-face skin (v6, face_no_scalp UV composite). MPFB path materializes a pediatric basemesh comparator in Blender background — no cloud APIs.",
      lookFor: [
        "Both GLBs exist under model-vetting public paths before studio load.",
        "Provenance sidecars record generator versions and cagematch-only claim scope.",
      ],
      posterUrlPath: frontPoster,
    },
    {
      stepNumber: 2,
      title: "Load dual-candidate capture in Model Vetting Studio",
      narrative:
        "Open studio with dualCompare=true, left=anny_comfy_v6_peds_patient, right=mpfb_peds_patient_comparator. Fixed front and three-quarter cameras record isolated screenshots — no scene furniture.",
      lookFor: [
        "Both meshes render with meshCount > 0 before screenshot.",
        "Camera labels match front vs three-quarter presets.",
        "captureClaim is isolated_dual_humanoid_source_side_by_side_screenshot_only.",
      ],
      posterUrlPath: frontPoster,
    },
    {
      stepNumber: 3,
      title: "Score feasibility criteria (not promotion)",
      narrative:
        "Use the criteria table below to decide whether each technology is viable for a scenario. Pass on reproducibility or rig contract does not imply B+ realism or Quest readiness.",
      lookFor: [
        "License/provenance warnings on MPFB until MakeHuman review clears.",
        "Visible realism should remain fail/warn for both paths in this run.",
        "WebXR fit is advisory — UI-XR comparator mirror is optional evidence.",
      ],
    },
    {
      stepNumber: 4,
      title: "Apply decision tree for factory routing",
      narrative:
        "Pediatric case-bound actors default to Anny. MPFB wins when standard rig, shape keys, or MakeHuman wardrobe libraries are required and license review allows. Comfy extends Anny face islands only.",
      lookFor: [
        "Match branch condition to your scenario actor role and age band.",
        "When two paths tie on reproducibility, run compare_in_studio before adapter promotion.",
        "Record blocked reasons in interim verdict — do not bypass with scene placement.",
      ],
    },
  ];
}

function buildDecisionBranches(
  patientDecision: HumanoidSourceDecision,
  parentMpfbProbe: HumanoidSourceDecision,
): CagematchReportPage["decisionBranches"] {
  return [
    {
      branchId: "peds_parametric_child",
      condition: "School-age child actor with case phenotype sliders and embedded eyes/tongue topology",
      choose: patientDecision.recommendedPath,
      rationale: patientDecision.rationale.join(" "),
      exampleScenarios: ["peds_asthma_parent_anxiety_v1 patient Maya", "any pediatric case with Anny parametric binding"],
    },
    {
      branchId: "mpfb_rig_shapekeys",
      condition: "Actor requires MPFB standard rig, MakeHuman face shape keys, or basemesh wardrobe libraries",
      choose: parentMpfbProbe.recommendedPath,
      rationale: parentMpfbProbe.rationale.join(" "),
      exampleScenarios: ["Adult parent/nurse when license review clears", "OB/adult stations needing MakeHuman wardrobe"],
    },
    {
      branchId: "anny_with_comfy_face",
      condition: "Anny mesh retained but face/scalp realism needs local diffusion without scalp bleed",
      choose: "comfy_realvisxl_masked_face",
      rationale: "Use source UV masks + face_no_scalp composite after RealVisXL inpaint; never raw inpaint without UV composite.",
      exampleScenarios: ["Pediatric patient face cagematch v6", "Parent/nurse bind on shared default topology"],
    },
    {
      branchId: "hybrid_anny_mpfb_rig",
      condition: "Anny GLB needs MPFB eye rig or gaze probe but basemesh is not MPFB-native",
      choose: "hybrid_anny_mesh_mpfb_rig",
      rationale: "Record mpfb.add_standard_rig poll failure; add procedural eyes/gaze probe only as isolated cagematch evidence.",
      exampleScenarios: ["anny-mpfb2-eye-rig lane", "Gaze probe export without promoting MPFB basemesh"],
    },
    {
      branchId: "blocked_license",
      condition: "Neither Anny import nor MPFB addon available, or MakeHuman license blocks promotion",
      choose: "blocked_pending_review",
      rationale: "Fail closed; do not promote runtime bundle until probe and license review complete.",
      exampleScenarios: ["Fresh workstation setup", "MakeHuman output without license review"],
    },
    {
      branchId: "compare_before_promotion",
      condition: "Two paths both pass local reproducibility but visible realism or rig contract differ",
      choose: "compare_in_studio",
      rationale: "Run isolated side-by-side cagematch (this report) before scene placement or production adapter updates.",
      exampleScenarios: ["Anny Comfy v6 vs MPFB pediatric comparator", "Future Hunyuan3D/Meshy humanoid probes"],
    },
  ];
}