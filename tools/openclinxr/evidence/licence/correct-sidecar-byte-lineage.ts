import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Correct a provenance sidecar's byte pin ONLY where the shipped bytes can be reproduced.
 *
 * The card's hard rule: "never by replacing a recorded hash solely to match unexplained bytes". A
 * hash rewritten to agree with whatever is on disk is not provenance, it is a note saying the file
 * exists. So this tool cannot write a hash it did not just derive: it checks out the pre-image
 * named by a commit, re-runs the derivation command, and compares the result with the shipped file.
 * A mismatch throws and nothing is written.
 *
 * WHAT IT WAS BUILT FOR, measured 2026-09-09. `separate_chest_anchor_joints.mjs` rewrote twelve
 * shipped MPFB rigs at 3d019031 and 91b12607 to move `breast.L`/`breast.R` off the midline. Its
 * per-actor reports under `tools/openclinxr/evidence/chest-anchor-joints/` record the operation and
 * its geometry but no output hash, so every sidecar it touched kept naming the pre-stage bytes.
 * Eight of thirteen comparable sidecars mismatched as a result — an unrecorded derivation step, not
 * unexplained bytes, and the difference is exactly what decides whether a hash may be corrected.
 *
 * IT RECORDS THE OLD VALUE. `byteLineage.recordedBefore` keeps the superseded hash, so a reader can
 * see what changed and a reviewer can repeat the reproduction.
 */

export type ByteLineageCorrection = {
  assetPath: string;
  provenancePath: string;
  /** Git revision expression for the bytes the derivation consumed, e.g. `3d019031^:path`. */
  preImageRevision: string;
  /** argv of the derivation, with {pre} and {out} placeholders. */
  derivationArgv: string[];
  why: string;
  workingDirectory: string;
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function correctSidecarByteLineage(input: ByteLineageCorrection): {
  reproduced: true;
  sha256: string;
  bytes: number;
  previous: { outputSha256: unknown; outputBytes: unknown };
} {
  mkdirSync(input.workingDirectory, { recursive: true });
  const preImagePath = path.join(input.workingDirectory, `${path.basename(input.assetPath, ".glb")}-pre.glb`);
  const rederivedPath = path.join(input.workingDirectory, `${path.basename(input.assetPath, ".glb")}-rederived.glb`);

  const preImage = execFileSync("git", ["show", input.preImageRevision], { maxBuffer: 1024 * 1024 * 512 });
  writeFileSync(preImagePath, preImage);

  const argv = input.derivationArgv.map((token) =>
    token.replace("{pre}", preImagePath).replace("{out}", rederivedPath),
  );
  const executable = argv[0];
  if (executable === undefined) {
    throw new Error("correct-sidecar-byte-lineage: the derivation command is empty; there is nothing to run.");
  }
  execFileSync(executable, argv.slice(1), { stdio: "pipe" });

  const rederived = readFileSync(rederivedPath);
  const shipped = readFileSync(input.assetPath);
  const rederivedDigest = sha256(rederived);
  const shippedDigest = sha256(shipped);
  if (rederivedDigest !== shippedDigest) {
    throw new Error(
      `correctSidecarByteLineage: refused — re-running the derivation on ${input.preImageRevision} produced ${rederivedDigest} (${rederived.byteLength} B) but ${input.assetPath} holds ${shippedDigest} (${shipped.byteLength} B). The shipped bytes are NOT explained by this derivation, so the recorded hash must not be rewritten to match them.`,
    );
  }

  const record = JSON.parse(readFileSync(input.provenancePath, "utf8")) as Record<string, unknown>;
  const previous = { outputSha256: record["outputSha256"], outputBytes: record["outputBytes"] };
  record["outputSha256"] = shippedDigest;
  record["outputBytes"] = shipped.byteLength;
  record["byteLineage"] = {
    correctedBy: "tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts (SC-04)",
    correctedAt: new Date().toISOString(),
    recordedBefore: previous,
    preImageRevision: input.preImageRevision,
    preImageSha256: sha256(preImage),
    preImageBytes: preImage.byteLength,
    derivationArgv: input.derivationArgv,
    reproduction: "byte-identical to the shipped file",
    why: input.why,
  };
  writeFileSync(input.provenancePath, `${JSON.stringify(record, null, 1)}\n`, "utf8");
  return { reproduced: true, sha256: shippedDigest, bytes: shipped.byteLength, previous };
}

const CHEST_ANCHOR_WHY =
  "separate_chest_anchor_joints.mjs mirrored breast.L/breast.R to x = +/- 0.085 m and moved the "
  + "ClinicalIdleConversation translation keyframes that pinned them to the midline. The stage's own "
  + "report under tools/openclinxr/evidence/chest-anchor-joints/ records the operation but no output "
  + "hash, so this sidecar kept naming the pre-stage bytes. Re-running the stage on the pre-image "
  + "reproduces the shipped file byte for byte.";

const CORRECTIONS: readonly Omit<ByteLineageCorrection, "workingDirectory">[] = [
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.provenance.json",
    preImageRevision: "3d019031^:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
    derivationArgv: [
      "node",
      "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs",
      "--input",
      "{pre}",
      "--output",
      "{out}",
      "--report",
      ".openclinxr/evidence/scene-closure/sc-04/rederive/nurse-rederive-report.json",
      "--half-span-m",
      "0.085",
    ],
    why: CHEST_ANCHOR_WHY,
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.provenance.json",
    preImageRevision: "91b12607^:apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
    derivationArgv: [
      "node",
      "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs",
      "--input",
      "{pre}",
      "--output",
      "{out}",
      "--report",
      ".openclinxr/evidence/scene-closure/sc-04/rederive/gown-rederive-report.json",
      "--half-span-m",
      "0.085",
    ],
    why: `${CHEST_ANCHOR_WHY} This asset had no sidecar at all until SC-04 authored one; the pin below is the first it has ever carried.`,
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.provenance.json",
    preImageRevision: "91b12607^:apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
    derivationArgv: [
      "node",
      "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs",
      "--input",
      "{pre}",
      "--output",
      "{out}",
      "--report",
      ".openclinxr/evidence/scene-closure/sc-04/rederive/family-rederive-report.json",
      "--half-span-m",
      "0.085",
    ],
    why: CHEST_ANCHOR_WHY,
  },
];

function main(): void {
  const workingDirectory = ".openclinxr/evidence/scene-closure/sc-04/rederive";
  for (const correction of CORRECTIONS) {
    const result = correctSidecarByteLineage({ ...correction, workingDirectory });
    process.stdout.write(
      `${correction.assetPath}: reproduced ${result.sha256} (${result.bytes} B), superseding ${String(result.previous.outputSha256)} (${String(result.previous.outputBytes)} B)\n`,
    );
  }
}

if (process.argv[1]?.endsWith("correct-sidecar-byte-lineage.ts")) main();
