import { execSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCagematchOutputHome, ensureCagematchOutputHome } from "./generated-output-home.js";

type ActorSpec = {
  actorRole: "patient" | "parent" | "nurse";
  candidateId: string;
  sourceGlbPath: string;
  outputGlbName: string;
  outputAlbedoName: string;
  runtimeMirrorName: string;
};

const ACTORS: ActorSpec[] = [
  {
    actorRole: "parent",
    candidateId: "peds_anxious_parent_anny_compatible_candidate",
    sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
    outputGlbName: "peds_anxious_parent_comfy_masked_face.glb",
    outputAlbedoName: "peds_anxious_parent_comfy_masked_face_albedo.png",
    runtimeMirrorName: "peds_anxious_parent.glb",
  },
  {
    actorRole: "nurse",
    candidateId: "peds_nurse_kevin_anny_compatible_candidate",
    sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
    outputGlbName: "peds_nurse_kevin_comfy_masked_face.glb",
    outputAlbedoName: "peds_nurse_kevin_comfy_masked_face_albedo.png",
    runtimeMirrorName: "peds_nurse_kevin.glb",
  },
];

type CliOptions = {
  lane: string;
  runId: string;
  maskReportPath: string;
  baseAlbedoPath: string;
  sourceReportPath: string;
  actors: ActorSpec[];
  mirrorToUiXr: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputHome = buildCagematchOutputHome(options.lane, options.runId);
  await ensureCagematchOutputHome(outputHome);

  const results: Array<Record<string, unknown>> = [];
  if (options.mirrorToUiXr) {
    const runtimeMirrorDir = "apps/ui-xr/public/cagematch/anny-comfy-masked-skin/current";
    await mkdir(runtimeMirrorDir, { recursive: true });
    const patientSource =
      "apps/arena/model-vetting-studio/public/cagematch/anny-comfy-masked-skin/2026-06-07-comfy-face-inpaint-v6/peds_patient_child_comfy_masked_face.glb";
    await cp(patientSource, path.join(runtimeMirrorDir, "peds_patient_child.glb"));
    results.push({
      actorRole: "patient",
      runtimeMirrorPath: "/cagematch/anny-comfy-masked-skin/current/peds_patient_child.glb",
      sourceGlbPath: patientSource,
      mirroredFromExistingRun: "2026-06-07-comfy-face-inpaint-v6",
    });
  }

  for (const actor of options.actors) {
    const actorRunId = `${options.runId}-${actor.actorRole}`;
    const actorHome = buildCagematchOutputHome(options.lane, actorRunId);
    await ensureCagematchOutputHome(actorHome);

    execSync(
      [
        "pnpm",
        "asset:anny-skin:comfy-masked-texture",
        "--",
        "--mask-report",
        options.maskReportPath,
        "--base-albedo",
        options.baseAlbedoPath,
        "--lane",
        options.lane,
        "--run-id",
        actorRunId,
        "--output-albedo-name",
        actor.outputAlbedoName,
      ].join(" "),
      { stdio: "inherit", encoding: "utf8" },
    );

    const albedoPath = path.join(actorHome.localArtifactDir, actor.outputAlbedoName);
    const outputGlbPath = path.join(actorHome.publicMirrorDir, actor.outputGlbName);
    execSync(
      [
        "pnpm",
        "asset:anny-skin:realvisxl-direct-texture",
        "--",
        "--source-report",
        options.sourceReportPath,
        "--candidate-id",
        actor.candidateId,
        "--source-glb",
        actor.sourceGlbPath,
        "--texture",
        albedoPath,
        "--lane",
        options.lane,
        "--run-id",
        actorRunId,
        "--output-glb-name",
        actor.outputGlbName,
      ].join(" "),
      { stdio: "inherit", encoding: "utf8" },
    );

    if (options.mirrorToUiXr) {
      const runtimeMirrorDir = "apps/ui-xr/public/cagematch/anny-comfy-masked-skin/current";
      await mkdir(runtimeMirrorDir, { recursive: true });
      await cp(outputGlbPath, path.join(runtimeMirrorDir, actor.runtimeMirrorName));
    }

    results.push({
      actorRole: actor.actorRole,
      candidateId: actor.candidateId,
      albedoPath,
      outputGlbPath,
      publicMirrorUrlPath: `${actorHome.publicMirrorUrlPath}/${actor.outputGlbName}`,
      runtimeMirrorPath: options.mirrorToUiXr
        ? `/cagematch/anny-comfy-masked-skin/current/${actor.runtimeMirrorName}`
        : null,
    });
  }

  const summaryPath = path.join(outputHome.localEvidenceDir, "comfy-masked-face-actor-bind-cagematch.json");
  await writeFile(
    summaryPath,
    `${JSON.stringify({
      schemaVersion: "openclinxr.comfy-masked-face-actor-bind-cagematch.v1",
      generatedAt: new Date().toISOString(),
      claimScope: "parent_nurse_comfy_masked_face_bind_with_optional_ui_xr_runtime_mirror_no_promotion",
      lane: options.lane,
      runId: options.runId,
      maskReportPath: options.maskReportPath,
      baseAlbedoPath: options.baseAlbedoPath,
      actors: results,
      outputHome,
      providerBoundary: {
        localOnly: true,
        externalNetworkUsed: false,
        paidApiUsed: false,
        runtimePromotionAllowed: false,
        productionAssetReadinessClaimed: false,
      },
      notEvidenceFor: [
        "b_plus_visual_realism_gate",
        "scene_placement_readiness",
        "quest_readiness",
        "production_asset_readiness",
        "learner_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`${JSON.stringify({ summaryPath, actors: results }, null, 2)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    lane: "anny-comfy-masked-skin",
    runId: new Date().toISOString().slice(0, 10),
    maskReportPath:
      ".openclinxr/asset-production/cagematch/anny-source-uv-masks/2026-06-06-comfy-masked-skin/anny-source-uv-masks.json",
    baseAlbedoPath:
      "docs/openclinxr/realvisxl-direct-texture-cagematch-2026-06-06/peds_patient_child_realvisxl_skin_albedo.png",
    sourceReportPath: "docs/openclinxr/model-vetting-report-peds-asthma-parent-anxiety-2026-06-07.json",
    actors: ACTORS,
    mirrorToUiXr: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--lane") options.lane = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--mask-report") options.maskReportPath = requireNext(args, ++index, arg);
    else if (arg === "--base-albedo") options.baseAlbedoPath = requireNext(args, ++index, arg);
    else if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--actors") {
      const requested = requireNext(args, ++index, arg).split(",").map((value) => value.trim());
      options.actors = ACTORS.filter((actor) => requested.includes(actor.actorRole));
      if (options.actors.length === 0) throw new Error(`No actors matched --actors ${requested.join(",")}`);
    } else if (arg === "--no-ui-xr-mirror") options.mirrorToUiXr = false;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}