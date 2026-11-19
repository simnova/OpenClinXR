import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Correct a sidecar byte pin ONLY where the shipped bytes reproduce: check out
 * the pre-image, re-run the derivation, compare with the shipped file. A
 * mismatch throws and nothing is written. `recordedBefore` preserves the old
 * hash and prior lineage; derivations use unique child dirs for {pre}/{out}.
 */

export type PreImageSource =
  | { kind: "revision"; revision: string }
  | { kind: "file"; path: string };

/** ONE reader for both pre-image kinds (H1): revisions via `git show`, files via disk. */
export function readPreImageBytes(source: PreImageSource): Buffer {
  if (source.kind === "revision") {
    return execFileSync("git", ["show", source.revision], { maxBuffer: 1024 * 1024 * 512 });
  }
  return readFileSync(source.path);
}

function preImageFlag(source: PreImageSource): string {
  return source.kind === "revision" ? "--pre-image-revision" : "--pre-image-file";
}

function preImageLabel(source: PreImageSource): string {
  return source.kind === "revision" ? source.revision : source.path;
}

export type ByteLineageCorrection = {
  assetPath: string;
  provenancePath: string;
  /** Discriminated pre-image source, replacing the old preImageRevision string (H1). */
  preImage: PreImageSource;
  /**
   * The sha the gate checked (H5). The corrector re-reads via readPreImageBytes
   * and refuses BEFORE any write if its own read differs, naming both shas.
   */
  expectedPreImageSha256: string;
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
  previous: { outputSha256: unknown; outputBytes: unknown; byteLineage?: unknown };
} {
  const rawBase = input.workingDirectory;
  if (rawBase === undefined || rawBase.trim() === "" || rawBase.trim().startsWith("-")) {
    throw new Error("correct-sidecar-byte-lineage: --working-directory <dir> is required before any derivation IO.");
  }
  // H5 TOCTOU guard: re-read the pre-image and compare against the sha the gate
  // checked, BEFORE any write (no mkdir/mkdtemp/writeFileSync has run yet).
  const preImage = readPreImageBytes(input.preImage);
  const preImageDigest = sha256(preImage);
  if (preImageDigest !== input.expectedPreImageSha256) {
    throw new Error(
      `correctSidecarByteLineage: refused — ${preImageFlag(input.preImage)} bytes changed between gate and correction: expected ${input.expectedPreImageSha256} but read ${preImageDigest} from ${preImageLabel(input.preImage)}. Refusing before any write.`,
    );
  }
  // The pre-image descriptor and rationale distinguish corrections with identical bytes and argv.
  const record = JSON.parse(readFileSync(input.provenancePath, "utf8")) as Record<string, unknown>;
  const priorLineage = record["byteLineage"];
  const priorIsLineage =
    priorLineage !== null && typeof priorLineage === "object" && !Array.isArray(priorLineage);
  const priorRecord = (priorIsLineage ? (priorLineage as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const currentDescriptor =
    input.preImage.kind === "revision"
      ? `revision:${input.preImage.revision}`
      : `file:${input.preImage.path}`;
  const shipped = readFileSync(input.assetPath);
  const shippedDigest = sha256(shipped);
  const levelMatches = (level: Record<string, unknown>): boolean => {
    const descriptor =
      typeof level["preImageRevision"] === "string"
        ? `revision:${level["preImageRevision"] as string}`
        : typeof level["preImageFile"] === "string"
          ? `file:${level["preImageFile"] as string}`
          : undefined;
    const rb = level["recordedBefore"];
    const rbValid =
      rb !== null &&
      typeof rb === "object" &&
      !Array.isArray(rb) &&
      typeof (rb as Record<string, unknown>)["outputSha256"] === "string" &&
      typeof (rb as Record<string, unknown>)["outputBytes"] === "number";
    return (
      level["preImageSha256"] === preImageDigest &&
      descriptor === currentDescriptor &&
      JSON.stringify(level["derivationArgv"]) === JSON.stringify(input.derivationArgv) &&
      level["why"] === input.why &&
      rbValid
    );
  };
  let chainLevel: unknown = priorIsLineage ? priorLineage : null;
  let chainMatched = false;
  let matchedIsTop = false;
  let isTop = true;
  while (chainLevel !== null && typeof chainLevel === "object" && !Array.isArray(chainLevel)) {
    const level = chainLevel as Record<string, unknown>;
    if (levelMatches(level)) {
      chainMatched = true;
      matchedIsTop = isTop;
      break;
    }
    isTop = false;
    const rb = level["recordedBefore"] as Record<string, unknown> | undefined;
    const next = rb !== null && typeof rb === "object" && !Array.isArray(rb)
      ? (rb as Record<string, unknown>)["byteLineage"]
      : undefined;
    chainLevel = next ?? null;
  }
  // A top-level match still requires the recorded top output to equal the
  // shipped bytes (else the asset changed without a provenance update: fall
  // through to re-derive, which refuses on mismatch). A below-top match
  // NEVER skips (F3): only the top derivation can reproduce the shipped
  // bytes, so a below-top level must re-run; its re-derivation either
  // reproduces the shipped file (throwing nothing) or refuses, and a
  // caller validating only that level against altered shipped bytes gets a
  // refusal instead of a successful reproduction result.
  if (chainMatched && matchedIsTop && record["outputSha256"] === shippedDigest) {
    const topRb = priorRecord["recordedBefore"] as {
      outputSha256: unknown;
      outputBytes: unknown;
    };
    return { reproduced: true, sha256: shippedDigest, bytes: shipped.byteLength, previous: topRb };
  }
  // A re-proof of the recorded top transition (same pre-image digest to the
  // same pin) under a changed identity still RUNS the derivation below and
  // compares its output to the shipped bytes: a match reproduces with no
  // sidecar write, a mismatch or command failure throws with nothing
  // written. The changed argv runs here, so ["false"] or an altered command
  // cannot report a reproduction.
  const duplicateTransition =
    record["outputSha256"] === shippedDigest &&
    priorIsLineage &&
    priorRecord["preImageSha256"] === preImageDigest;
  // No established correction: derive the pre-image and compare.
  const base = path.resolve(rawBase);
  mkdirSync(base, { recursive: true });
  const callDir = mkdtempSync(path.join(base, `${path.basename(input.assetPath, ".glb")}-`));
  const preImagePath = path.join(callDir, `${path.basename(input.assetPath, ".glb")}-pre.glb`);
  const rederivedPath = path.join(callDir, `${path.basename(input.assetPath, ".glb")}-rederived.glb`);
  const ownedReportPath = path.join(callDir, `${path.basename(input.assetPath, ".glb")}-report.json`);

  writeFileSync(preImagePath, preImage);

  const argv = input.derivationArgv.map((token) =>
    token.replace("{pre}", preImagePath).replace("{out}", rederivedPath).replace("{report}", ownedReportPath),
  );
  const executable = argv[0];
  if (executable === undefined) {
    throw new Error("correct-sidecar-byte-lineage: the derivation command is empty; there is nothing to run.");
  }
  execFileSync(executable, argv.slice(1), { stdio: "pipe" });

  const rederived = readFileSync(rederivedPath);
  const rederivedDigest = sha256(rederived);
  if (rederivedDigest !== shippedDigest) {
    throw new Error(
      `correctSidecarByteLineage: refused — re-running the derivation on ${preImageLabel(input.preImage)} (${preImageFlag(input.preImage)}) produced ${rederivedDigest} (${rederived.byteLength} B) but ${input.assetPath} holds ${shippedDigest} (${shipped.byteLength} B). The shipped bytes are NOT explained by this derivation, so the recorded hash must not be rewritten to match them.`,
    );
  }
  if (duplicateTransition) {
    const topRb = priorRecord["recordedBefore"] as {
      outputSha256: unknown;
      outputBytes: unknown;
    };
    return { reproduced: true, sha256: shippedDigest, bytes: shipped.byteLength, previous: topRb };
  }

  const previous = {
    outputSha256: record["outputSha256"],
    outputBytes: record["outputBytes"],
    ...(priorIsLineage ? { byteLineage: priorLineage } : {}),
  };
  record["outputSha256"] = shippedDigest;
  record["outputBytes"] = shipped.byteLength;
  record["byteLineage"] = {
    correctedBy: "tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts (SC-04)",
    correctedAt: new Date().toISOString(),
    recordedBefore: previous,
    ...(input.preImage.kind === "revision"
      ? { preImageRevision: input.preImage.revision }
      : { preImageFile: input.preImage.path }),
    preImageSha256: preImageDigest,
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

const TIGHTJEANS_FP_RUNG_WHY =
  "2803b774 applied the face-preserving decimation rung (iterate-optimize.ts --face-preserving "
  + "--face-preserving-ratio 0.4) to the tightjeans re-baked bodies and touched no provenance file, "
  + "so both sidecars kept naming the pre-decimation bytes. The commit records the rung in "
  + "tools/openclinxr/evidence/humanoid-vetting/tightjeans-rebake-2026-09-12.md but no output hash. "
  + "Re-running that rung on the pre-image reproduces the shipped file byte for byte; the digest "
  + "below is therefore a derivation, not a reading taken off disk.";

/** p2e-c-prod: exported so the card's lin re-exec proof can run the nurse
 * corrections through this exact table (no duplicated argv/why text). */
export const CORRECTIONS: readonly Omit<ByteLineageCorrection, "workingDirectory" | "expectedPreImageSha256">[] = [
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.provenance.json",
    // 10768617f removed normalTexture in JSON (7becc30f -> 88070603) without a
    // tracked writer. That lineage gap predates the Git pre-image for this replay.
    preImage: { kind: "revision", revision: "59980e7f6:apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb" },
    derivationArgv: [
      "sh",
      "-c",
      "printf '%s  %s\\n' \"$5\" \"$4\" | shasum -a 256 --check && "
      + "mise exec -- python3 tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py "
      + '--input "$1" --scratch "$4" --output "$2" --report "$3" && '
      + 'pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts "$2" --delta 0.0031 --in-place-bytes && '
      + 'pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/decimate_teeth.mts "$2" --in-place --ratio 0.65 --error 0.005',
      "aisha-teeth-lineage",
      "{pre}",
      "{out}",
      "{report}",
      "/Volumes/files/openclinxr-assets/store/st-teeth/swap1-scratch/mpfb-ob-patient-aisha.glb",
      "67b2ee1f1d1c1045f63b2208d11654e507649a041b30916d5d5f617481a528ea",
    ],
    why: "Replay the b042f849c teeth and tongue transplant, rest clearance, and tooth decimation from the 59980e7f6 Git pre-image using the hash-verified archived scratch GLB.",
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.provenance.json",
    preImage: { kind: "revision", revision: "2803b774^:apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb" },
    derivationArgv: [
      "pnpm",
      "exec",
      "tsx",
      "tools/openclinxr/evidence/licence/fp-rung-rederive.ts",
      "--input",
      "{pre}",
      "--out",
      "{out}",
      "--face-preserving-ratio",
      "0.4",
    ],
    why: TIGHTJEANS_FP_RUNG_WHY,
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.provenance.json",
    preImage: { kind: "revision", revision: "91b12607^:apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb" },
    derivationArgv: [
      "node",
      "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs",
      "--input",
      "{pre}",
      "--output",
      "{out}",
      "--report",
      "{report}",
      "--half-span-m",
      "0.085",
    ],
    why: `${CHEST_ANCHOR_WHY} This asset had no sidecar at all until SC-04 authored one; the pin below is the first it has ever carried.`,
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.provenance.json",
    preImage: { kind: "revision", revision: "91b12607^:apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb" },
    derivationArgv: [
      "node",
      "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs",
      "--input",
      "{pre}",
      "--output",
      "{out}",
      "--report",
      "{report}",
      "--half-span-m",
      "0.085",
    ],
    why: CHEST_ANCHOR_WHY,
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.provenance.json",
    // P2e-C tracked factory chain (F1, single run, no archived mid): stage 1
    // fills the hide-mask footprint of the skin baseColor from the shipped
    // skin (P2e-A inpaint) into a temp file under the run's out dir; stage 2
    // un-hides exactly prim7 tris {2,3,4,5,6,53} (position-keyed 6-tri set)
    // from that temp output. The only external input is the c1da76fb4 git
    // revision below; mask + faces-from are tracked fixtures.
    preImage: { kind: "revision", revision: "c1da76fb4:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb" },
    derivationArgv: [
      "mise",
      "exec",
      "--",
      "python3",
      "-I",
      "tools/openclinxr/evidence/skin-footprint-inpaint/scripts/nurse-vneck-chain.py",
      "--pre",
      "{pre}",
      "--out",
      "{out}",
      "--footprint-mask",
      "tools/openclinxr/evidence/skin-footprint-inpaint/fixtures/pre-e9-footprint-mask.png",
      "--faces-from",
      "tools/openclinxr/evidence/skin-footprint-inpaint/fixtures/nurse-vneck-6tri.json",
      "--report",
      "{report}",
    ],
    why: "P2e-C tracked factory chain (single run, no archived mid): stage 1 fills the hide-mask footprint of the skin baseColor from the shipped skin (P2e-A inpaint) into a temp file under the run's out dir, then stage 2 un-hides exactly prim7 tris {2,3,4,5,6,53} (position-keyed 6-tri set) from that temp output so the scrub V-neck shows skin instead of the E9 T patch, with no other tri moved. Re-running the chain on the c1da76fb4 pre-image reproduces the shipped file byte for byte; the digest below is therefore a derivation, not a reading taken off disk.",
  },
];

/** Fixture-injectable table row: everything main() needs except the run-local fields. */
export type InjectedByteLineageCorrection = Omit<ByteLineageCorrection, "workingDirectory" | "expectedPreImageSha256">;

export class UnknownAssetError extends Error {
  readonly asset: string;
  constructor(asset: string) {
    super(`correct-sidecar-byte-lineage: unknown --asset ${asset} (no corrections entry has that assetPath).`);
    this.name = "UnknownAssetError";
    this.asset = asset;
  }
}

export class CorrectionsFileGateError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(
      `correct-sidecar-byte-lineage: CORRECT_SIDECAR_CORRECTIONS_FILE=${file} is set outside a test gate (requires VITEST or NODE_ENV=test); refusing before any correction IO.`,
    );
    this.name = "CorrectionsFileGateError";
    this.file = file;
  }
}

/** H4: every fixture row is validated before any correction IO. The error names the file, row index, and field. */
function validateInjectedCorrectionsTable(file: string, parsed: unknown[]): void {
  const seen = new Set<string>();
  parsed.forEach((row, index) => {
    const at = `${file} row ${index}`;
    const bad = (field: string, detail: string): Error =>
      new Error(`correct-sidecar-byte-lineage: ${at}: bad ${field} ${detail}. Refusing before any correction IO.`);
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw bad("row", "(expected an object with assetPath/provenancePath/preImage/derivationArgv/why)");
    }
    const record = row as Record<string, unknown>;
    for (const field of ["assetPath", "provenancePath", "why"] as const) {
      if (typeof record[field] !== "string" || (record[field] as string).trim() === "") {
        throw bad(field, "(expected a non-empty string)");
      }
    }
    const assetPath = record["assetPath"] as string;
    if (seen.has(assetPath)) throw bad("assetPath", `(duplicate ${JSON.stringify(assetPath)})`);
    seen.add(assetPath);
    const preImage = record["preImage"] as Record<string, unknown> | null;
    if (preImage === null || typeof preImage !== "object" || Array.isArray(preImage)) {
      throw bad("preImage", '(expected { kind: "revision", revision } or { kind: "file", path })');
    } else if (preImage["kind"] === "revision") {
      if (typeof preImage["revision"] !== "string" || (preImage["revision"] as string).trim() === "") {
        throw bad("preImage", '(revision kind requires a non-empty "revision" string)');
      }
    } else if (preImage["kind"] === "file") {
      if (typeof preImage["path"] !== "string" || (preImage["path"] as string).trim() === "") {
        throw bad("preImage", '(file kind requires a non-empty "path" string)');
      }
    } else {
      throw bad("preImage", `(unknown kind ${JSON.stringify(preImage["kind"])})`);
    }
    const derivationArgv: unknown = record["derivationArgv"];
    if (
      !Array.isArray(derivationArgv) ||
      derivationArgv.length === 0 ||
      !derivationArgv.every((token: unknown) => typeof token === "string" && token.trim().length > 0)
    ) {
      throw bad("derivationArgv", "(expected a non-empty array of non-empty strings)");
    }
  });
}

/** Fixture injection (H3): CORRECT_SIDECAR_CORRECTIONS_FILE replaces the table only under VITEST/NODE_ENV=test. */
export function resolveCorrectionsTable(): readonly InjectedByteLineageCorrection[] {
  const file = process.env["CORRECT_SIDECAR_CORRECTIONS_FILE"];
  if (file === undefined || file.trim() === "") return CORRECTIONS;
  const gated =
    (process.env["VITEST"] !== undefined && (process.env["VITEST"] as string).trim() !== "") ||
    process.env["NODE_ENV"] === "test";
  if (!gated) throw new CorrectionsFileGateError(file);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`correct-sidecar-byte-lineage: ${file} must hold a JSON array of corrections.`);
  }
  validateInjectedCorrectionsTable(file, parsed);
  return parsed as InjectedByteLineageCorrection[];
}

/** The loop main() runs (asset-filtered); unknown asset throws UnknownAssetError (exit 2). */
export function runCorrectionsTable(
  corrections: readonly InjectedByteLineageCorrection[],
  workingDirectory: string,
  asset: string | undefined,
): void {
  let selected = corrections;
  if (asset !== undefined) {
    const missing = asset.trim() === "" || asset.startsWith("-");
    selected = missing ? [] : corrections.filter((correction) => correction.assetPath === asset);
    if (selected.length === 0) throw new UnknownAssetError(missing ? "(missing)" : asset);
  }
  for (const correction of selected) {
    const expectedPreImageSha256 = sha256(readPreImageBytes(correction.preImage));
    const result = correctSidecarByteLineage({ ...correction, expectedPreImageSha256, workingDirectory });
    process.stdout.write(
      `${correction.assetPath}: reproduced ${result.sha256} (${result.bytes} B), superseding ${String(result.previous.outputSha256)} (${String(result.previous.outputBytes)} B)\n`,
    );
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(
      "usage: correct-sidecar-byte-lineage.ts --working-directory <dir> [--asset <assetPath>]\n",
    );
    return;
  }
  const flagIndex = argv.indexOf("--working-directory");
  const value = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  if (flagIndex < 0 || value === undefined || value.trim() === "" || value.startsWith("-")) {
    process.stderr.write(
      "correct-sidecar-byte-lineage: --working-directory <dir> is required before any derivation IO.\n",
    );
    process.exitCode = 2;
    return;
  }
  // H2: --asset is fully parsed before any IO; missing/doubled values exit 2 naming --asset.
  const assetIndexes: number[] = [];
  argv.forEach((token, index) => {
    if (token === "--asset") assetIndexes.push(index);
  });
  if (assetIndexes.length > 1) {
    process.stderr.write(
      "correct-sidecar-byte-lineage: --asset was given twice; pass exactly one --asset <assetPath>.\n",
    );
    process.exitCode = 2;
    return;
  }
  let asset: string | undefined;
  if (assetIndexes.length === 1) {
    const raw = argv[(assetIndexes[0] as number) + 1];
    if (raw === undefined || raw.trim() === "" || raw.startsWith("-")) {
      process.stderr.write(
        `correct-sidecar-byte-lineage: --asset requires a value <assetPath> (got ${raw === undefined ? "(missing)" : JSON.stringify(raw)}); pass exactly one --asset <assetPath>.\n`,
      );
      process.exitCode = 2;
      return;
    }
    asset = raw;
  }
  const base = path.resolve(value);
  try {
    runCorrectionsTable(resolveCorrectionsTable(), base, asset);
  } catch (error) {
    if (error instanceof UnknownAssetError || error instanceof CorrectionsFileGateError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

if (process.argv[1]?.endsWith("correct-sidecar-byte-lineage.ts")) {
  // Refusals thrown under tsx must exit via exitCode (H1): an uncaught throw
  // becomes a rejected import promise and hangs node in task-runner shutdown.
  try {
    main();
  } catch (error) {
    process.exitCode = 1;
    try {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    } catch {
      /* exit code already set; diagnostic write is best effort */
    }
  }
}
