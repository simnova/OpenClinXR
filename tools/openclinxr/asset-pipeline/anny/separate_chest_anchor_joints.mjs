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
// Existing epsilon reused by the repair mode: keyframes within this of 0 count as
// midline-pinned and within this of the joint rest X count as already valid.
const REPAIR_EPS = 1e-6;
// Explicit opt-in repair mode is a boolean flag (no value). It is the ONLY new CLI
// surface; --input/--output/--report keep their exact meaning in both modes.
const BOOLEAN_FLAGS = new Set(["repair-collapsed-animations"]);

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      args.set(name, "1");
      continue;
    }
    args.set(name, argv[index + 1]);
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
// Opt-in repair mode for already-separated rigs whose grafted walk samplers pin the
// breasts to the midline. DEFAULT (flag absent) behaviour below is unchanged.
const repairMode = args.get("repair-collapsed-animations") === "1";
const halfSpanM = Number(args.get("half-span-m") ?? HALF_SPAN_DEFAULT_M);
if (!repairMode && !(halfSpanM > 0.03 && halfSpanM < 0.125)) {
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

if (repairMode) {
  await repairCollapsedAnimations({
    document,
    nodes,
    inputPath,
    outputPath,
    reportPath,
    beforeLeftX,
    beforeRightX,
    beforeSpan,
    clavicleSpan,
  });
  process.exit(0);
}

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

/**
 * Opt-in `--repair-collapsed-animations` mode: rest-separated rigs whose grafted
 * walk samplers pin breasts to the midline. DEFAULT path above is unchanged.
 * Fail-closed: valid mirrored symmetric rest within existing bounds (0.03,0.125),
 * span above clavicle and <=0.25; rest TRS never written; only breast TRANSLATION
 * channels with EVERY X within 1e-6 of midline restore to the joint's own rest X
 * (no new span); already-at-rest and meaningful-dynamic curves unchanged; mixed/
 * wrong-offset ambiguous, malformed (incl. non-finite VEC3), CUBICSPLINE, shared
 * output aliased to an innocent channel, or nothing-pinned all throw. Same-side
 * same-value duplicate sharing one output is repaired once.
 */
async function repairCollapsedAnimations({
  document,
  nodes,
  inputPath,
  outputPath,
  reportPath,
  beforeLeftX,
  beforeRightX,
  beforeSpan,
  clavicleSpan,
}) {
  const restX = { "breast.L": beforeLeftX, "breast.R": beforeRightX };

  // Already-valid separated symmetric rest within the existing anatomic bounds.
  if (!(beforeLeftX > 0) || !(beforeRightX < 0)) {
    throw new Error(
      `--repair-collapsed-animations requires an already-separated mirrored rest ` +
        `(breast.L x>0, breast.R x<0); got L=${beforeLeftX} R=${beforeRightX} in ${inputPath}; refusing`,
    );
  }
  if (Math.abs(Math.abs(beforeLeftX) - Math.abs(beforeRightX)) > REPAIR_EPS) {
    throw new Error(
      `--repair-collapsed-animations requires a symmetric rest ` +
        `(|L|==|R| within 1e-6); got L=${beforeLeftX} R=${beforeRightX} in ${inputPath}; refusing`,
    );
  }
  for (const [name, x] of [["breast.L", beforeLeftX], ["breast.R", beforeRightX]]) {
    if (!(Math.abs(x) > 0.03 && Math.abs(x) < 0.125)) {
      throw new Error(
        `--repair-collapsed-animations requires each rest |x| inside the existing ` +
          `(0.03, 0.125) half-span bounds; got ${name} x=${x} in ${inputPath}; refusing`,
      );
    }
  }
  if (!(beforeSpan <= 0.25)) {
    throw new Error(
      `--repair-collapsed-animations requires rest span at or under the existing ` +
        `0.25 m anatomical ceiling; got ${beforeSpan} in ${inputPath}; refusing`,
    );
  }
  if (!(beforeSpan > clavicleSpan)) {
    throw new Error(
      `--repair-collapsed-animations requires rest span above the in-file clavicle ` +
        `span (${clavicleSpan}); got ${beforeSpan} in ${inputPath}; refusing`,
    );
  }

  // Snapshot rest TRS so preservation is asserted, not assumed.
  const restTRS = new Map();
  for (const { name } of [LEFT, RIGHT]) {
    const node = nodes.get(name);
    restTRS.set(name, {
      translation: [...node.getTranslation()],
      rotation: [...node.getRotation()],
      scale: [...node.getScale()],
    });
  }

  // Index output-accessor users across every sampler/channel before mutating:
  // two distinct samplers may still share one output accessor, so a sampler-keyed
  // guard would miss the alias and corrupt the innocent joint on write.
  const outputUsers = new Map();
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      if (!sampler) continue;
      const out = sampler.getOutput();
      if (!out) continue;
      const target = channel.getTargetNode();
      const entry = { animation: animation.getName(), node: target?.getName() ?? null, path: channel.getTargetPath() };
      const list = outputUsers.get(out) ?? [];
      list.push(entry);
      outputUsers.set(out, list);
    }
  }

  const animationChannelsRepaired = [];
  const animationChannelsUnchanged = [];
  const repairedOutputs = new Set();

  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (!target) continue;
      const side = [LEFT, RIGHT].find(({ name }) => name === target.getName());
      if (!side) continue;
      if (channel.getTargetPath() !== TARGET_PATH_TRANSLATION) continue;

      const sampler = channel.getSampler();
      if (!sampler) {
        throw new Error(
          `translation channel for ${side.name} in ${animation.getName()} has no sampler; refusing`,
        );
      }
      if (sampler.getInterpolation() === "CUBICSPLINE") {
        throw new Error(
          `translation sampler for ${side.name} in ${animation.getName()} uses CUBICSPLINE ` +
            `interpolation (tangents interleaved with values); refusing rather than corrupting tangents`,
        );
      }
      const output = sampler.getOutput();
      const array = output?.getArray();
      if (!output || output.getType() !== "VEC3" || !array || array.length % 3 !== 0 || array.length === 0) {
        throw new Error(
          `translation sampler for ${side.name} in ${animation.getName()} is malformed ` +
            `(expected non-empty VEC3 output); refusing`,
        );
      }
      const input = sampler.getInput();
      if (!input || input.getCount() !== output.getCount()) {
        throw new Error(
          `translation sampler for ${side.name} in ${animation.getName()} has mismatched ` +
            `input/output key counts; refusing`,
        );
      }
      for (const v of array) {
        if (!Number.isFinite(v)) {
          throw new Error(
            `translation sampler for ${side.name} in ${animation.getName()} is malformed: carries a non-finite ` +
              `VEC3 component (${v}); refusing rather than publishing corrupt output`,
          );
        }
      }

      const targetRestX = restX[side.name];
      const xs = [];
      for (let i = 0; i < array.length; i += 3) xs.push(array[i]);
      const allPinned = xs.every((x) => Math.abs(x) <= REPAIR_EPS);
      const allAtRest = xs.every((x) => Math.abs(x - targetRestX) <= REPAIR_EPS);

      if (allAtRest) {
        animationChannelsUnchanged.push({
          animation: animation.getName(),
          joint: side.name,
          keyframes: xs.length,
          reason: "already_at_rest",
        });
        continue;
      }
      if (!allPinned) {
        const minAbs = Math.min(...xs.map((x) => Math.abs(x)));
        const range = Math.max(...xs) - Math.min(...xs);
        if (minAbs > REPAIR_EPS && range > REPAIR_EPS) {
          // Meaningful animated curve (varies away from the midline): preserve, never flatten.
          animationChannelsUnchanged.push({
            animation: animation.getName(),
            joint: side.name,
            keyframes: xs.length,
            reason: "meaningful_dynamic_preserved",
          });
          continue;
        }
        throw new Error(
          `translation sampler for ${side.name} in ${animation.getName()} is mixed/ambiguous ` +
            `(x range [${Math.min(...xs)}, ${Math.max(...xs)}], neither pinned at midline nor at ` +
            `rest ${targetRestX}); refusing rather than guessing a fix`,
        );
      }

      // Genuinely pinned at the midline: output-accessor aliasing guard before mutation.
      const users = outputUsers.get(output) ?? [];
      const conflicts = users.filter(
        (u) => !(u.node === side.name && u.path === TARGET_PATH_TRANSLATION),
      );
      if (conflicts.length > 0) {
        throw new Error(
          `translation sampler for ${side.name} in ${animation.getName()} output is shared with ` +
            `${conflicts.map((u) => `${u.node ?? "<no-target>"}:${u.path}`).join(", ")}; ` +
            `repairing X to ${targetRestX} would mutate an innocent channel; refusing (clone or refuse)`,
        );
      }
      if (repairedOutputs.has(output)) continue;
      for (let i = 0; i < array.length; i += 3) array[i] = targetRestX;
      repairedOutputs.add(output);
      animationChannelsRepaired.push({
        animation: animation.getName(),
        joint: side.name,
        keyframes: xs.length,
      });
    }
  }

  if (animationChannelsRepaired.length === 0) {
    throw new Error(
      `--repair-collapsed-animations found no midline-pinned breast translation channels in ` +
        `${inputPath} (rest span ${beforeSpan.toFixed(5)} m already valid); nothing to repair; refusing ` +
        `to write an identical output`,
    );
  }

  // Rest TRS must be exactly what it was: this mode never writes nodes.
  for (const { name } of [LEFT, RIGHT]) {
    const node = nodes.get(name);
    const snap = restTRS.get(name);
    const now = {
      translation: [...node.getTranslation()],
      rotation: [...node.getRotation()],
      scale: [...node.getScale()],
    };
    for (const key of ["translation", "rotation", "scale"]) {
      if (snap[key].length !== now[key].length || snap[key].some((v, i) => v !== now[key][i])) {
        throw new Error(`rest ${key} of ${name} changed during animation repair; aborting`);
      }
    }
  }

  const tempOutputPath = inputPath === outputPath ? `${outputPath}.chest-anchor.tmp.glb` : outputPath;
  await io.write(tempOutputPath, document);
  if (tempOutputPath !== outputPath) renameSync(tempOutputPath, outputPath);

  const handoff = {
    schemaVersion: "openclinxr.generated-humanoid-chest-anchor-animation-repair.v1",
    repairCollapsedAnimations: true,
    separationApplied: false,
    stage: "post_blender_glb_chest_anchor_animation_repair",
    restPreservedExactly: true,
    joints: {
      "breast.L": { beforeX: beforeLeftX, afterX: beforeLeftX },
      "breast.R": { beforeX: beforeRightX, afterX: beforeRightX },
    },
    chestSpanM: { before: beforeSpan, after: beforeSpan },
    clavicleSpanM: clavicleSpan,
    maxChestSeparationM: 0.25,
    animationChannelsRepaired,
    animationChannelsUnchanged,
    claimScope: "mpfb_shipped_rig_collapsed_walk_sampler_restoration_to_own_rest",
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
      chestSpanM: { before: Number(beforeSpan.toFixed(5)), after: Number(beforeSpan.toFixed(5)) },
      clavicleSpanM: Number(clavicleSpan.toFixed(5)),
      animationChannelsRepaired,
    }),
  );
}
