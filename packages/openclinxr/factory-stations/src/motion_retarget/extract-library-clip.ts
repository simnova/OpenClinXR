import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";

/**
 * Pull ONE named clip out of a stacked animation library and write a single-clip GLB the bind
 * stage can consume.
 *
 * WHY THIS EXISTS, measured 2026-08-21 and re-measured 2026-09-09. The Mesh2Motion human library
 * is one GLB carrying 87 animations against a single 66-joint rig. Blender's glTF importer STACKS
 * them: `seated-clip-source-validate.json` recorded that after importing the raw library the active
 * action was `Chest_Open`, so a `load_and_retarget` against the library binds whichever clip the
 * importer happened to leave active — the wrong motion, silently, with a correct-looking report.
 * The seated bind (#557) worked around it with a hand-run extraction and only described the step in
 * prose (`extractionNote`). This is that step as a tool, so the next clip does not repeat it.
 *
 * IT REFUSES rather than guessing. An absent clip name lists what the library does carry; a library
 * that ends up with anything other than exactly one animation is a failure, not a warning, because
 * a second surviving clip is exactly the defect the extraction exists to remove.
 *
 * CLAIM SCOPE: byte-level clip isolation from one library GLB. NOT EVIDENCE FOR the clip's licence,
 * its motion quality, or that it binds to any particular target rig.
 */

export type LibraryClipExtractionReport = {
  schemaVersion: "openclinxr.library-clip-extraction.v1";
  generatedAt: string;
  source: { path: string; sha256: string; bytes: number; clipCount: number; clipNames: string[] };
  clip: {
    name: string;
    channels: number;
    joints: number;
    keyframes: number;
    durationSeconds: number;
    /** Net world translation of the root joint across the clip. Zero means an in-place cycle. */
    rootTranslationNetMeters: number;
    rootJoint: string;
  };
  output: { path: string; sha256: string; bytes: number; animationsAfter: string[]; nodeCount: number };
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function extractLibraryClip(input: {
  libraryPath: string;
  clipName: string;
  outputPath: string;
  /** Joint whose translation track decides whether the clip carries root motion. */
  rootJoint?: string;
}): Promise<LibraryClipExtractionReport> {
  const io = new NodeIO();
  const sourceBytes = await readFile(input.libraryPath);
  const document = await io.read(input.libraryPath);
  const animations = document.getRoot().listAnimations();
  const clipNames = animations.map((animation) => animation.getName());
  const wanted = animations.find((animation) => animation.getName() === input.clipName);
  if (!wanted) {
    throw new Error(
      `extractLibraryClip: ${input.libraryPath} has no clip named ${input.clipName}. Present (${clipNames.length}): ${clipNames.join(", ")}`,
    );
  }

  const rootJoint = input.rootJoint ?? "root";
  const channels = wanted.listChannels();
  const joints = new Set(channels.map((channel) => channel.getTargetNode()?.getName() ?? "(unnamed)"));
  let keyframes = 0;
  let durationSeconds = 0;
  for (const channel of channels) {
    const input_ = channel.getSampler()?.getInput();
    if (!input_) continue;
    keyframes = Math.max(keyframes, input_.getCount());
    const times = input_.getArray();
    if (times && times.length > 0) durationSeconds = Math.max(durationSeconds, Number(times[times.length - 1]));
  }
  const rootTranslation = channels.find(
    (channel) => channel.getTargetNode()?.getName() === rootJoint && channel.getTargetPath() === "translation",
  );
  let rootTranslationNetMeters = 0;
  const rootArray = rootTranslation?.getSampler()?.getOutput()?.getArray();
  if (rootArray && rootArray.length >= 6) {
    const last = rootArray.length - 3;
    rootTranslationNetMeters = Math.hypot(
      Number(rootArray[last]) - Number(rootArray[0]),
      Number(rootArray[last + 1]) - Number(rootArray[1]),
      Number(rootArray[last + 2]) - Number(rootArray[2]),
    );
  }

  for (const animation of animations) {
    if (animation.getName() !== input.clipName) animation.dispose();
  }
  await document.transform(prune());

  const animationsAfter = document.getRoot().listAnimations().map((animation) => animation.getName());
  if (animationsAfter.length !== 1 || animationsAfter[0] !== input.clipName) {
    throw new Error(
      `extractLibraryClip: refused — after extraction the document carries ${animationsAfter.length} animation(s) (${animationsAfter.join(", ")}) rather than exactly ${input.clipName}. A second surviving clip is the stacking defect this tool exists to remove.`,
    );
  }

  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await io.write(input.outputPath, document);
  const outputBytes = await readFile(input.outputPath);

  return {
    schemaVersion: "openclinxr.library-clip-extraction.v1",
    generatedAt: new Date().toISOString(),
    source: {
      path: input.libraryPath,
      sha256: sha256(sourceBytes),
      bytes: sourceBytes.byteLength,
      clipCount: clipNames.length,
      clipNames,
    },
    clip: {
      name: input.clipName,
      channels: channels.length,
      joints: joints.size,
      keyframes,
      durationSeconds,
      rootTranslationNetMeters,
      rootJoint,
    },
    output: {
      path: input.outputPath,
      sha256: sha256(outputBytes),
      bytes: outputBytes.byteLength,
      animationsAfter,
      nodeCount: document.getRoot().listNodes().length,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const libraryPath = flagValue("--library");
  const clipName = flagValue("--clip");
  const outputPath = flagValue("--output");
  if (!libraryPath || !clipName || !outputPath) {
    throw new Error("extract-library-clip: --library, --clip and --output are all required.");
  }
  const report = await extractLibraryClip({ libraryPath, clipName, outputPath });
  const reportPath = flagValue("--report") ?? `${outputPath.replace(/\.glb$/u, "")}-extraction.json`;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${reportPath}\n`);
}

if (process.argv[1]?.endsWith("extract-library-clip.ts")) await main();
