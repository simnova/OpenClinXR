#!/usr/bin/env node
/**
 * Lateral separation of the two chest anchor joints in a shipped MPFB rig GLB.
 *
 * OBSERVABLE (measured 2026-09-03 at 1bab31eb, mpfb-clinical-nurse-adult.glb): the rig's
 * breast.L / breast.R joints occupy the SAME point on the midline, so a goal aimed at
 * `rightChestSurface` resolves to the sternum. Local translations in metres, both joints
 * identical to spine01:
 *
 *   breast.L      ( 0.00000, 0.16119,  0.00000)
 *   breast.R      ( 0.00000, 0.16119,  0.00000)
 *   clavicle.L    ( 0.02434, 0.08085,  0.02208)   mirrors: +/- 0.02434 on x
 *   clavicle.R    (-0.02434, 0.08085, 0.02208)
 *
 * PRODUCER TRACE (answers the card's open question): MPFB emits the collapse UPSTREAM, in the
 * addon's own rig data (`data/rigs/standard/rig.default.json` and `rig.default_no_toes.json`,
 * MPFB 2.0.15 on this machine). Both breast bones carry
 * `head: { strategy: "CUBE", cube_name: "joint-spine-1", default_position: [0, 0.0187, 0.421] }`
 * — the head is placed at the AABB centre of the spine joint vertex group, which is the
 * midline. The same rig entries give each breast bone a VERTEX tail at |x| ~= 0.102 (a real
 * surface vertex near the nipple line), so MPFB's own rig intends a lateral reach and only the
 * head (the joint position the runtime aims at) collapsed. There is no in-repo bake step that
 * flattens them; the collapse is the addon's authored value.
 *
 * THE OFFSET (measured before choosing, not invented): the in-file clavicle pair spans
 * 4.869 cm (floor: breasts sit lateral to clavicle roots), the anatomical 25 cm ceiling is the
 * RED's bound, and an adult nipple-to-nipple distance near 18-21 cm brackets the plausible
 * range. This tool defaults to a HALF-SPAN of 0.085 m (17 cm total separation) — the value the
 * RED's satisfiability probe flipped both clauses with — and moves ONLY x, mirroring the
 * convention the clavicle pair already follows in the same file. y and z are preserved.
 *
 * WHY THE ANIMATION SAMPLERS TOO: the GLB carries a ClinicalIdleConversation clip whose
 * translation channels pin breast.L / breast.R to the collapsed position on every keyframe.
 * Rest-node translation alone would be overridden while that clip plays, so the same delta is
 * applied to every translation keyframe of both joints. Rotation and scale channels are
 * untouched.
 *
 * SAFETY: the tool refuses to run when either joint is missing (nothing to fix, and the RED's
 * vacuity guard must stay live) and refuses when the joints already sit at |x| >= half the
 * half-span (do not clobber an already-separated or better-placed anchor).
 *
 * Run:
 *   node tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs \
 *     --input apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb \
 *     --report tools/openclinxr/evidence/chest-anchor-joints/mpfb-clinical-nurse-adult.json \
 *     --half-span-m 0.085
 */
import { NodeIO } from "@gltf-transform/core";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const HALF_SPAN_DEFAULT_M = 0.085;
const TARGET_PATH_TRANSLATION = "translation";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    args.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  return args;
}

function requireArg(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const inputPath = requireArg(args, "input");
const outputPath = args.get("output") ?? inputPath;
const reportPath = requireArg(args, "report");
const halfSpanM = Number(args.get("half-span-m") ?? HALF_SPAN_DEFAULT_M);
if (!(halfSpanM > 0.03 && halfSpanM < 0.125)) {
  throw new Error(
    `--half-span-m must be in (0.03, 0.125) so the chest pair clears the clavicle floor ` +
      `(~0.049 m in this file) and stays under the 0.25 m anatomical ceiling; got ${halfSpanM}`,
  );
}

const LEFT = { name: "breast.L", sign: 1 };
const RIGHT = { name: "breast.R", sign: -1 };

const io = new NodeIO();
const document = await io.read(inputPath);
const nodes = new Map(
  document.getRoot().listNodes().map((n) => [n.getName(), n]),
);

for (const { name } of [LEFT, RIGHT]) {
  if (!nodes.has(name)) {
    throw new Error(`joint ${name} is absent from ${inputPath} — nothing to separate; refusing`);
  }
}

const readX = (name) => nodes.get(name).getTranslation()[0];
const beforeLeftX = readX(LEFT.name);
const beforeRightX = readX(RIGHT.name);
const beforeSpan = Math.abs(beforeLeftX - beforeRightX);
const clavicleSpan = Math.abs(
  readX("clavicle.L") - readX("clavicle.R"),
);

// Fail closed on already-separated anchors: if a later bake ever places these joints at a
// lateral reach of its own, overwriting it with this tool's constant would be a regression.
// Collapsed (or near-collapsed) is exactly the state this tool exists to repair.
const MIN_PLAUSIBLE_HALF_SPAN = halfSpanM / 2;
if (Math.abs(beforeLeftX) >= MIN_PLAUSIBLE_HALF_SPAN || Math.abs(beforeRightX) >= MIN_PLAUSIBLE_HALF_SPAN) {
  throw new Error(
    `breast.L x=${beforeLeftX.toFixed(5)} breast.R x=${beforeRightX.toFixed(5)} — at least one ` +
      `joint already sits at or beyond half the target half-span (${MIN_PLAUSIBLE_HALF_SPAN.toFixed(3)} m); ` +
      `refusing to clobber an already-separated anchor`,
  );
}

// Rest-pose node translations: set x = sign * halfSpan, preserve y/z.
for (const { name, sign } of [LEFT, RIGHT]) {
  const t = nodes.get(name).getTranslation();
  t[0] = sign * halfSpanM;
  nodes.get(name).setTranslation(t);
}

// Animation translation samplers targeting the two joints: same lateral move on every
// keyframe, so the runtime clip cannot pin the anchors back onto the midline.
const animationChannelsAdjusted = [];
for (const animation of document.getRoot().listAnimations()) {
  for (const channel of animation.listChannels()) {
    const target = channel.getTargetNode();
    if (!target || !nodes.has(target.getName())) continue;
    const side = [LEFT, RIGHT].find(({ name }) => name === target.getName());
    if (!side) continue;
    if (channel.getTargetPath() !== TARGET_PATH_TRANSLATION) continue;
    const output = channel.getSampler().getOutput();
    const array = output.getArray();
    if (output.getType() !== "VEC3" || !array) {
      throw new Error(
        `translation sampler for ${side.name} in ${animation.getName()} is not a VEC3 accessor`,
      );
    }
    let changed = 0;
    for (let i = 0; i < array.length; i += 3) {
      const next = side.sign * halfSpanM;
      if (Math.abs(array[i] - next) > 1e-6) changed += 1;
      array[i] = next;
    }
    if (changed > 0) {
      animationChannelsAdjusted.push({ animation: animation.getName(), joint: side.name, keyframes: array.length / 3 });
    }
  }
}

const tempOutputPath = inputPath === outputPath ? `${outputPath}.chest-anchor.tmp.glb` : outputPath;
await io.write(tempOutputPath, document);
if (tempOutputPath !== outputPath) renameSync(tempOutputPath, outputPath);

const afterLeftX = readX(LEFT.name);
const afterRightX = readX(RIGHT.name);
const afterSpan = Math.abs(afterLeftX - afterRightX);

const handoff = {
  schemaVersion: "openclinxr.generated-humanoid-chest-anchor-separation.v1",
  separationApplied: true,
  stage: "post_blender_glb_chest_anchor_lateral",
  halfSpanM,
  joints: {
    "breast.L": { beforeX: beforeLeftX, afterX: afterLeftX },
    "breast.R": { beforeX: beforeRightX, afterX: afterRightX },
  },
  chestSpanM: { before: beforeSpan, after: afterSpan },
  clavicleSpanM: clavicleSpan,
  maxChestSeparationM: 0.25,
  animationChannelsAdjusted,
  claimScope: "mpfb_shipped_rig_chest_anchor_lateral_separation_mirrored_about_midline",
  notEvidenceFor: [
    "what_any_still_shows",
    "b_plus_visual_realism_gate",
    "quest_readiness",
    "clinical_validity",
    "chest_anchor_height",
    "other_rigs",
  ],
};

writeJson(reportPath, { ...handoff, inputPath, outputPath, generatedAt: new Date().toISOString() });
console.log(
  JSON.stringify({
    outputPath,
    chestSpanM: { before: Number(beforeSpan.toFixed(5)), after: Number(afterSpan.toFixed(5)) },
    clavicleSpanM: Number(clavicleSpan.toFixed(5)),
    animationChannelsAdjusted,
  }),
);
