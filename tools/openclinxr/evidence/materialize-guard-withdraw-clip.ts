/**
 * materialize-guard-withdraw-clip.ts — inject a LoopOnce guard/withdraw flinch clip
 * into a patient GLB (no Blender), for the animation-driven clinical-touch interaction.
 *
 * The clip `openclinxr_role_patient_guard_withdraw_rlq` is a short 3-keyframe upper-body
 * flinch: rest -> guard peak (torso recoil + protective hand toward abdomen/RLQ +
 * head dip) -> rest. Runtime plays it once on examinee touch of a guarding region.
 *
 * Landmarks resolve through `resolvePoseBone` against sanitised names; channels bind the
 * actual dotted GLB node names. Required MPFB targets must all resolve uniquely.
 * Rotation-only, rest-relative keys. A missing required joint refuses before any write.
 *
 * notEvidenceFor: clinical_validity / biomechanical_validity / production_animation_quality.
 *
 * Run: tsx tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts \
 *   --glb <in.glb> --out <out.glb> --backup <bak.glb> --report <report.json>
 * Aliases: --input/--output also accepted. All four flags are required.
 * Old Anny cagematch / docs/openclinxr report defaults are forbidden.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { Accessor, type Node as GltfNode, NodeIO } from "@gltf-transform/core";
import { PropertyBinding } from "three";
import { resolvePoseBone } from "../../../packages/openclinxr/asset-registry/src/pose-bone-resolver.js";

const ANIMATION_NAME = "openclinxr_role_patient_guard_withdraw_rlq";
/** Legacy clip name disposed on inject so renames do not leave dual clips. */
const LEGACY_ANIMATION_NAME = "openclinxr_role_patient_guard_withdraw";

/** Keyframe times (seconds): rest -> guard peak -> rest. LoopOnce short flinch. */
const KEYFRAME_TIMES = [0.0, 0.28, 0.85];

const REQUIRED_UNIQUE_ACTUAL_NODES = ["spine03", "spine01", "head", "upperarm01.R", "lowerarm01.R"] as const;

type CliOptions = {
  inputPath: string;
  outputPath: string;
  backupPath: string;
  reportPath: string;
  provenancePath?: string;
  provenanceRoot?: string;
};

type PoseTrack = {
  nodeNames: string[];
  eulerFrames: { x: number; y: number; z: number }[];
};

function z0(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

/**
 * RLQ guard/withdraw: torso recoils, head dips, right hand protects abdomen/RLQ,
 * left arm lightly braces. Canonical landmarks resolve via resolvePoseBone; rest/guard/rest.
 */
const guardWithdrawRlq: PoseTrack[] = [
  {
    nodeNames: ["spine"],
    eulerFrames: [z0(), { x: -0.12, y: 0.08, z: 0.04 }, z0()],
  },
  {
    nodeNames: ["chest"],
    eulerFrames: [z0(), { x: -0.14, y: 0.1, z: 0.05 }, z0()],
  },
  {
    nodeNames: ["head"],
    eulerFrames: [z0(), { x: 0.18, y: -0.08, z: 0.0 }, z0()],
  },
  {
    nodeNames: ["upper_arm.L", "upper_armL"],
    eulerFrames: [z0(), { x: -0.18, y: -0.1, z: -0.12 }, z0()],
  },
  {
    nodeNames: ["upper_arm.R", "upper_armR"],
    // Right upper arm draws hand toward lower abdomen / RLQ
    eulerFrames: [z0(), { x: -0.72, y: 0.35, z: 0.62 }, z0()],
  },
  {
    nodeNames: ["forearm.L", "forearmL"],
    eulerFrames: [z0(), { x: -0.25, y: 0.0, z: 0.08 }, z0()],
  },
  {
    nodeNames: ["forearm.R", "forearmR"],
    // Strong flex so hand reaches RLQ/abdomen
    eulerFrames: [z0(), { x: -1.05, y: 0.05, z: 0.2 }, z0()],
  },
  {
    nodeNames: ["hand.L", "handL"],
    eulerFrames: [z0(), { x: 0.04, y: 0.04, z: -0.04 }, z0()],
  },
  {
    nodeNames: ["hand.R", "handR"],
    // Protective palm orientation toward abdomen/RLQ
    eulerFrames: [z0(), { x: -0.28, y: 0.18, z: 0.12 }, z0()],
  },
];

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(
      [
        "Usage: tsx tools/openclinxr/evidence/materialize-guard-withdraw-clip.ts \\",
        "  --glb <in.glb> --out <out.glb> --backup <bak.glb> --report <report.json>",
        "  [--provenance <sidecar.json> syncs root outputSha256/outputBytes to produced bytes]",
        "Aliases: --input, --output. All four flags are required.",
        "Do not use the old Anny cagematch default or docs/openclinxr report path.",
        "",
      ].join("\n"),
    );
    return;
  }
  const preflight = parsed.provenancePath
    ? await preflightProvenance(parsed.provenancePath, parsed.outputPath, parsed.inputPath, parsed.provenanceRoot)
    : null;
  const report = await materializeGuardWithdrawClip(parsed);
  await mkdir(path.dirname(parsed.reportPath), { recursive: true });
  await writeFile(parsed.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Injected ${ANIMATION_NAME} (${report.appliedNodeCount} nodes) into ${parsed.outputPath}`);
  console.log(`Wrote ${parsed.reportPath}`);
  if (parsed.provenancePath && preflight) {
    const synced = await syncProvenanceOutput(parsed.provenancePath, parsed.outputPath, preflight.provenance);
    console.log(`Synced ${parsed.provenancePath}: sha=${synced.sha256} bytes=${synced.bytes}`);
  }
}

function sanitiseBoneName(name: string): string {
  return PropertyBinding.sanitizeNodeName(name);
}

/**
 * Preflight + sync for a provenance sidecar. Validates BEFORE any backup/output/
 * report/sidecar write: sidecar JSON parses, assetPath names the canonical
 * repo-relative output path, and any existing root outputSha256/outputBytes match
 * the actual pre-write input bytes. Returns the declared output + root.
 */
async function preflightProvenance(
  provenancePath: string,
  outputPath: string,
  inputPath: string,
  provenanceRoot?: string,
): Promise<{ root: string; provenance: Record<string, unknown> }> {
  const raw = await readFile(provenancePath, "utf8").catch(() => {
    throw new Error(`Provenance ${provenancePath} missing or unreadable; refusing to write.`);
  });
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Provenance ${provenancePath} is not valid JSON; refusing to write.`);
  }
  const root = provenanceRoot ?? process.cwd();
  const declaredAsset = record["assetPath"];
  if (typeof declaredAsset !== "string" || declaredAsset.length === 0) {
    throw new Error(`Provenance ${provenancePath} carries no assetPath; refusing to write.`);
  }
  if (
    path.isAbsolute(declaredAsset) ||
    declaredAsset.split("/").includes("..") ||
    declaredAsset.split("\\").includes("..")
  ) {
    throw new Error(
      `Provenance assetPath ${declaredAsset} is not a safe repo-relative path; refusing to write.`,
    );
  }
  const resolvedDeclared = path.resolve(root, declaredAsset);
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedDeclared !== resolvedOutput) {
    throw new Error(
      `Provenance assetPath ${declaredAsset} does not resolve (against root ${root}) to ${outputPath}; refusing to write.`,
    );
  }
  const inputBytes = await readFile(inputPath);
  const inputSha = createHash("sha256").update(inputBytes).digest("hex");
  const declaredSha = record["outputSha256"];
  const declaredBytes = record["outputBytes"];
  if (
    typeof declaredSha !== "string" ||
    !/^[0-9a-f]{64}$/.test(declaredSha) ||
    typeof declaredBytes !== "number" ||
    !Number.isInteger(declaredBytes) ||
    declaredBytes < 0
  ) {
    throw new Error(
      `Provenance ${provenancePath} receipt incomplete (require lowercase sha256 + finite byte count); refusing to write.`,
    );
  }
  if (declaredSha !== inputSha || declaredBytes !== inputBytes.length) {
    throw new Error(
      `Provenance receipt mismatch: sidecar (${declaredSha}/${declaredBytes}) != input bytes (${inputSha}/${inputBytes.length}); refusing to write.`,
    );
  }
  return { root, provenance: record };
}

/**
 * Sync a provenance sidecar's root outputSha256/outputBytes to the bytes the
 * producer just wrote. Verifies the sidecar already names the canonical
 * repo-relative assetPath (refuses without writing on mismatch) and preserves
 * source epoch, lineage, and all other fields — only the two root output fields move.
 */
async function syncProvenanceOutput(
  provenancePath: string,
  outputPath: string,
  record: Record<string, unknown>,
): Promise<{ sha256: string; bytes: number }> {
  const bytes = await readFile(outputPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  record["outputSha256"] = sha256;
  record["outputBytes"] = bytes.length;
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { sha256, bytes: bytes.length };
}

function restRotation(node: GltfNode): [number, number, number, number] {
  const rotation = node.getRotation();
  if (!rotation || rotation.length < 4) return [0, 0, 0, 1];
  return [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1];
}

function unitQuat(q: readonly [number, number, number, number]): [number, number, number, number] {
  const mag = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(mag > 0)) return [0, 0, 0, 1];
  return [q[0] / mag, q[1] / mag, q[2] / mag, q[3] / mag];
}

function multiplyQuat(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function indexNodesBySanitisedName(nodes: readonly GltfNode[]): Map<string, GltfNode[]> {
  const index = new Map<string, GltfNode[]>();
  for (const node of nodes) {
    const key = sanitiseBoneName(node.getName());
    const list = index.get(key) ?? [];
    list.push(node);
    index.set(key, list);
  }
  return index;
}

type TrackResolution =
  | { ok: true; node: GltfNode; actualName: string; landmark: string }
  | { ok: false; missing: string; uniqueFailure?: string };

function resolveTrackNode(
  track: PoseTrack,
  jointNames: ReadonlySet<string>,
  index: Map<string, GltfNode[]>,
): TrackResolution {
  const tried: string[] = [];
  for (const candidate of track.nodeNames) {
    const landmark = sanitiseBoneName(candidate);
    tried.push(`${candidate}->${landmark}`);
    const resolved = resolvePoseBone(landmark, jointNames);
    if (resolved === null) continue;
    const matches = index.get(resolved) ?? [];
    if (matches.length > 1) {
      return {
        ok: false,
        missing: track.nodeNames.join("|"),
        uniqueFailure: `${resolved} matched ${matches.map((match) => match.getName()).join(",")}`,
      };
    }
    const node = matches[0];
    if (!node) continue;
    return { ok: true, node, actualName: node.getName(), landmark };
  }
  return { ok: false, missing: `${track.nodeNames.join("|")} (${tried.join("; ")})` };
}

async function materializeGuardWithdrawClip(options: CliOptions): Promise<Record<string, unknown>> {
  const io = new NodeIO();
  const document = await io.read(options.inputPath);
  const root = document.getRoot();
  const nodes = root.listNodes();
  const index = indexNodesBySanitisedName(nodes);
  const jointNames = new Set(index.keys());

  const resolvedTracks: Array<{
    track: PoseTrack;
    node: GltfNode;
    actualName: string;
    landmark: string;
  }> = [];
  const missing: string[] = [];
  const uniqueFailures: string[] = [];
  const seenActual = new Set<string>();

  for (const track of guardWithdrawRlq) {
    const resolved = resolveTrackNode(track, jointNames, index);
    if (!resolved.ok) {
      if (resolved.uniqueFailure) uniqueFailures.push(resolved.uniqueFailure);
      missing.push(resolved.missing);
      continue;
    }
    if (/root|pelvis|leg|foot|toe/i.test(resolved.actualName)) {
      missing.push(`${resolved.actualName} (forbidden support/lower-body target)`);
      continue;
    }
    if (seenActual.has(resolved.actualName)) {
      uniqueFailures.push(`duplicate bind ${resolved.actualName}`);
      continue;
    }
    seenActual.add(resolved.actualName);
    resolvedTracks.push({
      track,
      node: resolved.node,
      actualName: resolved.actualName,
      landmark: resolved.landmark,
    });
  }

  const missingRequired = REQUIRED_UNIQUE_ACTUAL_NODES.filter((name) => !seenActual.has(name));
  if (uniqueFailures.length > 0 || missingRequired.length > 0) {
    throw new Error(
      `Missing required joint(s) for ${ANIMATION_NAME}; refusing to publish ${options.outputPath}. ` +
        `Missing: ${missingRequired.join(", ") || "(none)"}. ` +
        `Landmarks: upper_armR forearmR spine chest head. ` +
        (uniqueFailures.length > 0 ? `Unique failures: ${uniqueFailures.join("; ")}. ` : "") +
        (missing.length > 0 ? `Unresolved: ${missing.join(", ")}` : ""),
    );
  }

  await mkdir(path.dirname(options.backupPath), { recursive: true });
  await cp(options.inputPath, options.backupPath);

  const buffer = root.listBuffers()[0] ?? document.createBuffer("guard_withdraw_rlq_buffer");

  // Dispose target name and legacy name so renames do not leave dual clips.
  for (const existing of root.listAnimations().filter((clip) => {
    const name = clip.getName();
    return name === ANIMATION_NAME || name === LEGACY_ANIMATION_NAME;
  })) {
    existing.dispose();
  }

  const inputAccessor = document
    .createAccessor(`${ANIMATION_NAME}_times`)
    .setArray(new Float32Array(KEYFRAME_TIMES))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const animation = document.createAnimation(ANIMATION_NAME);
  const applied: string[] = [];

  for (const { track, node, actualName } of resolvedTracks) {
    const rest = restRotation(node);
    const quats = track.eulerFrames.flatMap((e) =>
      unitQuat(multiplyQuat(rest, eulerXyzToQuaternion(e.x, e.y, e.z))),
    );
    const outputAccessor = document
      .createAccessor(`${ANIMATION_NAME}_${actualName}_rotation`)
      .setArray(new Float32Array(quats))
      .setType(Accessor.Type.VEC4)
      .setBuffer(buffer);
    const sampler = document
      .createAnimationSampler(`${ANIMATION_NAME}_${actualName}_sampler`)
      .setInput(inputAccessor)
      .setOutput(outputAccessor)
      .setInterpolation("LINEAR");
    const channel = document
      .createAnimationChannel(`${ANIMATION_NAME}_${actualName}_channel`)
      .setSampler(sampler)
      .setTargetNode(node)
      .setTargetPath("rotation");
    animation.addSampler(sampler);
    animation.addChannel(channel);
    node.setExtras({
      ...node.getExtras(),
      openClinXrGuardWithdrawClip: ANIMATION_NAME,
    });
    applied.push(actualName);
  }

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await io.write(options.outputPath, document);

  // Verify clip present after injection (re-read output).
  const verifyDoc = await io.read(options.outputPath);
  const verified = verifyDoc
    .getRoot()
    .listAnimations()
    .some((a) => a.getName() === ANIMATION_NAME);
  if (!verified) {
    throw new Error(
      `Verification failed: animation "${ANIMATION_NAME}" missing from ${options.outputPath} after write.`,
    );
  }
  // Ensure legacy name is not left behind.
  const legacyStillPresent = verifyDoc
    .getRoot()
    .listAnimations()
    .some((a) => a.getName() === LEGACY_ANIMATION_NAME);
  if (legacyStillPresent) {
    throw new Error(
      `Verification failed: legacy animation "${LEGACY_ANIMATION_NAME}" still present in ${options.outputPath}.`,
    );
  }

  return {
    schemaVersion: "openclinxr.materialize-guard-withdraw-clip.v1",
    generatedAt: new Date().toISOString(),
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    backupPath: options.backupPath,
    animationName: ANIMATION_NAME,
    legacyAnimationNameDisposed: LEGACY_ANIMATION_NAME,
    keyframeTimes: KEYFRAME_TIMES,
    appliedNodeCount: applied.length,
    appliedNodes: applied,
    missingNodes: missing,
    verified: true,
    claimBoundaries: {
      claimScope: "animation_interaction_response_not_clinical_validity",
      notEvidenceFor: [
        "clinical_validity",
        "biomechanical_validity",
        "production_animation_quality",
        "quest_readiness",
      ],
    },
  };
}

function eulerXyzToQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function parseArgs(args: string[]): CliOptions | { help: true } {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options: Partial<CliOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--glb" || arg === "--input") {
      options.inputPath = requireNext(args, ++index, arg);
    } else if (arg === "--out" || arg === "--output") {
      options.outputPath = requireNext(args, ++index, arg);
    } else if (arg === "--backup") {
      options.backupPath = requireNext(args, ++index, arg);
    } else if (arg === "--report") {
      options.reportPath = requireNext(args, ++index, arg);
    } else if (arg === "--provenance") {
      options.provenancePath = requireNext(args, ++index, arg);
    } else if (arg === "--provenance-root") {
      options.provenanceRoot = requireNext(args, ++index, arg);
    }
  }
  if (!options.inputPath || !options.outputPath || !options.backupPath || !options.reportPath) {
    throw new Error(
      "Required flags: --glb|--input, --out|--output, --backup, --report. " +
        "Old Anny cagematch and docs/openclinxr report defaults are forbidden. See --help.",
    );
  }
  return {
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    backupPath: options.backupPath,
    reportPath: options.reportPath,
    provenancePath: options.provenancePath,
    provenanceRoot: options.provenanceRoot,
  };
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

await main();
