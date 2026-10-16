// Face-fit-to-bake wiring (card tsk_2c547dda8753bba0): run the face fit
// before the stage-4 bake and partition the case fit file-weights into
// materializer-loadable (applied) vs not (unapplied, never dropped silently).
//
// Case data lives only in case-inputs.json; this module names no case.
import { copyFileSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import { FIT_DIR_REL, FIT_REL, runMisePython, sha256Bytes, sha256File } from "./shared.js";

/** MPFB target subdirs the materializer loader scans. Must match
 * load_mpfb_face_shape_keys (packages/openclinxr/factory-stations/src/body_param/mpfb_body.py:102);
 * families outside this list (head-*, asym-*, macro stems) cannot load and
 * are recorded unapplied, never passed (the materializer refuses unknown
 * names loudly: materialize_mpfb_humanoid_candidate.py:5601-5606). */
export const FACE_TARGET_LOADER_SUBDIRS = [
  "expression",
  "mouth",
  "eyes",
  "eyebrows",
  "cheek",
  "chin",
  "nose",
  "forehead",
] as const;

export const FACE_TARGET_LOADER_FILE =
  "packages/openclinxr/factory-stations/src/body_param/mpfb_body.py:102";

/** Mirror of TargetService.filename_to_shapekey_name(basename,
 * encode_name=False): strip .gz, then .target/.ptarget (case-insensitive). */
export function shapeKeyNameForTargetFile(fileName: string): string {
  const base = fileName.split("/").at(-1) ?? fileName;
  return base.replace(/\.gz$/i, "").replace(/\.p?target$/i, "");
}

function listTargetFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const abs = path.join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (isDir) out.push(...listTargetFilesRecursive(abs));
    else if (/\.p?target(\.gz)?$/i.test(entry)) out.push(abs);
  }
  return out;
}

/** Shape-key names the materializer loader can resolve (same MPFB targets
 * root the loader reads: mpfb_body.py:91-99, same scanned subdirs :102). */
export function listLoadableFaceTargetNames(targetsRoot?: string): Set<string> {
  const root =
    targetsRoot ??
    path.join(
      homedir(),
      "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/targets",
    );
  const names = new Set<string>();
  for (const sub of FACE_TARGET_LOADER_SUBDIRS) {
    for (const file of listTargetFilesRecursive(path.join(root, sub))) {
      names.add(shapeKeyNameForTargetFile(file));
    }
  }
  return names;
}

export type FaceTargetApplication = {
  applied: Array<{ name: string; weight: number }>;
  unapplied: Array<{ name: string; weight: number; reason: string }>;
  appliedBig: number;
  totalBig: number;
};

/** Partition fit file-weights into materializer-loadable (applied) vs not.
 * subOf maps each stem to its MPFB target subdir (from fit_file_weights). */
export function partitionFaceTargets(
  fileWeights: Record<string, number>,
  subOf: Record<string, string>,
  loadable: Set<string>,
): FaceTargetApplication {
  const applied: Array<{ name: string; weight: number }> = [];
  const unapplied: Array<{ name: string; weight: number; reason: string }> = [];
  const names = Object.keys(fileWeights).sort();
  for (const name of names) {
    const weight = fileWeights[name] as number;
    if (loadable.has(name)) {
      applied.push({ name, weight });
      continue;
    }
    const sub = subOf[name] ?? "unknown-subdir";
    let reason: string;
    if (name.startsWith("universal-")) {
      reason =
        `macro stem: no .target file exists; macros bake via derive_macro_dict ` +
        `(materialize_mpfb_humanoid_candidate.py:4046-4071), not --face-targets`;
    } else if (!(FACE_TARGET_LOADER_SUBDIRS as readonly string[]).includes(sub)) {
      reason =
        `family subdir '${sub}' is not scanned by load_mpfb_face_shape_keys ` +
        `(${FACE_TARGET_LOADER_FILE}); the loader's required_names lookup misses it ` +
        `and the materializer refuses unknown names loudly ` +
        `(materialize_mpfb_humanoid_candidate.py:5601-5606)`;
    } else {
      reason =
        `no .target file maps to '${name}' under the loader-scanned subdirs ` +
        `(${FACE_TARGET_LOADER_FILE}); passing it would refuse the bake ` +
        `(materialize_mpfb_humanoid_candidate.py:5601-5606)`;
    }
    unapplied.push({ name, weight, reason });
  }
  const big = (list: Array<{ weight: number }>): number =>
    list.filter((entry) => Math.abs(entry.weight) >= 0.05).length;
  return { applied, unapplied, appliedBig: big(applied), totalBig: big([...applied, ...unapplied]) };
}

/** Parse the materializer's FACE_TARGETS_APPLY count from a bake log.
 * Returns the logged weight count, or -1 when the marker is absent. */
export function faceTargetsLogCount(stdout: string): number {
  const marker = "FACE_TARGETS_APPLY ";
  const at = stdout.lastIndexOf(marker);
  if (at < 0) return -1;
  try {
    const tail = stdout.slice(at + marker.length);
    const logged = JSON.parse(
      tail.slice(0, tail.indexOf("\n") > 0 ? tail.indexOf("\n") : tail.length),
    ) as Record<string, number>;
    return Object.keys(logged).length;
  } catch {
    return -1;
  }
}

export type FitForStage = {
  weights: Record<string, unknown>;
  fileWeights: Record<string, number>;
  subOf: Record<string, string>;
  fitLogPath: string;
  weightsCopyPath: string;
  fileWeightsCopyPath: string;
  restored: boolean;
  stdout: string;
};

/** Run the face fit in place (snapshot/restore the tracked fit dir
 * byte-identical), copy the fresh weights into the out dir, and return them.
 * tag names the calling stage for the out-dir copies (stage4 | stage6). */
export function runFitForStage(fitCase: string, outDir: string, tag: string): FitForStage {
  const fitDir = path.join(repoRoot(), FIT_DIR_REL);
  const fitScript = path.join(repoRoot(), FIT_REL);
  const before = new Map<string, string>();
  const backedUp = new Map<string, Buffer>();
  for (const entry of readdirSync(fitDir)) {
    const abs = path.join(fitDir, entry);
    let stat: { isFile(): boolean };
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = readFileSync(abs);
    backedUp.set(entry, bytes);
    before.set(entry, sha256Bytes(bytes));
  }
  let stdout: string;
  try {
    stdout = runMisePython([fitScript, "--case", fitCase], 1_200_000);
  } catch (error) {
    for (const [entry, bytes] of backedUp) {
      writeFileSync(path.join(fitDir, entry), bytes);
    }
    throw error;
  }
  const fitLogPath = path.join(outDir, `${tag}-fit.log`);
  writeFileSync(fitLogPath, stdout.slice(-200_000));
  const weightsName = `fit_weights_${fitCase}.json`;
  const fileWeightsName = `fit_file_weights_${fitCase}.json`;
  const weightsCopyPath = path.join(outDir, `${tag}-fit-weights.json`);
  const fileWeightsCopyPath = path.join(outDir, `${tag}-fit-file-weights.json`);
  copyFileSync(path.join(fitDir, weightsName), weightsCopyPath);
  copyFileSync(path.join(fitDir, fileWeightsName), fileWeightsCopyPath);
  const fileWeightsDoc = JSON.parse(readFileSync(fileWeightsCopyPath, "utf8")) as {
    fileWeights?: Record<string, number>;
    subOf?: Record<string, string>;
  };
  const weights = JSON.parse(readFileSync(weightsCopyPath, "utf8")) as Record<string, unknown>;
  for (const [entry, bytes] of backedUp) {
    writeFileSync(path.join(fitDir, entry), bytes);
  }
  for (const entry of readdirSync(fitDir)) {
    if (!backedUp.has(entry)) {
      // Remove only files the fit created; never touch directories
      // (__pycache__ and the like are outside the tracked snapshotted set).
      try {
        if (statSync(path.join(fitDir, entry)).isFile()) {
          rmSync(path.join(fitDir, entry), { force: true });
        }
      } catch {
        // Unstatable entry: leave it; the restored check below will catch drift.
      }
    }
  }
  const restored = readdirSync(fitDir)
    .filter((entry) => {
      try {
        return statSync(path.join(fitDir, entry)).isFile();
      } catch {
        return false;
      }
    })
    .every((entry) => {
      const prior = before.get(entry);
      if (prior === undefined) return false;
      try {
        return sha256File(path.join(fitDir, entry)) === prior;
      } catch {
        return false;
      }
    });
  return {
    weights,
    fileWeights: fileWeightsDoc.fileWeights ?? {},
    subOf: fileWeightsDoc.subOf ?? {},
    fitLogPath,
    weightsCopyPath,
    fileWeightsCopyPath,
    restored,
    stdout,
  };
}
