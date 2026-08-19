/**
 * E2 slice 2 (#419) — COLUMN A probe. Head-local skinned vertex deltas, speaking vs not.
 *
 * Reuses the E2.1 recipe (`speaking-actor-head-deformation.json`): playwright headless
 * chromium against the ui-xr portless dev server, page.evaluate on
 * `window.__openClinXrDebugScene` of `peds_asthma_parent_anxiety_v1`, dialogue driven by
 * trace-button clicks, speech flagged by phoneme-mouth-cue visibility on the actor root.
 *
 * ## THE MEASUREMENT
 *
 * Column A asks whether the #402 head spike is a skinned MESH artifact: a vertex moved by a
 * bad weight instead of by a bone. Bone frames cannot see it (E2.1, withdrawn), so this
 * samples per-vertex skinned positions in **head-bone local space**.
 *
 * The head-local frame is the head bone's full skinning composite
 * `(mesh.matrixWorld * boneWorld_head * boneInverse_head)` — the exact matrix the three.js
 * shader uses to place a 100%-head-weighted vertex. A vertex rigidly attached to the head
 * therefore has **exactly constant** head-local position across states (recorded as the
 * `headRigid100MaxDeltaMm` validity check), while a bad-weight fling, a stray influence, or
 * a speech morph shows up as a head-local delta. The spent quantities cannot produce this:
 * whole-body rigid displacement and root-relative bone articulation both cancel by
 * construction in this frame (they move the head bone and its rigid attachments together).
 *
 * Population: all skinned vertices of the actor; the answer column (`maxHeadLocalDeltaMm`)
 * is the max over vertices whose dominant joint is the head bone or a head descendant
 * (jaw/tongue/oris/eye/levator... — the head assembly, computed live from the skeleton
 * hierarchy). The all-vertices max is recorded separately because body vertices legitimately
 * swing relative to the head frame when the head articulates (that is the spent root-relative
 * signal in head-local clothing and is NOT the answer).
 *
 * ## CHEAP-FIX REFUSALS (from the planted contract header)
 *
 *   treatment                                                   | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) no head-local measurement                                |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) world-matrix delta again                                 |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   c) root-relative bone motion again (26.5 vs 19.7 mm)        |FAIL |FAIL | pass|FAIL | REFUSED
 *   d) parent only, no control                                  |pass |FAIL | pass|pass | REFUSED
 *   e) head-local skinned verts, both states, both actors       |pass |pass | pass|pass | ALL PASS
 *
 * NOT TESTED:
 *   - The cause. Naming a mechanism is a later slice.
 *   - Any fix. No runtime change is made here.
 *   - Whether the spike is visible. That is a pixel grade and it is the orchestrator's.
 *   - Hair-mesh weights specifically. Recording which mesh owns each extreme vertex is what
 *     lets a later slice separate body skin from fitted hair.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PARENT_ACTOR_ID = "parent_tara_johnson_v1";
const CHILD_ACTOR_ID = "patient_maya_johnson_v1";

/**
 * #433 — the parent's live morph population. The runtime loads this GLB for
 * `parent_tara_johnson_v1` (per humanoid-runtime-asset-url.ts; #431's still pair recorded the
 * same path). Both it and the non-motion-bind variant carry 32 morph targets (measured,
 * planted test header). The 32 NAMES below come from this file's extras.targetNames, walked
 * with NodeIO — never a literal list.
 */
const PARENT_MORPH_GLB_REL = "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
const EXPECTED_MORPH_TARGETS = 32;

/** Enumerate the morph target names from the GLB file itself (extras.targetNames, NodeIO walk). */
async function readMorphTargetNamesFromFile(rel: string): Promise<string[]> {
  const io = new NodeIO();
  const doc = await io.read(join(REPO_ROOT, rel));
  let best: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = (mesh.getExtras() ?? {}) as { targetNames?: string[] };
    const names = extras.targetNames ?? [];
    if (names.length > best.length) best = names;
  }
  if (best.length !== EXPECTED_MORPH_TARGETS) {
    throw new Error(`enumerated ${best.length} morph names from ${rel}, expected ${EXPECTED_MORPH_TARGETS}`);
  }
  if (new Set(best).size !== best.length) {
    throw new Error(`enumerated morph names from ${rel} are not distinct`);
  }
  return best;
}
const PARENT_TRACES = ["parent communication", "trigger history", "urgent escalation", "empathy statement"];
const CHILD_TRACES = ["work of breathing assessment", "inhaler history", "empathy statement"];

/** Same query as E2.1 so the sampled instants are comparable against its artifact. */
const CAPTURE_QUERY =
  "openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=face-detail" +
  "&openclinxrPortalStart=encounter" +
  "&openclinxrAcceleratedExam=1";

type MeshSample = {
  uuid: string;
  name: string;
  count: number;
  /** Per-vertex head-local positions, flat x,y,z triplets. */
  local: number[];
  /** Max |morphTargetInfluence| at the sampling instant (proves visemes were driven). */
  maxMorphInfluence: number;
  /**
   * Named per-morph influences via the runtime's own addressing (morphTargetDictionary is
   * populated from glTF extras.targetNames by GLTFLoader; the runtime drives speech through
   * the same dictionary — viseme-morph-apply.ts). #433: the E2.2 max is an unnamed aggregate,
   * so each target carries its own value here.
   */
  morphInfluences: Array<{ name: string; value: number }>;
};

type Stash = {
  stateId: string;
  speakingFlag: boolean | null;
  meshes: MeshSample[];
  headBoneName: string | null;
  headDescendantNames: string[];
  /** Per-bone world translation + the root bone translation, for the spent-quantity rows. */
  boneTranslations: number[][];
  rootTranslation: number[] | null;
  speechEvidence: unknown;
  playbackEvidence: unknown;
};

function samplerEvaluate(actorId: string, stateId: string): string {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
  return `(() => {
    const actorId = ${JSON.stringify(actorId)};
    const stateId = ${JSON.stringify(stateId)};
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const out = { actorId, stateId, ok: false, error: null, speakingFlag: null, meshCount: 0, totalVertexCount: 0, headBoneName: null, headDescendantCount: 0, assetPath: null };
    try {
      if (!scene || typeof scene.traverse !== "function") { out.error = "no-scene"; return out; }
      if (scene.updateMatrixWorld) scene.updateMatrixWorld(true);

      const roots = [];
      scene.traverse(function (o) {
        if (o.userData && o.userData.openClinXrActorId === actorId) roots.push(o);
      });
      if (roots.length === 0) { out.error = "no-actor-root:" + actorId; return out; }

      const meshes = [];
      const seen = {};
      for (const r of roots) {
        r.traverse(function (o) {
          if (o.isSkinnedMesh && o.geometry && !seen[o.uuid]) { seen[o.uuid] = true; meshes.push(o); }
        });
      }
      if (meshes.length === 0) { out.error = "no-skinned-meshes"; return out; }

      // Speaking flag: phoneme-mouth-cue visibility on the actor root (same as E2.1).
      let mouthCue = null;
      for (const r of roots) {
        r.traverse(function (o) {
          if (!mouthCue && o.userData && o.userData.openClinXrCurrentPhoneme !== undefined) mouthCue = o;
        });
      }
      out.speakingFlag = mouthCue ? !!mouthCue.visible : null;

      const meshRows = [];
      let headBoneName = null;
      let headList = [];
      let totalVertexCount = 0;
      let boneTranslations = null;
      let rootTranslation = null;

      for (const mesh of meshes) {
        const skeleton = mesh.skeleton;
        if (!skeleton || !skeleton.bones || skeleton.bones.length === 0) continue;
        const bones = skeleton.bones;
        const boneInverses = skeleton.boneInverses || [];
        const geom = mesh.geometry;
        const pos = geom.attributes.position;
        const skinIndex = geom.attributes.skinIndex;
        const skinWeight = geom.attributes.skinWeight;
        if (!pos || !skinIndex || !skinWeight) continue;

        let headBone = null;
        for (const b of bones) { if (b.name === "head") { headBone = b; break; } }
        if (!headBone) continue;
        headBoneName = headBone.name;
        if (headList.length === 0) {
          const headSet = {};
          headList = [];
          (function walk(b) {
            if (headSet[b.uuid]) return;
            headSet[b.uuid] = true;
            headList.push(b);
            const kids = b.children || [];
            for (const k of kids) walk(k);
          })(headBone);
        }
        // Full skinning composites: C_j = meshWorld * boneWorld_j * boneInverse_j
        const M = mesh.matrixWorld;
        const comps = [];
        for (let j = 0; j < bones.length; j++) {
          const bw = bones[j].matrixWorld;
          const bi = boneInverses[j];
          const tmp = new (bw.constructor)();
          tmp.multiplyMatrices(bw, bi);
          const full = new (bw.constructor)();
          full.multiplyMatrices(M, tmp);
          comps.push(full);
        }
        const headIdx = bones.indexOf(headBone);
        const headComposite = comps[headIdx];
        const headInv = new (headComposite.constructor)();
        headInv.copy(headComposite).invert();

        // Bone world translations (once — all meshes share the skeleton).
        if (boneTranslations === null) {
          boneTranslations = bones.map(function (b) {
            const e = b.matrixWorld.elements;
            return [e[12], e[13], e[14]];
          });
          for (const b of bones) { if (b.name === "root") { rootTranslation = [b.matrixWorld.elements[12], b.matrixWorld.elements[13], b.matrixWorld.elements[14]]; } }
        }

        const posArr = pos.array;
        const idxArr = skinIndex.array;
        const wArr = skinWeight.array;
        const count = pos.count;
        // Morph displacement (the GPU adds influence * morphTargetDelta to position BEFORE
        // skinning — speech is morph-driven, so a morph-less read sees a frozen face).
        const morphAttrs =
          geom.morphAttributes && geom.morphAttributes.position ? geom.morphAttributes.position : null;
        const influences = mesh.morphTargetInfluences || [];
        const morphCount = morphAttrs ? Math.min(morphAttrs.length, influences.length) : 0;
        let maxMorphInfluence = 0;
        for (let k = 0; k < morphCount; k++) {
          const inf = Math.abs(influences[k] || 0);
          if (inf > maxMorphInfluence) maxMorphInfluence = inf;
        }
        // Named per-morph influences via the runtime's own dictionary addressing.
        const morphInfluences = [];
        if (mesh.morphTargetDictionary && influences.length > 0) {
          for (const tname in mesh.morphTargetDictionary) {
            const tindex = mesh.morphTargetDictionary[tname];
            if (typeof tindex !== "number" || tindex < 0 || tindex >= influences.length) continue;
            const inf = influences[tindex] || 0;
            morphInfluences.push({ name: tname, value: Number(inf.toFixed(4)) });
          }
        }
        const vec = mesh.position.clone();
        const vec2 = mesh.position.clone();
        const local = new Array(count * 3);
        for (let i = 0; i < count; i++) {
          let bx = posArr[i * 3], by = posArr[i * 3 + 1], bz = posArr[i * 3 + 2];
          if (morphCount > 0) {
            for (let k = 0; k < morphCount; k++) {
              const inf = influences[k];
              if (!inf) continue;
              const d = morphAttrs[k].array;
              bx += inf * d[i * 3];
              by += inf * d[i * 3 + 1];
              bz += inf * d[i * 3 + 2];
            }
          }
          vec.set(bx, by, bz);
          let wx = 0, wy = 0, wz = 0;
          for (let k = 0; k < 4; k++) {
            const wgt = wArr[i * 4 + k];
            if (!wgt) continue;
            const jj = idxArr[i * 4 + k];
            const c = comps[jj];
            if (!c) continue;
            vec2.copy(vec).applyMatrix4(c);
            wx += vec2.x * wgt;
            wy += vec2.y * wgt;
            wz += vec2.z * wgt;
          }
          vec.set(wx, wy, wz).applyMatrix4(headInv);
          local[i * 3] = vec.x;
          local[i * 3 + 1] = vec.y;
          local[i * 3 + 2] = vec.z;
        }
        meshRows.push({ uuid: mesh.uuid, name: mesh.name || "", count, local, maxMorphInfluence, morphInfluences, morphAttrCount: morphCount });
        totalVertexCount += count;
      }
      win.__speakingSpikeHeadLocal = win.__speakingSpikeHeadLocal || {};
      win.__speakingSpikeHeadLocal[actorId] = {
        stateId,
        speakingFlag: out.speakingFlag,
        meshes: meshRows,
        headBoneName,
        headDescendantNames: headList.map(function (b) { return b.name; }),
        boneTranslations,
        rootTranslation,
        speechEvidence: win.__openClinXrHumanoidSpeechEvidence || null,
        playbackEvidence: win.__openClinXrPedsActorPlayerRuntimePlaybackEvidence || null
      };
      out.meshCount = meshRows.length;
      out.totalVertexCount = totalVertexCount;
      out.headBoneName = headBoneName;
      out.headDescendantCount = headList.length;
      out.assetPath =
        roots.length > 0 && roots[0].userData && roots[0].userData.openClinXrAssetPath
          ? String(roots[0].userData.openClinXrAssetPath)
          : null;
      out.ok = true;
    } catch (e) {
      out.error = String(e && e.message ? e.message : e);
    }
    return out;
  })()`;
}

function deltaEvaluate(actorId: string, stateId: string): string {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
  return `(() => {
    const actorId = ${JSON.stringify(actorId)};
    const stateId = ${JSON.stringify(stateId)};
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const prev = win.__speakingSpikeHeadLocal && win.__speakingSpikeHeadLocal[actorId];
    const out = {
      actorId, stateId, ok: false, error: null, prevStateId: null, prevSpeakingFlag: null,
      speakingFlag: null, headBoneName: null, headDescendantCount: 0,
      maxHeadLocalDeltaMm: 0, maxHeadLocalVertexMesh: "", maxHeadLocalVertexIndex: -1,
      allVerticesMaxHeadLocalDeltaMm: 0, headRigid100MaxDeltaMm: 0,
      vertexCount: 0, totalVertexCount: 0,
      speakingMorphInfluence: 0, notSpeakingMorphInfluence: 0,
      worldTranslationDeltaMm: 0, rootRelativeBoneDeltaMm: 0,
      perMesh: [], notSpeakingT: null, speakingT: null
    };
    try {
      if (!prev) { out.error = "no-stashed-state"; return out; }
      out.prevStateId = prev.stateId;
      out.prevSpeakingFlag = prev.speakingFlag;
      if (!scene || typeof scene.traverse !== "function") { out.error = "no-scene"; return out; }
      if (scene.updateMatrixWorld) scene.updateMatrixWorld(true);

      const roots = [];
      scene.traverse(function (o) {
        if (o.userData && o.userData.openClinXrActorId === actorId) roots.push(o);
      });
      if (roots.length === 0) { out.error = "no-actor-root:" + actorId; return out; }

      const meshes = [];
      const seen = {};
      for (const r of roots) {
        r.traverse(function (o) {
          if (o.isSkinnedMesh && o.geometry && !seen[o.uuid]) { seen[o.uuid] = true; meshes.push(o); }
        });
      }
      let mouthCue = null;
      for (const r of roots) {
        r.traverse(function (o) {
          if (!mouthCue && o.userData && o.userData.openClinXrCurrentPhoneme !== undefined) mouthCue = o;
        });
      }
      out.speakingFlag = mouthCue ? !!mouthCue.visible : null;

      // Head-descendant set from the live skeleton (must match the stashed one).
      let headBone = null;
      let headList = [];
      for (const mesh of meshes) {
        const skeleton = mesh.skeleton;
        if (!skeleton || !skeleton.bones) continue;
        for (const b of skeleton.bones) { if (b.name === "head") { headBone = b; break; } }
        if (headBone) break;
      }
      if (!headBone) { out.error = "no-head-bone"; return out; }
      out.headBoneName = headBone.name;
      {
        const headSet = {};
        headList = [];
        (function walk(b) {
          if (headSet[b.uuid]) return;
          headSet[b.uuid] = true;
          headList.push(b);
          const kids = b.children || [];
          for (const k of kids) walk(k);
        })(headBone);
      }
      out.headDescendantCount = headList.length;
      const prevNames = (prev.headDescendantNames || []).slice().sort();
      const nowNames = headList.map(function (b) { return b.name; }).slice().sort();
      if (JSON.stringify(prevNames) !== JSON.stringify(nowNames)) {
        out.error = "head-descendant-set-changed-between-states";
        return out;
      }
      const headSet = {};
      for (const b of headList) headSet[b.uuid] = true;

      const prevByUuid = {};
      for (const m of prev.meshes) prevByUuid[m.uuid] = m;

      let globalHeadAssemblyMax = 0;
      let globalHeadAssemblyMesh = "";
      let globalHeadAssemblyVertex = -1;
      let allVerticesMax = 0;
      let rigid100Max = 0;
      let headAssemblyVertexCount = 0;
      let totalVertexCount = 0;
      let speakingMorphInfluence = 0;
      const perMesh = [];

      // Bone delta rows (the spent quantities, measured between THESE two instants).
      let worldDeltaMax = 0;
      let rootRelDeltaMax = 0;
      let boneTranslationsNow = null;
      let rootTranslationNow = null;

      for (const mesh of meshes) {
        const prevMesh = prevByUuid[mesh.uuid];
        if (!prevMesh) { perMesh.push({ name: mesh.name || "", skipped: "no-matching-state-a-mesh" }); continue; }
        const skeleton = mesh.skeleton;
        const bones = skeleton.bones;
        const boneInverses = skeleton.boneInverses || [];
        const geom = mesh.geometry;
        const pos = geom.attributes.position;
        const skinIndex = geom.attributes.skinIndex;
        const skinWeight = geom.attributes.skinWeight;
        if (!pos || !skinIndex || !skinWeight) continue;

        if (boneTranslationsNow === null) {
          boneTranslationsNow = bones.map(function (b) {
            const e = b.matrixWorld.elements;
            return [e[12], e[13], e[14]];
          });
          for (const b of bones) { if (b.name === "root") { rootTranslationNow = [b.matrixWorld.elements[12], b.matrixWorld.elements[13], b.matrixWorld.elements[14]]; } }
          const prevBones = prev.boneTranslations || [];
          for (let j = 0; j < bones.length && j < prevBones.length; j++) {
            const d = Math.hypot(
              boneTranslationsNow[j][0] - prevBones[j][0],
              boneTranslationsNow[j][1] - prevBones[j][1],
              boneTranslationsNow[j][2] - prevBones[j][2]
            );
            if (d > worldDeltaMax) worldDeltaMax = d;
            if (prev.rootTranslation && rootTranslationNow) {
              const relNow = [
                boneTranslationsNow[j][0] - rootTranslationNow[0],
                boneTranslationsNow[j][1] - rootTranslationNow[1],
                boneTranslationsNow[j][2] - rootTranslationNow[2]
              ];
              const relPrev = [
                prevBones[j][0] - prev.rootTranslation[0],
                prevBones[j][1] - prev.rootTranslation[1],
                prevBones[j][2] - prev.rootTranslation[2]
              ];
              const rd = Math.hypot(relNow[0] - relPrev[0], relNow[1] - relPrev[1], relNow[2] - relPrev[2]);
              if (rd > rootRelDeltaMax) rootRelDeltaMax = rd;
            }
          }
        }

        const M = mesh.matrixWorld;
        const comps = [];
        for (let j = 0; j < bones.length; j++) {
          const bw = bones[j].matrixWorld;
          const bi = boneInverses[j];
          const tmp = new (bw.constructor)();
          tmp.multiplyMatrices(bw, bi);
          const full = new (bw.constructor)();
          full.multiplyMatrices(M, tmp);
          comps.push(full);
        }
        const meshHeadIdx = bones.indexOf(headBone);
        const headComposite = comps[meshHeadIdx];
        const headInv = new (headComposite.constructor)();
        headInv.copy(headComposite).invert();

        const posArr = pos.array;
        const idxArr = skinIndex.array;
        const wArr = skinWeight.array;
        const count = pos.count;
        const morphAttrs =
          geom.morphAttributes && geom.morphAttributes.position ? geom.morphAttributes.position : null;
        const influences = mesh.morphTargetInfluences || [];
        const morphCount = morphAttrs ? Math.min(morphAttrs.length, influences.length) : 0;
        const vec = mesh.position.clone();
        const vec2 = mesh.position.clone();
        const prevLocal = prevMesh.local;

        let meshHeadAssemblyMax = 0;
        let meshAllMax = 0;
        let meshExtremeVertex = -1;
        let meshMorphMax = 0;
        for (let k = 0; k < morphCount; k++) {
          const inf = Math.abs(influences[k] || 0);
          if (inf > meshMorphMax) meshMorphMax = inf;
        }
        if (meshMorphMax > speakingMorphInfluence) speakingMorphInfluence = meshMorphMax;
        for (let i = 0; i < count; i++) {
          let bx = posArr[i * 3], by = posArr[i * 3 + 1], bz = posArr[i * 3 + 2];
          if (morphCount > 0) {
            for (let k = 0; k < morphCount; k++) {
              const inf = influences[k];
              if (!inf) continue;
              const d = morphAttrs[k].array;
              bx += inf * d[i * 3];
              by += inf * d[i * 3 + 1];
              bz += inf * d[i * 3 + 2];
            }
          }
          vec.set(bx, by, bz);
          let wx = 0, wy = 0, wz = 0;
          let maxW = 0, maxJ = -1;
          for (let k = 0; k < 4; k++) {
            const wgt = wArr[i * 4 + k];
            if (!wgt) continue;
            const jj = idxArr[i * 4 + k];
            if (wgt > maxW) { maxW = wgt; maxJ = jj; }
            const c = comps[jj];
            if (!c) continue;
            vec2.copy(vec).applyMatrix4(c);
            wx += vec2.x * wgt;
            wy += vec2.y * wgt;
            wz += vec2.z * wgt;
          }
          vec.set(wx, wy, wz).applyMatrix4(headInv);
          const px = prevLocal[i * 3], py = prevLocal[i * 3 + 1], pz = prevLocal[i * 3 + 2];
          const d = Math.hypot(vec.x - px, vec.y - py, vec.z - pz);
          if (d > meshAllMax) { meshAllMax = d; meshExtremeVertex = i; }
          if (d > allVerticesMax) allVerticesMax = d;
          const boneMax = bones[maxJ];
          if (boneMax && headSet[boneMax.uuid]) {
            headAssemblyVertexCount++;
            if (d > meshHeadAssemblyMax) meshHeadAssemblyMax = d;
            if (d > globalHeadAssemblyMax) {
              globalHeadAssemblyMax = d;
              globalHeadAssemblyMesh = mesh.name || "";
              globalHeadAssemblyVertex = i;
            }
          }
          // Rigid-100% validity check: weight 1.0 on the head bone exactly.
          if (wArr[i * 4] === 1 && wArr[i * 4 + 1] === 0 && wArr[i * 4 + 2] === 0 && wArr[i * 4 + 3] === 0) {
            const j0 = idxArr[i * 4];
            if (bones[j0] && bones[j0].name === "head" && d > rigid100Max) rigid100Max = d;
          }
        }
        perMesh.push({
          name: mesh.name || "",
          uuid: mesh.uuid,
          vertexCount: count,
          headAssemblyMaxDeltaMm: Number((meshHeadAssemblyMax * 1000).toFixed(3)),
          allMaxDeltaMm: Number((meshAllMax * 1000).toFixed(3)),
          extremeVertexIndex: meshExtremeVertex
        });
        totalVertexCount += count;
      }

      out.maxHeadLocalDeltaMm = Number((globalHeadAssemblyMax * 1000).toFixed(3));
      out.maxHeadLocalVertexMesh = globalHeadAssemblyMesh;
      out.maxHeadLocalVertexIndex = globalHeadAssemblyVertex;
      out.allVerticesMaxHeadLocalDeltaMm = Number((allVerticesMax * 1000).toFixed(3));
      out.headRigid100MaxDeltaMm = Number((rigid100Max * 1000).toFixed(3));
      out.vertexCount = headAssemblyVertexCount;
      out.totalVertexCount = totalVertexCount;
      out.worldTranslationDeltaMm = Number((worldDeltaMax * 1000).toFixed(3));
      out.rootRelativeBoneDeltaMm = Number((rootRelDeltaMax * 1000).toFixed(3));
      let notSpeakingMorph = 0;
      for (const m of prev.meshes) {
        const mi = m.maxMorphInfluence || 0;
        if (mi > notSpeakingMorph) notSpeakingMorph = mi;
      }
      out.notSpeakingMorphInfluence = Number(notSpeakingMorph.toFixed(4));
      out.speakingMorphInfluence = Number(speakingMorphInfluence.toFixed(4));
      out.perMesh = perMesh;
      out.ok = true;
      delete win.__speakingSpikeHeadLocal[actorId];
    } catch (e) {
      out.error = String(e && e.message ? e.message : e);
    }
    return out;
  })()`;
}

async function speakingFlag(page: Page, actorId: string): Promise<boolean | null> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;
    let flag = null;
    scene.traverse(function (o) {
      if (flag !== null) return;
      if (o.userData && o.userData.openClinXrActorId === ${JSON.stringify(actorId)}) {
        o.traverse(function (c) {
          if (flag !== null) return;
          if (c.userData && c.userData.openClinXrCurrentPhoneme !== undefined) flag = !!c.visible;
        });
      }
    });
    return flag;
  })()`) as Promise<boolean | null>;
}

/** Wait until the actor's mouth cue has been invisible for minQuietMs consecutively. */
async function waitForQuiet(page: Page, actorId: string, minQuietMs: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let quietSince = 0;
  while (Date.now() < deadline) {
    const flag = await speakingFlag(page, actorId);
    const now = Date.now();
    if (flag === false) {
      if (quietSince === 0) quietSince = now;
      else if (now - quietSince >= minQuietMs) return true;
    } else {
      quietSince = 0;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/** Wait until the actor's mouth cue is visible (mid-utterance). */
async function waitForSpeaking(page: Page, actorId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const flag = await speakingFlag(page, actorId);
    if (flag === true) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function clickTrace(page: Page, traceName: string): Promise<boolean> {
  const button = page.getByRole("button", { name: traceName, exact: false });
  const count = await button.count();
  if (count === 0) return false;
  await button.first().click({ timeout: 5_000 }).catch(() => undefined);
  return true;
}

async function driveActorToSpeak(page: Page, actorId: string, traces: string[]): Promise<{ trace: string | null; attempts: string[] }> {
  const attempts: string[] = [];
  for (const trace of traces) {
    const clicked = await clickTrace(page, trace);
    attempts.push(trace);
    if (!clicked) continue;
    const spoke = await waitForSpeaking(page, actorId, 14_000);
    if (spoke) return { trace, attempts };
  }
  return { trace: null, attempts };
}

type ActorMeasurement = {
  actor: string;
  speaking: { stateId: string; speakingFlag: boolean | null; t: number; driveTrace: string | null };
  notSpeaking: { stateId: string; speakingFlag: boolean | null; t: number };
  result: Record<string, unknown>;
  /** Per-morph-name influence (max across the actor's meshes) at each sampling instant. */
  morphs: { speaking: Record<string, number>; notSpeaking: Record<string, number> };
  /** Per-mesh morph attribute/dictionary report for diagnostics (both states, speaking last). */
  meshReport: Array<{ name: string; morphAttrCount: number; dictKeyCount: number; keys: string[] }>;
  assetPath: string | null;
};

type SampleOutcome = {
  ok: boolean;
  error: string | null;
  speakingFlag: boolean | null;
  meshCount: number;
  totalVertexCount: number;
  headBoneName: string | null;
  headDescendantCount: number;
  assetPath?: string | null;
};

/** Aggregate the stashed sample's per-mesh named morph influences into name -> max value. */
async function readNamedMorphs(
  page: Page,
  actorId: string,
): Promise<{
  values: Record<string, number>;
  report: Array<{ name: string; morphAttrCount: number; dictKeyCount: number; keys: string[] }>;
}> {
  const result = (await page.evaluate(`(() => {
    const stash = window.__speakingSpikeHeadLocal && window.__speakingSpikeHeadLocal[${JSON.stringify(actorId)}];
    if (!stash || !Array.isArray(stash.meshes)) return { out: {}, report: [] };
    const out = {};
    const report = [];
    for (const m of stash.meshes) {
      const keys = (m.morphInfluences || []).map((mi) => mi.name);
      report.push({
        name: m.name || "",
        morphAttrCount: (m.morphAttrCount) || 0,
        dictKeyCount: keys.length,
        keys: keys.slice(0, 40),
      });
      for (const mi of m.morphInfluences || []) {
        if (typeof mi.name !== "string" || !mi.name) continue;
        const v = Math.abs(mi.value) || 0;
        // Record every name (including 0-valued targets) so the file-side 32-name population
        // is fully addressable; the artifact fills 0 for any name never observed at runtime.
        if (!(mi.name in out) || v > out[mi.name]) out[mi.name] = v;
      }
    }
    return { out, report };
  })()`) as { out: Record<string, number>; report: Array<{ name: string; morphAttrCount: number; dictKeyCount: number; keys: string[] }> });
  return { values: result.out, report: result.report };
}

async function measureActor(
  page: Page,
  actorId: string,
  traces: string[],
  t0: number,
): Promise<ActorMeasurement> {
  // 1. not-speaking: a sustained quiet window (actor idle, mouth cue invisible).
  const quiet = await waitForQuiet(page, actorId, 1_400, 120_000);
  if (!quiet) {
    throw new Error(`${actorId}: no quiet (not-speaking) window found in 120s`);
  }
  await page.waitForTimeout(500); // settle after last utterance's morphs
  const notSpeakingT = (Date.now() - t0) / 1000;
  const notSpeakingSample = (await page.evaluate(
    samplerEvaluate(actorId, "not-speaking"),
  )) as unknown as SampleOutcome;
  if (!notSpeakingSample.ok) {
    throw new Error(`${actorId}: not-speaking sample failed: ${notSpeakingSample.error}`);
  }
  if (notSpeakingSample.speakingFlag !== false) {
    throw new Error(`${actorId}: not-speaking sample had speakingFlag=${notSpeakingSample.speakingFlag}`);
  }
  const notSpeakingRead = await readNamedMorphs(page, actorId);
  const notSpeakingMorphs = notSpeakingRead.values;
  const notSpeakingReport = notSpeakingRead.report;
  // 2. speaking: drive via trace buttons until the actor's cue lights.
  const drive = await driveActorToSpeak(page, actorId, traces);
  if (!drive.trace) {
    throw new Error(`${actorId}: no trace drove speech (tried ${drive.attempts.join(", ")})`);
  }
  // The cue can go dark between visibility and the settled sample (a short utterance ending).
  // Retry on the next visible window rather than failing on one miss; state selection is still
  // "phoneme-mouth-cue visible at the sampling instant" (same as E2.2).
  let speakingSample: SampleOutcome | null = null;
  for (let attempt = 0; attempt < 4 && speakingSample === null; attempt++) {
    const visible = await waitForSpeaking(page, actorId, 20_000);
    if (!visible) break;
    await page.waitForTimeout(600); // mid-utterance: viseme morphs near their peak
    const candidate = (await page.evaluate(
      samplerEvaluate(actorId, "speaking"),
    )) as unknown as SampleOutcome;
    if (candidate.ok && candidate.speakingFlag === true) {
      speakingSample = candidate;
    }
  }
  if (speakingSample === null) {
    throw new Error(`${actorId}: no cue-visible sample captured after speech drive (${drive.trace})`);
  }
  const speakingT = (Date.now() - t0) / 1000;
  const speakingRead = await readNamedMorphs(page, actorId);
  const speakingMorphs = speakingRead.values;
  const speakingReport = speakingRead.report;

  // 3. delta.
  const result = (await page.evaluate(
    deltaEvaluate(actorId, "speaking"),
  )) as unknown as Record<string, unknown>;
  if (result.ok !== true) {
    throw new Error(`${actorId}: delta failed: ${String(result.error)}`);
  }
  return {
    actor: actorId,
    speaking: { stateId: "speaking", speakingFlag: true, t: Number(speakingT.toFixed(2)), driveTrace: drive.trace },
    notSpeaking: { stateId: "not-speaking", speakingFlag: false, t: Number(notSpeakingT.toFixed(2)) },
    result,
    morphs: {
      speaking: speakingMorphs,
      notSpeaking: notSpeakingMorphs,
    },
    meshReport: speakingReport.length > 0 ? speakingReport : notSpeakingReport,
    assetPath: speakingSample.assetPath ?? notSpeakingSample.assetPath ?? null,
  };
}

export async function runHeadLocalProbe(): Promise<void> {
  const t0 = Date.now();
  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
      const url = `${server.url}?${CAPTURE_QUERY}`;
      process.stdout.write(`url=${url}\n`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 240_000 });

      await page.waitForFunction(
        `(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.traverse !== "function") return false;
          const wanted = { ${JSON.stringify(PARENT_ACTOR_ID)}: false, ${JSON.stringify(CHILD_ACTOR_ID)}: false };
          scene.traverse(function (o) {
            if (o.userData && o.userData.openClinXrActorId && wanted[o.userData.openClinXrActorId] !== undefined) {
              let hasSkinned = false;
              o.traverse(function (c) {
                if (c.isSkinnedMesh && c.geometry && c.geometry.attributes.skinIndex) hasSkinned = true;
              });
              if (hasSkinned) wanted[o.userData.openClinXrActorId] = true;
            }
          });
          return wanted["${PARENT_ACTOR_ID}"] && wanted["${CHILD_ACTOR_ID}"];
        })()`,
        { timeout: 240_000 },
      );
      process.stdout.write("both actors registered with skinned meshes\n");

      const parent = await measureActor(page, PARENT_ACTOR_ID, PARENT_TRACES, t0);
      const child = await measureActor(page, CHILD_ACTOR_ID, CHILD_TRACES, t0);

      const frame = `sampled at page-elapsed seconds: parent not-speaking t=${parent.notSpeaking.t}, parent speaking t=${parent.speaking.t} (trace "${parent.speaking.driveTrace}"); child not-speaking t=${child.notSpeaking.t}, child speaking t=${child.speaking.t} (trace "${child.speaking.driveTrace}")`;

      // #433 — the parent's per-morph NAMED weights. The planted test refuses an unnamed max,
      // so the 32 names come from the GLB itself (NodeIO walk of extras.targetNames) and each
      // carries its own speaking/not-speaking value from the live samples above. Fail closed:
      // every file name must be addressable in the runtime's morph dictionary at sample time.
      const morphFileNames = await readMorphTargetNamesFromFile(PARENT_MORPH_GLB_REL);
      const runtimeNames = new Set([
        ...Object.keys(parent.morphs.speaking),
        ...Object.keys(parent.morphs.notSpeaking),
      ]);
      const missingRuntime = morphFileNames.filter((n) => !runtimeNames.has(n));
      if (missingRuntime.length > 0) {
        const meshSummary = parent.meshReport
          .map((m) => `${m.name}(attrs=${m.morphAttrCount},dict=${m.dictKeyCount}:[${m.keys.join(",")}])`)
          .join(" | ");
        throw new Error(
          `${missingRuntime.length} file morph names not addressable at runtime (first: ${missingRuntime.slice(0, 5).join(", ")}); ` +
            `assetPath=${parent.assetPath ?? "null"}; runtime dict keys (${runtimeNames.size}): ${[...runtimeNames].slice(0, 40).join(", ")}; meshes: ${meshSummary}`,
        );
      }
      const morphs = morphFileNames.map((name) => ({
        name,
        speaking: Number((parent.morphs.speaking[name] ?? 0).toFixed(4)),
        notSpeaking: Number((parent.morphs.notSpeaking[name] ?? 0).toFixed(4)),
      }));
      const mouthOpen = morphs.find((m) => m.name === "mouth-open");
      if (!mouthOpen) {
        throw new Error("mouth-open not enumerated from the GLB");
      }
      // The lead's inherited stop rule, mirroring the planted clause (3) exactly: harness
      // artefact only when mouth-open stays <= 0.3 AND no mouth/viseme target exceeds 0.3.
      const anyMouthOrVisemeHigh = morphs.some(
        (m) => /mouth|viseme/i.test(m.name) && m.speaking > 0.3,
      );
      const verdict =
        mouthOpen.speaking <= 0.3 && !anyMouthOrVisemeHigh
          ? "harness_artefact"
          : "reaches_high_in_speech";
      const maxSpeaking = morphs.reduce((a, b) => (b.speaking > a.speaking ? b : a));
      const morphWeightsArtifact = {
        schemaVersion: "openclinxr.speaking-parent-morph-weights.v1",
        generatedAt: new Date().toISOString(),
        actor: PARENT_ACTOR_ID,
        enumeratedFrom: PARENT_MORPH_GLB_REL,
        sourceGlb: "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
        sourceGlbSha256: createHash("sha256")
          .update(await readFile(join(REPO_ROOT, PARENT_MORPH_GLB_REL)))
          .digest("hex"),
        morphs,
        maxOverAllMorphsSpeaking: { name: maxSpeaking.name, value: maxSpeaking.speaking },
        verdict,
        frame,
        url,
        source:
          "live runtime read via playwright headless chromium against the ui-xr portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); " +
          "page.evaluate on window.__openClinXrDebugScene of peds_asthma_parent_anxiety_v1; " +
          "per-morph influences read through the runtime's own morphTargetDictionary (populated from glTF extras.targetNames by GLTFLoader, three 0.184) " +
          "at a quiet (not-speaking) instant and a phoneme-mouth-cue-visible (speaking) instant; same scenario and state selection as E2.2; " +
          "32 target names enumerated from the GLB file itself via NodeIO; NOT a static asset read",
        claimScope:
          "named per-morph influence weights for parent_tara_johnson_v1 (mpfb-peds-parent-aisha.motion-bind.glb) at one live speaking instant and one quiet instant, peds asthma station; decides whether the #431 mouth-open-at-1.0 still is a harness artefact; verdict recomputed by the planted clause (3) from these numbers",
        notEvidenceFor: [
          "the cause of the mid-face collapse (weights vs morph authoring vs topology — none measured)",
          "any fix",
          "whether the collapse is visible at any weight (pixel grade is the orchestrator's)",
          "that the speaking sample is the max mouth-opening over the whole utterance (one instant only)",
          "other actors or scenarios",
          "production phoneme timing",
          "clinical validity",
          "scoring validity",
          "quest readiness",
        ],
      };
      const morphWeightsPath = join(HERE, "speaking-parent-morph-weights.json");
      await writeFile(
        morphWeightsPath,
        `${JSON.stringify(morphWeightsArtifact, null, 2)}\n`,
        "utf8",
      );
      process.stdout.write(
        `${morphWeightsPath} verdict=${verdict} mouth-open(${mouthOpen.notSpeaking}->${mouthOpen.speaking}) maxSpeaking=${maxSpeaking.name}=${maxSpeaking.speaking}\n`,
      );

      const artifact = {
        schemaVersion: "openclinxr.speaking-actor-head-local.v1",
        generatedAt: new Date().toISOString(),
        source:
          "live runtime read via playwright headless chromium against the ui-xr portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); " +
          "page.evaluate on window.__openClinXrDebugScene of peds_asthma_parent_anxiety_v1; " +
          "per-vertex CPU skinning replicating the three.js shader (world = mesh.matrixWorld * sum_j weight_j * boneWorld_j * boneInverse_j * bindVertex) " +
          "sampled in head-bone-local frame (mesh.matrixWorld * boneWorld_head * boneInverse_head)^-1 so rigid head attachment is exactly invariant; " +
          "speaking flagged by phoneme-mouth-cue visibility on the actor root at the sampling instant; dialogue driven by trace-button clicks; NOT a static asset read",
        url,
        frame,
        claimScope:
          "head-local skinned-vertex delta (speaking vs not) for parent_tara_johnson_v1 and the patient_maya_johnson_v1 control, peds asthma station only; column A of #419 E2.2",
        notEvidenceFor: [
          "the cause (naming a mechanism is a later slice)",
          "any fix",
          "whether the spike is visible (pixel grade is the orchestrator's)",
          "hair-mesh weights specifically (per-mesh extremes are recorded so a later slice can distinguish body skin from fitted hair)",
          "other actors or scenarios",
          "production phoneme timing",
          "clinical validity",
          "scoring validity",
          "quest readiness",
        ],
        actors: [
          {
            actor: parent.actor,
            maxHeadLocalDeltaMm: parent.result.maxHeadLocalDeltaMm,
            maxHeadLocalVertexMesh: parent.result.maxHeadLocalVertexMesh,
            maxHeadLocalVertexIndex: parent.result.maxHeadLocalVertexIndex,
            vertexCount: parent.result.vertexCount,
            totalVertexCount: parent.result.totalVertexCount,
            allVerticesMaxHeadLocalDeltaMm: parent.result.allVerticesMaxHeadLocalDeltaMm,
            headRigid100MaxDeltaMm: parent.result.headRigid100MaxDeltaMm,
            speakingMorphInfluence: parent.result.speakingMorphInfluence,
            notSpeakingMorphInfluence: parent.result.notSpeakingMorphInfluence,
            worldTranslationDeltaMm: parent.result.worldTranslationDeltaMm,
            rootRelativeBoneDeltaMm: parent.result.rootRelativeBoneDeltaMm,
            headBoneName: parent.result.headBoneName,
            headDescendantBoneCount: parent.result.headDescendantCount,
            speakingState: parent.speaking,
            notSpeakingState: parent.notSpeaking,
            perMesh: parent.result.perMesh,
          },
          {
            actor: child.actor,
            maxHeadLocalDeltaMm: child.result.maxHeadLocalDeltaMm,
            maxHeadLocalVertexMesh: child.result.maxHeadLocalVertexMesh,
            maxHeadLocalVertexIndex: child.result.maxHeadLocalVertexIndex,
            vertexCount: child.result.vertexCount,
            totalVertexCount: child.result.totalVertexCount,
            allVerticesMaxHeadLocalDeltaMm: child.result.allVerticesMaxHeadLocalDeltaMm,
            headRigid100MaxDeltaMm: child.result.headRigid100MaxDeltaMm,
            speakingMorphInfluence: child.result.speakingMorphInfluence,
            notSpeakingMorphInfluence: child.result.notSpeakingMorphInfluence,
            worldTranslationDeltaMm: child.result.worldTranslationDeltaMm,
            rootRelativeBoneDeltaMm: child.result.rootRelativeBoneDeltaMm,
            headBoneName: child.result.headBoneName,
            headDescendantBoneCount: child.result.headDescendantCount,
            speakingState: child.speaking,
            notSpeakingState: child.notSpeaking,
            perMesh: child.result.perMesh,
          },
        ],
      };

      const json = `${JSON.stringify(artifact, null, 2)}\n`;
      // The planted contract reads `speaking-spike-head-local.json`; the dispatch deliverable
      // is `speaking-actor-head-local.json`. Write both with identical content so both proofs
      // hold (the naming mismatch is flagged in the report).
      const spikePath = join(HERE, "speaking-spike-head-local.json");
      const actorPath = join(HERE, "speaking-actor-head-local.json");
      await writeFile(spikePath, json, "utf8");
      await writeFile(actorPath, json, "utf8");
      process.stdout.write(`${spikePath}\n`);
      process.stdout.write(`${actorPath}\n`);

      for (const a of artifact.actors) {
        process.stdout.write(
          `${a.actor}: headLocal=${a.maxHeadLocalDeltaMm}mm all=${a.allVerticesMaxHeadLocalDeltaMm}mm rigid100=${a.headRigid100MaxDeltaMm}mm morph(${a.notSpeakingMorphInfluence}->${a.speakingMorphInfluence}) verts=${a.vertexCount}/${a.totalVertexCount} world=${a.worldTranslationDeltaMm}mm rootRel=${a.rootRelativeBoneDeltaMm}mm\n`,
        );
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runHeadLocalProbe().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
