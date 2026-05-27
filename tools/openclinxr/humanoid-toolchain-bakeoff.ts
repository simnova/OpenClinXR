import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { globFiles, readJson } from "../agent-factory/lib.js";

const defaultOutputPath = `docs/openclinxr/humanoid-toolchain-bakeoff-${new Date().toISOString().slice(0, 10)}.json`;

type CandidateKind = "runtime_glb" | "source_variant_glb" | "body_profile_glb" | "local_tool_probe" | "approval_gated_provider";
type PromotionStatus = "promotable_fallback_only" | "compare_visually_before_promotion" | "not_promotable_without_install" | "not_promotable_without_approval";

type GlbMetrics = {
  byteLength: number;
  sha256: string;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  materialCount: number;
  skinCount: number;
  animationCount: number;
  morphTargetPrimitiveCount: number;
  vertexCount: number;
  annyBaseMeshNodeCount: number;
  clinicalIdlePoseClipCount: number;
};

type Candidate = {
  id: string;
  kind: CandidateKind;
  path?: string;
  source: string;
  intendedUse: string[];
  metrics?: GlbMetrics;
  detected?: boolean;
  score: number;
  grade: "A" | "B+" | "B" | "C" | "D";
  promotionStatus: PromotionStatus;
  blockers: string[];
  advantages: string[];
  nextAction: string;
};

type BakeoffReport = {
  schemaVersion: "openclinxr.humanoid-toolchain-bakeoff.v1";
  generatedAt: string;
  claimScope: "local_structural_and_provider_probe_only";
  candidates: Candidate[];
  recommendedOrder: string[];
  decision: {
    currentRuntimeFallback: string;
    keepAnnyAsSeed: true;
    tryNext: string[];
    rejectedForNow: string[];
  };
  notEvidenceFor: Array<"aaa_humanoid_realism" | "quest_readiness" | "production_readiness" | "clinical_validity" | "scoring_validity">;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const validateIndex = args.indexOf("--validate");
  const validateLatest = args.includes("--validate-latest");
  if (validateIndex >= 0 || validateLatest) {
    const validatePath = validateIndex >= 0 ? args[validateIndex + 1] : await latestPath("docs/openclinxr/humanoid-toolchain-bakeoff-*.json");
    if (!validatePath) throw new Error("Missing humanoid toolchain bakeoff report to validate.");
    const validation = validateBakeoffReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const outputIndex = args.indexOf("--output");
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : defaultOutputPath;
  if (!outputPath) throw new Error("Missing --output value");
  const report = await buildHumanoidToolchainBakeoffReport();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

export async function buildHumanoidToolchainBakeoffReport(input: {
  generatedAt?: string;
} = {}): Promise<BakeoffReport> {
  const glbCandidates = [
    glbCandidate("anny_neutral_runtime_seed", "runtime_glb", "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb", "Anny local generated-human seed", ["fallback humanoid seed", "source variant input"]),
    glbCandidate("ob_patient_aisha_source_variant", "source_variant_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/ob-patient-aisha-generated-human.glb", "Anny + actor material source variant + Blender normals", ["OB patient runtime fallback"]),
    glbCandidate("ob_nurse_williams_source_variant", "source_variant_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/ob-nurse-williams-generated-human.glb", "Anny + actor material source variant + Blender normals", ["OB nurse runtime fallback"]),
    glbCandidate("ob_partner_omar_source_variant", "source_variant_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/ob-partner-omar-generated-human.glb", "Anny + actor material source variant + Blender normals", ["OB partner runtime fallback"]),
    glbCandidate("anny_adult_standard_profile", "body_profile_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/adult-standard-generated-human.glb", "Anny generated-human body-profile matrix", ["age/body diversity candidate"]),
    glbCandidate("anny_bariatric_adult_profile", "body_profile_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/bariatric-adult-generated-human.glb", "Anny generated-human body-profile matrix", ["age/body diversity candidate"]),
    glbCandidate("anny_older_adult_kyphotic_profile", "body_profile_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/older-adult-kyphotic-generated-human.glb", "Anny generated-human body-profile matrix", ["age/posture diversity candidate"]),
    glbCandidate("anny_pediatric_school_age_profile", "body_profile_glb", "apps/ui-xr/public/xr-assets/humanoids/variants/pediatric-school-age-generated-human.glb", "Anny generated-human body-profile matrix", ["pediatric encounter candidate"]),
    glbCandidate("mpfb_ob_patient_local_candidate", "source_variant_glb", ".openclinxr-local/provider-cache/mpfb/generated/mpfb-ob-patient-aisha-rigged-candidate.glb", "MPFB 2.0.15 local Blender-generated comparator", ["OB patient source replacement candidate", "rig and shape-key comparator"]),
    glbCandidate("charmorph_antonia_local_candidate", "source_variant_glb", ".openclinxr-local/provider-cache/charmorph/generated/charmorph-antonia-ob-patient-candidate.glb", "CharMorph 0.4.0 + Antonia CC-BY local Blender-generated comparator", ["research-only OB patient geometry/material comparator", "candidate only after Rigify/animation gates"]),
    glbCandidate("charmorph_reom_local_candidate", "source_variant_glb", ".openclinxr-local/provider-cache/charmorph/generated/charmorph-reom-ob-patient-candidate.glb", "CharMorph 0.4.0 + Reom CC-BY local Blender-generated comparator", ["research-only OB patient geometry/material comparator", "candidate only after Rigify/animation gates"]),
  ];

  const candidates = [
    ...await Promise.all(glbCandidates.map(evaluateGlbCandidate)),
    localToolCandidate("blender_normals_postpass", "Blender weighted normals/smooth shading post-pass", ["/opt/homebrew/bin/blender", "/Applications/Blender.app/Contents/MacOS/Blender"], ["safe post-Anny mesh export cleanup"], "Use as accepted auxiliary pass; it improves normals/export hygiene but does not solve source realism alone."),
    localToolCandidate("mpfb_makehuman_blender_source", "MPFB / MakeHuman Blender source path", blenderAddonProbePaths(["mpfb", "makehuman"]), ["alternate humanoid body/clothing/hair source", "candidate source replacement"], "Install/probe locally, generate one actor GLB, then compare WebXR-only screenshot before promotion."),
    mblabCandidate(),
    approvalGatedProviderCandidate("hunyuan3d_local_or_model_cache", "Hunyuan3D local/model-cache path", ["equipment and prop generation first", "humanoid mesh prototype only after rig/topology gates"], "Try for props/equipment before humanoids; do not promote as actor runtime source until rig, topology, morph, animation, license, and screenshot gates pass."),
    approvalGatedProviderCandidate("meshy_cloud_requires_approval", "Meshy cloud provider", ["humanoid mesh/rig candidate", "equipment comparison"], "Requires explicit approval, credentials, budget, license review, generated asset hashes, and WebXR screenshot comparison before use."),
    approvalGatedProviderCandidate("tripo_cloud_requires_approval", "Tripo cloud provider", ["props/equipment comparison", "reference-image-to-3D comparison"], "Requires explicit approval, credentials, budget, license review, generated asset hashes, and WebXR screenshot comparison before use."),
  ];

  return {
    schemaVersion: "openclinxr.humanoid-toolchain-bakeoff.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    claimScope: "local_structural_and_provider_probe_only",
    candidates,
    recommendedOrder: [
      "ob_patient_aisha_source_variant",
      "ob_nurse_williams_source_variant",
      "ob_partner_omar_source_variant",
      "blender_normals_postpass",
      "mpfb_makehuman_blender_source",
      "mblab_blender_source",
      "hunyuan3d_local_or_model_cache",
      "meshy_cloud_requires_approval",
    ],
    decision: {
      currentRuntimeFallback: "Keep OB Anny source variants as runtime fallback until an alternate source beats them in WebXR-only screenshots.",
      keepAnnyAsSeed: true,
      tryNext: [
      "MPFB/MakeHuman local source generation for one OB actor",
      "CharMorph Antonia local comparator after Rigify/animation blockers are resolved",
      "MB-Lab local source generation for one OB actor",
        "Hunyuan3D local/model-cache only for props or humanoid prototype after rig/topology gates",
      ],
      rejectedForNow: [
        "runtime overlay clothing masks",
        "naive source sleeve/shirt geometry scaling",
        "cloud provider execution without explicit approval",
      ],
    },
    notEvidenceFor: ["aaa_humanoid_realism", "quest_readiness", "production_readiness", "clinical_validity", "scoring_validity"],
  };
}

function glbCandidate(id: string, kind: CandidateKind, candidatePath: string, source: string, intendedUse: string[]): Candidate {
  return {
    id,
    kind,
    path: candidatePath,
    source,
    intendedUse,
    score: 0,
    grade: "D",
    promotionStatus: "compare_visually_before_promotion",
    blockers: [],
    advantages: [],
    nextAction: "Run structural GLB scoring, then compare WebXR-only screenshots before promotion.",
  };
}

async function evaluateGlbCandidate(candidate: Candidate): Promise<Candidate> {
  if (!candidate.path || !existsSync(candidate.path)) {
    return {
      ...candidate,
      promotionStatus: "not_promotable_without_install",
      blockers: ["candidate_glb_missing"],
      nextAction: "Materialize or import this candidate through the encounter factory before comparison.",
    };
  }

  const document = await new NodeIO().read(candidate.path);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  const nodeNames = root.listNodes().map((node) => node.getName());
  const morphTargetPrimitiveCount = meshes.flatMap((mesh) => mesh.listPrimitives()).filter((primitive) => primitive.listTargets().length > 0).length;
  const vertexCount = meshes.flatMap((mesh) => mesh.listPrimitives()).reduce((count, primitive) => count + (primitive.getAttribute("POSITION")?.getCount() ?? 0), 0);
  const annyBaseMeshNodeCount = nodeNames.filter((name) => name === "neutral_generated_human_skinned_mesh").length;
  const clinicalIdlePoseClipCount = root.listAnimations().filter((animation) => /clinical|idle|relaxed|conversation|consult/i.test(animation.getName())).length;
  const blockers = [
    ...(root.listSkins().length === 0 ? ["skin_missing"] : []),
    ...(root.listAnimations().length === 0 ? ["animation_clips_missing"] : []),
    ...(morphTargetPrimitiveCount === 0 ? ["facial_morph_targets_missing"] : []),
    ...(clinicalIdlePoseClipCount === 0 ? ["clinical_idle_or_conversation_clip_missing"] : []),
    ...(vertexCount < 1500 ? ["low_vertex_count_for_close_humanoid_review"] : []),
  ];
  const score = Math.max(0, 100
    - (root.listSkins().length === 0 ? 20 : 0)
    - (root.listAnimations().length === 0 ? 20 : 0)
    - (morphTargetPrimitiveCount === 0 ? 20 : 0)
    - (clinicalIdlePoseClipCount === 0 ? 10 : 0)
    - (vertexCount < 1500 ? 15 : 0)
    - (annyBaseMeshNodeCount === 0 && candidate.source.includes("Anny") ? 5 : 0));

  return {
    ...candidate,
    metrics: {
      byteLength: (await readFile(candidate.path)).byteLength,
      sha256: createHash("sha256").update(await readFile(candidate.path)).digest("hex"),
      sceneCount: root.listScenes().length,
      nodeCount: root.listNodes().length,
      meshCount: meshes.length,
      materialCount: root.listMaterials().length,
      skinCount: root.listSkins().length,
      animationCount: root.listAnimations().length,
      morphTargetPrimitiveCount,
      vertexCount,
      annyBaseMeshNodeCount,
      clinicalIdlePoseClipCount,
    },
    score,
    grade: gradeForScore(score),
    promotionStatus: blockers.length === 0 ? "promotable_fallback_only" : "compare_visually_before_promotion",
    blockers,
    advantages: [
      ...(root.listSkins().length > 0 ? ["skinned_mesh_present"] : []),
      ...(root.listAnimations().length > 0 ? ["animation_channels_present"] : []),
      ...(morphTargetPrimitiveCount > 0 ? ["facial_morph_targets_present"] : []),
      ...(candidate.kind === "source_variant_glb" ? ["already_routed_through_ob_runtime_factory"] : []),
    ],
    nextAction: blockers.length === 0
      ? "Use as fallback only until WebXR screenshot comparison confirms visual improvement."
      : "Do not promote as replacement; use only as a comparison candidate until blockers are resolved.",
  };
}

function localToolCandidate(id: string, source: string, probePaths: string[], intendedUse: string[], nextAction: string): Candidate {
  const detected = probePaths.some((probePath) => existsSync(probePath));
  return {
    id,
    kind: "local_tool_probe",
    source,
    intendedUse,
    detected,
    score: detected ? 70 : 0,
    grade: detected ? "B" : "D",
    promotionStatus: detected ? "compare_visually_before_promotion" : "not_promotable_without_install",
    blockers: detected ? ["generated_actor_glb_missing", "webxr_screenshot_comparison_missing"] : ["local_tool_not_detected", "generated_actor_glb_missing"],
    advantages: detected ? ["local_tool_detected", "can_be_trialed_without_paid_cloud_provider"] : [],
    nextAction,
  };
}

function approvalGatedProviderCandidate(id: string, source: string, intendedUse: string[], nextAction: string): Candidate {
  return {
    id,
    kind: "approval_gated_provider",
    source,
    intendedUse,
    detected: false,
    score: 0,
    grade: "D",
    promotionStatus: "not_promotable_without_approval",
    blockers: ["explicit_operator_approval_missing", "credential_or_model_cache_evidence_missing", "generated_actor_glb_missing", "webxr_screenshot_comparison_missing"],
    advantages: ["candidate_for_future_comparison_only"],
    nextAction,
  };
}

function mblabCandidate(): Candidate {
  const detected = [
    ...blenderAddonProbePaths(["MB-Lab", "mb_lab", "mblab"]),
    ".openclinxr-local/provider-cache/mblab/addons/MB-Lab/__init__.py",
  ].some((probePath) => existsSync(probePath));
  return {
    id: "mblab_blender_source",
    kind: "local_tool_probe",
    source: "MB-Lab Blender source path",
    intendedUse: ["research-only alternate humanoid body/face source", "not a runtime source under current license policy"],
    detected,
    score: detected ? 35 : 0,
    grade: "D",
    promotionStatus: "not_promotable_without_install",
    blockers: detected
      ? ["agpl_generated_model_license_blocks_runtime_promotion", "webxr_screenshot_comparison_not_allowed_for_runtime_asset_promotion"]
      : ["local_tool_not_detected", "agpl_generated_model_license_blocks_runtime_promotion"],
    advantages: detected ? ["local_import_and_register_probe_passed", "useful_for_research_only_visual_reference"] : [],
    nextAction: "Do not generate or promote runtime humanoid GLBs from MB-Lab under current license policy; use only as a reference/toolchain research note unless legal approves a compatible path.",
  };
}

function blenderAddonProbePaths(addonNames: string[]): string[] {
  const home = process.env.HOME ?? "";
  const versions = ["5.2", "5.1", "5.0", "4.4", "4.3", "4.2"];
  const roots = versions.flatMap((version) => [
    path.join(home, "Library/Application Support/Blender", version, "scripts/addons"),
    path.join(home, "Library/Application Support/Blender", version, "extensions/user_default"),
    path.join(home, "Library/Application Support/Blender", version, "extensions/user_default/mpfb"),
    path.join(home, "Library/Application Support/Blender", version, "extensions/.user/user_default/mpfb"),
    path.join("/Applications/Blender.app/Contents/Resources", version, "scripts/addons"),
  ]);
  return roots.flatMap((root) => addonNames.map((name) => path.join(root, name)));
}

function gradeForScore(score: number): Candidate["grade"] {
  if (score >= 90) return "A";
  if (score >= 82) return "B+";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function validateBakeoffReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  if (value.schemaVersion !== "openclinxr.humanoid-toolchain-bakeoff.v1") errors.push("/schemaVersion invalid");
  if (value.claimScope !== "local_structural_and_provider_probe_only") errors.push("/claimScope invalid");
  if (!Array.isArray(value.candidates) || value.candidates.length < 8) errors.push("/candidates must include local GLBs and provider probes");
  if (!Array.isArray(value.recommendedOrder) || value.recommendedOrder.length === 0) errors.push("/recommendedOrder required");
  if (!isRecord(value.decision)) errors.push("/decision required");
  if (isRecord(value.decision) && value.decision.keepAnnyAsSeed !== true) errors.push("/decision/keepAnnyAsSeed must be true");
  if (Array.isArray(value.candidates)) {
    const ids = new Set(value.candidates.filter(isRecord).map((candidate) => String(candidate.id)));
    for (const id of ["anny_neutral_runtime_seed", "ob_patient_aisha_source_variant", "mpfb_makehuman_blender_source", "mblab_blender_source", "hunyuan3d_local_or_model_cache", "meshy_cloud_requires_approval"]) {
      if (!ids.has(id)) errors.push(`/candidates missing ${id}`);
    }
  }
  if (!Array.isArray(value.notEvidenceFor) || !value.notEvidenceFor.includes("aaa_humanoid_realism")) errors.push("/notEvidenceFor must include aaa_humanoid_realism");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const paths = await globFiles(pattern);
  return paths.sort().at(-1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
