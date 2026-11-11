import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { correctSidecarByteLineage } from "../../../evidence/licence/correct-sidecar-byte-lineage.js";

type SwapReport = {
  schema: "openclinxr-teeth-swap-report.v1";
  tool: string;
  input: { path: string; sha256: string; bytes: number };
  scratch: { path: string; sha256: string; bytes: number };
  output: { path: string; sha256: string; bytes: number };
  cw1OriginalBinPrefix: { unchanged: true; prefixBytes: number; sha256: string };
  features: Record<string, unknown>;
  protectedAccessorHashes: unknown[];
  alignedRelayout?: Record<string, unknown>;
};

function value(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const result = index >= 0 ? argv[index + 1] : undefined;
  if (!result || (result.startsWith("-") && !/^-\d/.test(result))) throw new Error(`derive_sidecar: ${flag} is required`);
  return result;
}

function optional(argv: string[], flag: string): string | undefined {
  return argv.includes(flag) ? value(argv, flag) : undefined;
}

type ProtectedRow = { meshIndex: number; meshName: string; slot: string; accessorIndex: number; sha256: string };

const MAKECLOTHES = "tools/openclinxr/asset-pipeline/makeclothes";

/**
 * Post-swap steps in the order they ran: retreat (teeth-rest-clearance --delta), tongue
 * (tongue-forward-place --delta), couple (couple-fitted-teeth-to-lip-viseme), decimate
 * (teeth-swap/decimate_teeth.mts --in-place --ratio --error). Each is a
 * deterministic station run on the swapped GLB in place. Retreat and tongue run with
 * --in-place-bytes so OPENCLINXR_* extensions and accessor indices survive (cap9 D1).
 */
export function postSteps(argv: string[]): Array<{ tool: string; args: string[] }> {
  const steps: Array<{ tool: string; args: string[] }> = [];
  const retreat = optional(argv, "--retreat-delta");
  const tongue = optional(argv, "--tongue-delta");
  if (retreat !== undefined) steps.push({ tool: `${MAKECLOTHES}/teeth-rest-clearance.ts`, args: ["--delta", retreat, "--in-place-bytes"] });
  if (tongue !== undefined) steps.push({ tool: `${MAKECLOTHES}/tongue-forward-place.ts`, args: ["--delta", tongue, "--in-place-bytes"] });
  if (argv.includes("--couple")) steps.push({ tool: `${MAKECLOTHES}/couple-fitted-teeth-to-lip-viseme.ts`, args: [] });
  // Last: teeth decimation (super-ceo-cap13 2026-11-10, ED budget asset-generation-pipeline.md:87),
  // an in-place index rewrite, so extensions and accessor indices survive like the steps above.
  const decimateRatio = optional(argv, "--decimate-ratio");
  if (decimateRatio !== undefined) {
    const decimateError = optional(argv, "--decimate-error");
    if (decimateError === undefined) throw new Error("derive_sidecar: --decimate-ratio needs --decimate-error");
    steps.push({ tool: `${MAKECLOTHES}/teeth-swap/decimate_teeth.mts`, args: ["--in-place", "--ratio", decimateRatio, "--error", decimateError] });
  }
  return steps;
}

/** One sh -c chain: swap into "$2", then each post-step on "$2". Paths are single-quoted. */
export function chainedDerivationArgv(tool: string, absoluteScratch: string, steps: Array<{ tool: string; args: string[] }>): string[] {
  const quote = (token: string): string => `'${token.replaceAll("'", "'\\''")}'`;
  const swap = `mise exec -- python3 ${quote(tool)} --input "$1" --scratch ${quote(absoluteScratch)} --output "$2" --report "$3"`;
  const rest = steps.map((step) => `pnpm exec tsx ${quote(step.tool)} "$2"${step.args.map((a) => ` ${quote(a)}`).join("")}`);
  return ["sh", "-c", [swap, ...rest].join(" && "), "x", "{pre}", "{out}", "{report}"];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Indexed-triangle counts of the teeth and tongue meshes in a GLB (names matching /teeth/i and
 * /tongue/i), read from the JSON chunk the way HB-05 counts face triangles. The sidecar records
 * this for the pre-image so the HB-05 ladder can bind its mouth-swap trisDelta to a sha-pinned
 * pre-image without re-reading git history.
 */
export function mouthTris(glb: Buffer): { teeth: number; tongue: number } {
  if (glb.toString("latin1", 0, 4) !== "glTF") throw new Error("mouthTris: not a GLB");
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength)) as {
    meshes?: Array<{ name?: string; primitives: Array<{ indices?: number }> }>;
    accessors?: Array<{ count: number }>;
  };
  const out = { teeth: 0, tongue: 0 };
  for (const mesh of gltf.meshes ?? []) {
    const name = mesh.name ?? "";
    const key = /teeth/i.test(name) ? "teeth" : /tongue/i.test(name) ? "tongue" : undefined;
    if (!key) continue;
    for (const prim of mesh.primitives) {
      if (prim.indices !== undefined) out[key] += gltf.accessors![prim.indices]!.count / 3;
    }
  }
  return out;
}

export function serializeWithTeethSwapBlock(
  document: Record<string, unknown>,
  block: Record<string, unknown>,
): string {
  document["teethSwapB1"] = block;
  const serialized = `${JSON.stringify(document, null, 1)}\n`;
  JSON.parse(serialized);
  return serialized;
}

/**
 * Mouth tris of the swap's pre-image, read from --pre-image-revision (git show). The installed --input
 * already carries the swap and its post-steps, so its bytes can never equal report input.sha256 on a
 * re-derive; the revision blob is the pre-image the report hashed.
 */
export function preImageMouthTris(preImageRevision: string, expectedSha256: string): { teeth: number; tongue: number } {
  const bytes = execFileSync("git", ["show", preImageRevision], { maxBuffer: 1024 * 1024 * 256 });
  if (sha256(bytes) !== expectedSha256) throw new Error("derive_sidecar: --pre-image-revision bytes do not match report input.sha256");
  return mouthTris(bytes);
}

export function deriveTeethSwapSidecar(argv = process.argv.slice(2)): void {
  const input = value(argv, "--input");
  const scratch = value(argv, "--scratch");
  const output = value(argv, "--output");
  const sidecar = value(argv, "--sidecar");
  const reportPath = value(argv, "--report");
  const preImageRevision = value(argv, "--pre-image-revision");
  const workingDirectory = value(argv, "--working-directory");
  const repoRoot = process.cwd();
  const tool = "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py";
  const absoluteScratch = path.resolve(scratch);
  const steps = postSteps(argv);
  const swapOutput = steps.length > 0 ? value(argv, "--swap-output") : undefined;

  // correctSidecarByteLineage keeps only the superseded sha/bytes; the prior byteLineage (for the ED gown,
  // the blender bake argv recorded-garment-provenance.ts authenticates) is kept verbatim below
  // (super-ceo-cap14 R7, 2026-11-10).
  const priorByteLineage = (JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>)["byteLineage"];
  correctSidecarByteLineage({
    assetPath: output,
    provenancePath: sidecar,
    preImageRevision,
    workingDirectory,
    derivationArgv: steps.length > 0 ? chainedDerivationArgv(tool, absoluteScratch, steps) : [
      "mise",
      "exec",
      "--",
      "python3",
      tool,
      "--input",
      "{pre}",
      "--scratch",
      absoluteScratch,
      "--output",
      "{out}",
      "--report",
      "{report}",
    ],
    why:
      "The fitted CC0 teeth/tongue post-step was re-run from the named Git pre-image with the "
      + "same scratch bake and reproduced the output byte-for-byte before this sidecar pin moved."
      + (steps.length > 0 ? ` Post-swap steps in the chain: ${steps.map((s) => path.basename(s.tool)).join(", ")}.` : ""),
  });

  const reportBytes = readFileSync(reportPath);
  const report = JSON.parse(reportBytes.toString("utf8")) as SwapReport;
  if (report.schema !== "openclinxr-teeth-swap-report.v1") {
    throw new Error(`derive_sidecar: unsupported report schema ${String(report.schema)}`);
  }
  const outputBytes = readFileSync(output);
  const swapBytes = swapOutput ? readFileSync(swapOutput) : outputBytes;
  if (report.output.sha256 !== sha256(swapBytes) || report.output.bytes !== swapBytes.byteLength) {
    throw new Error(`derive_sidecar: report output pin does not match the ${swapOutput ? "--swap-output" : "re-derived output"}`);
  }
  let protectedRows = report.protectedAccessorHashes as ProtectedRow[];
  if (steps.length > 0) {
    // Post-steps renumber accessors; re-pin each row to its final index only if its sha256 is unchanged.
    const finalRows = JSON.parse(
      execFileSync("mise", ["exec", "--", "python3", tool, "--protected-hashes", output], { maxBuffer: 1024 * 1024 * 64 }).toString("utf8"),
    ) as ProtectedRow[];
    const byKey = new Map(finalRows.map((row) => [`${row.meshIndex}|${row.slot}`, row]));
    if (finalRows.length !== protectedRows.length) {
      throw new Error(`derive_sidecar: protected row count ${finalRows.length} != swap report ${protectedRows.length}`);
    }
    protectedRows = protectedRows.map((row) => {
      const after = byKey.get(`${row.meshIndex}|${row.slot}`);
      if (!after || after.sha256 !== row.sha256 || after.meshName !== row.meshName) {
        throw new Error(`derive_sidecar: protected ${row.meshIndex}:${row.slot} changed in a post-step`);
      }
      return { ...row, accessorIndex: after.accessorIndex };
    });
  }
  // The swap report's features.*.outputAccessorHashes describe swapOutput. After post-steps the installed
  // GLB differs (retreat moves POSITION, couple adds targets, decimate rewrites indices), so the final rows
  // are hashed from the output by feature_hashes.py (super-ceo-cap14 2026-11-10) and recorded beside them.
  let features = report.features as Record<string, Record<string, unknown>>;
  const featureTool = "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/feature_hashes.py";
  if (steps.length > 0) {
    const finalRows = JSON.parse(
      execFileSync("mise", ["exec", "--", "python3", featureTool, output], { maxBuffer: 1024 * 1024 * 64 }).toString("utf8"),
    ) as Record<string, Array<{ slot: string; sha256: string }>>;
    features = Object.fromEntries(
      Object.entries(features).map(([name, feature]) => {
        const rows = finalRows[name];
        if (!rows) throw new Error(`derive_sidecar: feature_hashes.py returned no ${name} rows`);
        return [name, { ...feature, finalAccessorHashes: rows }];
      }),
    );
  }
  if (path.resolve(report.input.path) !== path.resolve(input)) {
    throw new Error("derive_sidecar: report input path does not match --input");
  }

  const document = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
  if (priorByteLineage !== undefined) {
    const lineage = document["byteLineage"] as { recordedBefore: Record<string, unknown> };
    lineage.recordedBefore["byteLineage"] = priorByteLineage;
  }
  const teethSwapB1 = {
    tool: report.tool,
    toolSha256: sha256(readFileSync(path.join(repoRoot, report.tool))),
    reportPath,
    reportSha256: sha256(reportBytes),
    input: report.input,
    preImageMouthTris: preImageMouthTris(preImageRevision, report.input.sha256),
    scratch: report.scratch,
    output: steps.length > 0 ? { path: output, sha256: sha256(outputBytes), bytes: outputBytes.byteLength } : report.output,
    ...(steps.length > 0
      ? {
          swapOutput: report.output,
          postSteps: steps.map((step) => ({
            tool: step.tool,
            toolSha256: sha256(readFileSync(path.join(repoRoot, step.tool))),
            args: step.args,
          })),
        }
      : {}),
    cw1OriginalBinPrefix: report.cw1OriginalBinPrefix,
    features,
    ...(steps.length > 0
      ? { finalAccessorHashesTool: { path: featureTool, sha256: sha256(readFileSync(path.join(repoRoot, featureTool))) } }
      : {}),
    protectedAccessorHashes: protectedRows,
    ...(report.alignedRelayout ? { alignedRelayout: report.alignedRelayout } : {}),
    claimScope: "fitted teeth/tongue mesh, skin, material and embedded CC0 texture transplant only",
    notEvidenceFor: ["Quest readiness", "clinical validity", "in-app T4 still quality"],
  };
  // Parse/stringify the whole object. This stays valid even when outputBytes was the former last field.
  writeFileSync(sidecar, serializeWithTeethSwapBlock(document, teethSwapB1), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deriveTeethSwapSidecar();
}
