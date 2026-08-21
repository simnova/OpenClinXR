/**
 * #547 — measure MPFB2 target-map symmetry + driven-bone coverage on one subject.
 *
 *   pnpm exec tsx tools/openclinxr/evidence/generate-mpfb-bone-map-coverage.ts
 *
 * Runs motion_bind_stage (retarget_bvh) against mpfb-ob-patient-aisha + cmu_07_01_walk.bvh,
 * then writes tools/openclinxr/evidence/mpfb-bone-map-coverage.json.
 *
 * claimScope: map key symmetry + driven count vs #545 control (22/137).
 * notEvidenceFor: visual walk quality, clinical motion, other actors, runtime wiring.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { runMotionBindOnce, TARGET_MAP } from "../asset-pipeline/makeclothes/motion-bind-cli.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const SUBJECT = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
);
const CLIP = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_07_01_walk.bvh",
);
const REPORT_OUT = path.join(HERE, "mpfb-bone-map-coverage.json");

async function listSubjectJoints(glbPath: string): Promise<string[]> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const names = new Set<string>();
  for (const skin of doc.getRoot().listSkins()) {
    for (const joint of skin.listJoints()) names.add(joint.getName());
  }
  return [...names].sort();
}

function mapKeysFromFile(mapPath: string): string[] {
  const raw = JSON.parse(readFileSync(mapPath, "utf8")) as {
    bones?: Record<string, string>;
  };
  return Object.keys(raw.bones ?? {}).sort();
}

async function main(): Promise<void> {
  if (!existsSync(SUBJECT)) throw new Error(`subject missing: ${SUBJECT}`);
  if (!existsSync(CLIP)) throw new Error(`clip missing: ${CLIP}`);
  if (!existsSync(TARGET_MAP)) throw new Error(`map missing: ${TARGET_MAP}`);

  const jobTmp =
    process.env.OPENCLINXR_JOB_TMP ??
    path.join(
      process.env.TMPDIR ?? "/tmp",
      `openclinxr-job-${process.env.USER ?? "u"}-${process.pid}-547`,
    );
  mkdirSync(jobTmp, { recursive: true });
  const outputGlb = path.join(jobTmp, `aisha_cmu_bind_547_$$.glb`.replace("$$", String(process.pid)));
  const bindReport = path.join(jobTmp, `aisha_cmu_bind_547_${process.pid}.json`);

  const subjectJoints = await listSubjectJoints(SUBJECT);
  const keys = mapKeysFromFile(TARGET_MAP);

  const bind = await runMotionBindOnce({
    actor: SUBJECT,
    clip: CLIP,
    output: outputGlb,
    report: bindReport,
  });

  const stage = JSON.parse(readFileSync(bind.reportPath, "utf8")) as {
    drivenBoneCount?: number;
    drivenBones?: Array<{ bone: string }>;
    verdict?: string;
    clipName?: string;
  };
  if (stage.verdict !== "ok") {
    throw new Error(`motion bind rejected: ${JSON.stringify(stage).slice(0, 800)}`);
  }

  const drivenNames = (stage.drivenBones ?? []).map((b) => b.bone).sort();
  const drivenSet = new Set(drivenNames);
  const unbound = keys.filter((k) => !drivenSet.has(k)).sort();

  const payload = {
    schemaVersion: "openclinxr.mpfb-bone-map-coverage.v1",
    issue: 547,
    factoryStep: "motion_retarget",
    generatedAt: new Date().toISOString(),
    subject: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    subjectJoints,
    clip: "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_07_01_walk.bvh",
    targetMap: "tools/openclinxr/asset-pipeline/makeclothes/known-rigs/mpfb2-default-no-toes.json",
    mapKeys: keys.length,
    mapKeyNames: keys,
    bonesDriven: stage.drivenBoneCount ?? drivenNames.length,
    driven: drivenNames,
    unbound,
    control: { mapKeys: 23, bonesDriven: 22, subjectJoints: 137 },
    operator: "mcp.load_and_retarget",
    clipName: stage.clipName ?? null,
    bindReportEphemeral: bindReport,
    claimScope: "mpfb2_target_map_symmetry_and_driven_coverage_on_one_subject_one_cc0_clip",
    notEvidenceFor: [
      "visual_walk_quality",
      "clinical_motion",
      "other_actors",
      "runtime_wiring",
      "promotion",
    ],
  };

  writeFileSync(REPORT_OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: REPORT_OUT,
        mapKeys: payload.mapKeys,
        bonesDriven: payload.bonesDriven,
        unbound: payload.unbound,
        subjectJoints: subjectJoints.length,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
