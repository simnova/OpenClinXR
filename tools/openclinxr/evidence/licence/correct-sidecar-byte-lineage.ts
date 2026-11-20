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
  /** Reviewed pre-image digest (h5 S1): re-derived once, stored as a literal. */
  preImageSha256?: string;
  /** Reviewed output digest (h5 S1): re-derived once, stored as a literal. */
  outputSha256?: string;
};

/** Reviewed row: production CORRECTIONS entries carry both re-derived literals. */
export type ReviewedByteLineageCorrection = Omit<ByteLineageCorrection, "workingDirectory" | "expectedPreImageSha256"> & {
  preImageSha256: string;
  outputSha256: string;
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Run one row's derivation in a fresh call dir under workingDirectory; returns the re-derived digest. */
export function runRowDerivation(
  workingDirectory: string,
  assetPath: string,
  derivationArgv: string[],
  preImage: Buffer,
): { digest: string; bytes: number } {
  const base = path.resolve(workingDirectory);
  mkdirSync(base, { recursive: true });
  const callDir = mkdtempSync(path.join(base, `${path.basename(assetPath, ".glb")}-`));
  const preImagePath = path.join(callDir, `${path.basename(assetPath, ".glb")}-pre.glb`);
  const rederivedPath = path.join(callDir, `${path.basename(assetPath, ".glb")}-rederived.glb`);
  const ownedReportPath = path.join(callDir, `${path.basename(assetPath, ".glb")}-report.json`);

  writeFileSync(preImagePath, preImage);

  const argv = derivationArgv.map((token) =>
    token.replace("{pre}", preImagePath).replace("{out}", rederivedPath).replace("{report}", ownedReportPath),
  );
  const executable = argv[0];
  if (executable === undefined) {
    throw new Error("correct-sidecar-byte-lineage: the derivation command is empty; there is nothing to run.");
  }
  execFileSync(executable, argv.slice(1), { stdio: "pipe" });

  const rederived = readFileSync(rederivedPath);
  return { digest: sha256(rederived), bytes: rederived.byteLength };
}

export function correctSidecarByteLineage(input: ByteLineageCorrection): ReturnType<typeof correctSidecarByteLineageImpl> {
  return correctSidecarByteLineageImpl(input);
}

// reuse is module-private: only runChainGroup may skip the re-derive, after it has
// compared the chain's final digest against the shipped bytes.
function correctSidecarByteLineageImpl(input: ByteLineageCorrection, reuse?: { digest: string; bytes: number }): {
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
  // h5 S2: the reviewed pre-image literal pins the derivation input. A caller
  // that names a different pre-image (or a stale row) refuses before any write.
  if (input.preImageSha256 !== undefined && preImageDigest !== input.preImageSha256) {
    throw new Error(
      `correctSidecarByteLineage: refused — pre-image ${preImageLabel(input.preImage)} hashes to ${preImageDigest} but the reviewed row pins ${input.preImageSha256}. Refusing before any write.`,
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
    // h5 S2: even the skip path honors the reviewed output literal.
    if (input.outputSha256 !== undefined && shippedDigest !== input.outputSha256) {
      throw new Error(
        `correctSidecarByteLineage: refused — shipped ${input.assetPath} holds ${shippedDigest} but the reviewed row pins output ${input.outputSha256}. Refusing before any write.`,
      );
    }
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
  // No established correction: derive and compare, unless the caller passes
  // the fresh output it already compared (chain final row runs once).
  const { digest: rederivedDigest, bytes: rederivedBytes } = reuse ??
    runRowDerivation(
      rawBase,
      input.assetPath,
      input.derivationArgv,
      preImage,
    );

  // h5 S2: the reviewed output literal pins the derivation result. A command
  // that produces different bytes (or a stale row) refuses before any write.
  if (input.outputSha256 !== undefined && rederivedDigest !== input.outputSha256) {
    throw new Error(
      `correctSidecarByteLineage: refused — re-running the derivation on ${preImageLabel(input.preImage)} produced ${rederivedDigest} but the reviewed row pins output ${input.outputSha256}. Refusing before any write.`,
    );
  }

  if (rederivedDigest !== shippedDigest) {
    throw new Error(
      `correctSidecarByteLineage: refused — re-running the derivation on ${preImageLabel(input.preImage)} (${preImageFlag(input.preImage)}) produced ${rederivedDigest} (${rederivedBytes} B) but ${input.assetPath} holds ${shippedDigest} (${shipped.byteLength} B). The shipped bytes are NOT explained by this derivation, so the recorded hash must not be rewritten to match them.`,
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
export const CORRECTIONS: readonly ReviewedByteLineageCorrection[] = [
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.provenance.json",
    // 10768617f removed normalTexture in JSON (7becc30f -> 88070603) without a
    // tracked writer. That lineage gap predates the Git pre-image for this replay.
    preImage: { kind: "revision", revision: "59980e7f6:apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb" },
    preImageSha256: "33626da946fc05b7cd964b999a734e59f3862cb5567eba6a211c139ec7587957",
    outputSha256: "37e905ea9fa0d4f3664d95a1c34ab45219a77ed63a46b4976b0bb1a063443ce9",
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
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.provenance.json",
    preImage: { kind: "revision", revision: "a900aaf9a:apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb" },
    preImageSha256: "37e905ea9fa0d4f3664d95a1c34ab45219a77ed63a46b4976b0bb1a063443ce9",
    outputSha256: "4148864b18186c788c8a30f16f7fb7d924752f3c53fb4ede24d767278656e99c",
    derivationArgv: [
      "sh",
      "-c",
      "printf '%s  %s\\n' \"12d3c9a2301dd9362b20f7c531876b55cff854d26eefcad48de56a22ffb5eee3\" \"tools/openclinxr/asset-pipeline/makeclothes/data/aisha-sweater-selection.json\" | shasum -a 256 --check && mise exec -- python3 -I tools/openclinxr/asset-pipeline/makeclothes/rehide-aisha-shoulder-skin.py --in \"$1\" --out \"$2\" --select-faces \"tools/openclinxr/asset-pipeline/makeclothes/data/aisha-sweater-selection.json\" --patch-prim-in-place --report \"$3\"",
      "x",
      "{pre}",
      "{out}",
      "{report}",
    ],
    why: "AISHA-SWEATER-POKE-THROUGH (tsk_4c6a7143f7dff5e0): the pinned 20-face S2 shoulder union (repo selection tools/openclinxr/asset-pipeline/makeclothes/data/aisha-sweater-selection.json, sha256 12d3c9a2; union over 8 ClinicalIdleConversation times, held-out t=0.5 never selected; clearance < 5 mm = garment_coverage.HIDE_EPSILON_M) hidden by the registered rehide-aisha-shoulder-skin.py (python3 -I, patch-prim-in-place) on the 37e905ea pre-image; same stage as run-chain manifest mpfb-ob-patient-aisha.post-export.json stage 01.",
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.provenance.json",
    preImage: { kind: "revision", revision: "50b9ddf6c:apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb" },
    preImageSha256: "4148864b18186c788c8a30f16f7fb7d924752f3c53fb4ede24d767278656e99c",
    outputSha256: "a9ffe0621f54557add1e612d4a6d8fd23879c96cd76aac3071f6a97d3f03dad4",
    derivationArgv: [
      "sh",
      "-c",
      "cp \"$1\" \"$2\" && pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts \"$2\"",
      "x",
      "{pre}",
      "{out}",
    ],
    why: "AISHA-FITTED-TEETH-VISEMES (tsk_d3455707881d9c55): the registered couple-fitted-teeth-to-lip-viseme.ts (coupler card tsk_09ebec711d102e62, in-place couple) adds the 7 opening lip-viseme POSITION targets to the fitted-teeth prim on the 4148864b pre-image; same stage as run-chain manifest mpfb-ob-patient-aisha.post-export.json stage 02.",
  },
  {
    assetPath: "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
    provenancePath: "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.provenance.json",
    preImage: { kind: "revision", revision: "2803b774^:apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb" },
    preImageSha256: "6cae49b961c7ae727bc60ebcff79a80ddb40b7b0922bf3bc1157e33771678daa",
    outputSha256: "a668be32a5f6de035af071255962f43001812e278656cfe1affa2cf0202a4ae9",
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
    preImageSha256: "029dbb504c6f655c7a2fc141948ff92dbd86190a306ee75ade8c50c39f8ab43f",
    outputSha256: "59f590701ad182c4eca33e90a7ba25f0cb94b8698afd7fc2318436fc3c26e9a6",
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
    preImageSha256: "14a4167a9b6d6aec9d01f367b91c806d1c8e18568a0ebe36e6405240697e7a0c",
    outputSha256: "8f7ad8acda01542f829908ae0a7de266a80b6525f08b538532d904e0f0f27b93",
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
    preImageSha256: "8957543dfc9f0fcacafd942c432f12947dd00d8f370ba3c519f6cb8ff9b1be86",
    outputSha256: "ce10321833f92ccc5930fafbadfc8544c9b5ec715a33e71c96ebf5b4e5d6056e",
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
  // Chain rows share one assetPath (cap50 r5h1): one chain, one sidecar, so
  // every row must name the same provenancePath, else the final row would
  // silently choose the write target.
  const provenanceByAsset = new Map<string, { provenancePath: string; index: number }>();
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
    const assetPath = record["assetPath"] as string;
    const provenancePath = record["provenancePath"] as string;
    const seen = provenanceByAsset.get(assetPath);
    if (seen !== undefined && seen.provenancePath !== provenancePath) {
      throw new Error(
        `correct-sidecar-byte-lineage: ${file} row ${index}: provenancePath ${JSON.stringify(provenancePath)} differs from row ${seen.index} ${JSON.stringify(seen.provenancePath)} for the same assetPath ${JSON.stringify(assetPath)}. Refusing before any correction IO.`,
      );
    }
    provenanceByAsset.set(assetPath, { provenancePath, index });
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
  corrections: readonly (InjectedByteLineageCorrection & { preImageSha256?: string; outputSha256?: string })[],
  workingDirectory: string,
  asset: string | undefined,
): void {
  let selected = corrections;
  if (asset !== undefined) {
    const missing = asset.trim() === "" || asset.startsWith("-");
    selected = missing ? [] : corrections.filter((correction) => correction.assetPath === asset);
    if (selected.length === 0) throw new UnknownAssetError(missing ? "(missing)" : asset);
  }
  // Chain-aware (cap50 r5h1): rows sharing one asset form a lineage chain
  // r1..rN in table order. Single-row groups keep the exact old path.
  const groups = new Map<string, (InjectedByteLineageCorrection & { preImageSha256?: string; outputSha256?: string })[]>();
  for (const correction of selected) {
    const group = groups.get(correction.assetPath);
    if (group === undefined) groups.set(correction.assetPath, [correction]);
    else group.push(correction);
  }
  for (const [assetPath, group] of groups) {
    if (group.length === 1) {
      const correction = group[0] as InjectedByteLineageCorrection & { preImageSha256?: string; outputSha256?: string };
      const expectedPreImageSha256 = sha256(readPreImageBytes(correction.preImage));
      const result = correctSidecarByteLineage({ ...correction, expectedPreImageSha256, workingDirectory });
      process.stdout.write(
        `${correction.assetPath}: reproduced ${result.sha256} (${result.bytes} B), superseding ${String(result.previous.outputSha256)} (${String(result.previous.outputBytes)} B)\n`,
      );
      continue;
    }
    runChainGroup(assetPath, group, workingDirectory);
  }
}

/**
 * Chain correction (mirrors the sidecar junction rule assertLineageContinuity
 * in packages/openclinxr/factory-station-core/src/teeth-swap-lineage.ts:58):
 * every row RUNS; row i's re-derived output digest must equal row i+1's
 * expectedPreImageSha256 (for i<N); only r_N is compared with the shipped
 * bytes. A junction breach throws naming the rows and both digests, with
 * NOTHING written (all derivations and checks precede the single write).
 */
function runChainGroup(
  assetPath: string,
  group: (InjectedByteLineageCorrection & { preImageSha256?: string; outputSha256?: string })[],
  workingDirectory: string,
): void {
  const expected: string[] = [];
  const outputs: { digest: string; bytes: number }[] = [];
  group.forEach((correction, index) => {
    const preImage = readPreImageBytes(correction.preImage);
    const preDigest = sha256(preImage);
    // h5 S2: chain rows honor the reviewed pre-image literal before deriving.
    if (correction.preImageSha256 !== undefined && preDigest !== correction.preImageSha256) {
      throw new Error(
        `correctSidecarByteLineage: chain refused for ${assetPath} — row ${index + 1} pre-image hashes to ${preDigest} but the reviewed row pins ${correction.preImageSha256}. NOTHING written.`,
      );
    }
    expected.push(preDigest);
    const output = runRowDerivation(workingDirectory, assetPath, correction.derivationArgv, preImage);
    // h5 S2: chain rows honor the reviewed output literal before the junction.
    if (correction.outputSha256 !== undefined && output.digest !== correction.outputSha256) {
      throw new Error(
        `correctSidecarByteLineage: chain refused for ${assetPath} — row ${index + 1} re-derived ${output.digest} but the reviewed row pins output ${correction.outputSha256}. NOTHING written.`,
      );
    }
    outputs.push(output);
    process.stdout.write(
      `${assetPath}: chain row ${index + 1}/${group.length} re-derived ${output.digest} (${output.bytes} B)\n`,
    );
  });
  for (let i = 0; i < group.length - 1; i += 1) {
    const left = outputs[i] as { digest: string; bytes: number };
    const right = expected[i + 1] as string;
    if (left.digest !== right) {
      throw new Error(
        `correctSidecarByteLineage: chain refused for ${assetPath} — junction r${i + 1} -> r${i + 2}: row ${i + 1} re-derived ${left.digest} but row ${i + 2} expects pre-image ${right}. NOTHING written.`,
      );
    }
  }
  const last = group[group.length - 1] as InjectedByteLineageCorrection & { preImageSha256?: string; outputSha256?: string };
  // F1: the fresh final output must equal the shipped bytes BEFORE any write.
  // The old path discarded it, so the top-match skip reported reproduced for
  // wrong bytes whenever the sidecar already pinned the shipped digest.
  const shippedBytes = readFileSync(assetPath);
  const shippedDigest = sha256(shippedBytes);
  const final = outputs[outputs.length - 1] as { digest: string; bytes: number };
  if (final.digest !== shippedDigest) {
    throw new Error(
      `correctSidecarByteLineage: chain refused for ${assetPath} — final row ${group.length} re-derived ${final.digest} (${final.bytes} B) but the shipped file holds ${shippedDigest} (${shippedBytes.byteLength} B). NOTHING written.`,
    );
  }
  const result = correctSidecarByteLineageImpl(
    {
      ...last,
      expectedPreImageSha256: expected[expected.length - 1] as string,
      workingDirectory,
    },
    // Reuse the chain-phase output: the final command runs once per chain run.
    final,
  );
  process.stdout.write(
    `${assetPath}: reproduced ${result.sha256} (${result.bytes} B), superseding ${String(result.previous.outputSha256)} (${String(result.previous.outputBytes)} B)\n`,
  );
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
