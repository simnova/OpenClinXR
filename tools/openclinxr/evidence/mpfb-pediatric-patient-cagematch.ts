import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  PEDS_ASTHMA_PATIENT_DECISION_INPUT,
  decideHumanoidSourcePath,
} from "../factory/humanoid-source-decision-tree.js";
import { buildCagematchOutputHome, ensureCagematchOutputHome } from "./generated-output-home.js";

type CliOptions = {
  lane: string;
  runId: string;
  childScale: number;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputHome = buildCagematchOutputHome(options.lane, options.runId);
  await ensureCagematchOutputHome(outputHome);

  const decision = decideHumanoidSourcePath({
    ...PEDS_ASTHMA_PATIENT_DECISION_INPUT,
    requiresMpfbStandardRigOrShapekeys: true,
  });

  const outputGlb = path.join(outputHome.publicMirrorDir, "peds_patient_child_mpfb_comparator.glb");
  const reportPath = path.join(outputHome.localEvidenceDir, "mpfb-pediatric-patient-cagematch.json");
  await mkdir(path.dirname(outputGlb), { recursive: true });

  execSync(
    [
      "blender",
      "--background",
      "--python",
      "tools/openclinxr/evidence/blender/materialize_mpfb_pediatric_patient_candidate.py",
      "--",
      "--output-glb",
      outputGlb,
      "--report",
      path.join(outputHome.localArtifactDir, "mpfb-blender-report.json"),
      "--child-scale",
      String(options.childScale),
    ].join(" "),
    { stdio: "inherit", encoding: "utf8" },
  );

  const summary = {
    schemaVersion: "openclinxr.mpfb-pediatric-patient-cagematch-summary.v1",
    generatedAt: new Date().toISOString(),
    claimScope: "local_mpfb_makehuman_pediatric_comparator_with_decision_tree_context",
    lane: options.lane,
    runId: options.runId,
    outputGlbPath: outputGlb,
    publicMirrorUrlPath: `${outputHome.publicMirrorUrlPath}/peds_patient_child_mpfb_comparator.glb`,
    childScale: options.childScale,
    decisionTree: decision,
    annyPrimaryForPedsPatient: decideHumanoidSourcePath(PEDS_ASTHMA_PATIENT_DECISION_INPUT),
    outputHome,
    providerBoundary: {
      localOnly: true,
      externalNetworkUsed: false,
      paidApiUsed: false,
      runtimePromotionAllowed: false,
      productionAssetReadinessClaimed: false,
    },
    notEvidenceFor: decision.notEvidenceFor,
  };

  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(outputHome.publicMirrorDir, "mpfb-pediatric-patient-cagematch.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`${JSON.stringify({ reportPath, outputGlb, decision: decision.recommendedPath }, null, 2)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    lane: "mpfb-peds-patient-comparator",
    runId: new Date().toISOString().slice(0, 10),
    childScale: 0.62,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--lane") options.lane = requireNext(args, ++i, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++i, arg);
    else if (arg === "--child-scale") options.childScale = Number(requireNext(args, ++i, arg));
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}