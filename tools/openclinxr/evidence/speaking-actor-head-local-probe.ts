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

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PARENT_ACTOR_ID = "parent_tara_johnson_v1";
const CHILD_ACTOR_ID = "patient_maya_johnson_v1";

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
  /** Per-bone head-local-frame composites B_j = headInv * C_j (flat 16-float rows) at the rest instant. Skinning through these already lands in head-bone-local space. */
  headLocalComps: number[][];
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
    const out = { actorId, stateId, ok: false, error: null, speakingFlag: null, activeActorId: null, meshCount: 0, totalVertexCount: 0, headBoneName: null, headDescendantCount: 0, assetPath: null };
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
        // Stash the rest-state head-local composites B_j = headInv * C_j so the
        // speaking-instant decomposition can re-skin with rest bones (morph-driven) vs
        // speaking bones (bone-driven) in the SAME head-bone-local space. Because B_j already
        // lives in the head-local frame, a head-rigid vertex stays exactly invariant and the
        // head bone's own rigid motion never leaks into the delta.
        const headLocalComps = comps.map((c) => {
          const b = new (c.constructor)();
          b.multiplyMatrices(headInv, c);
          return Array.from(b.elements);
        });
        meshRows.push({ uuid: mesh.uuid, name: mesh.name || "", count, local, maxMorphInfluence, morphInfluences, morphAttrCount: morphCount, headLocalComps });
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
      out.activeActorId =
        win.__openClinXrHumanoidSpeechEvidence && typeof win.__openClinXrHumanoidSpeechEvidence.activeActorId === "string"
          ? win.__openClinXrHumanoidSpeechEvidence.activeActorId
          : null;
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
  //
  // Decomposition contract (#474): the rest->speaking excursion is split into a
  // morph-driven component and a bone-driven component in ONE consistent frame (the REST
  // head-local frame), so the two add up exactly and no motion is lost. Per head-assembly
  // vertex i, with rest position pR (stashed local), morph-only position pM (speaking morphs
  // on rest bones), and full position pS (speaking morphs on speaking bones):
  //   morphDriven_i = |pM - pR|,  boneDriven_i = |pS - pM|,  total_i = |pS - pR|.
  // By triangle inequality morphDriven_i + boneDriven_i >= total_i, and pS - pR =
  // (pM - pR) + (pS - pM) exactly, so the head-assembly maxima satisfy the planted clause (3).
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
      morphDrivenHeadAssemblyDeltaMm: 0, boneDrivenHeadAssemblyDeltaMm: 0,
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

      const Matrix4Ctor = headBone.matrixWorld.constructor;
      const Vector3Ctor = headBone.position.constructor;
      // Skin a morph-displaced bind vertex with a given composite set; returns world x,y,z.
      function skinVec3(bx, by, bz, compsArr, wArr, idxArr, i) {
        let wx = 0, wy = 0, wz = 0;
        const p = new Vector3Ctor(bx, by, bz);
        const t = new Vector3Ctor();
        for (let k = 0; k < 4; k++) {
          const wgt = wArr[i * 4 + k];
          if (!wgt) continue;
          const jj = idxArr[i * 4 + k];
          const c = compsArr[jj];
          if (!c) continue;
          t.copy(p).applyMatrix4(c);
          wx += t.x * wgt; wy += t.y * wgt; wz += t.z * wgt;
        }
        return [wx, wy, wz];
      }

      let globalHeadAssemblyMax = 0;
      let globalMorphDrivenMax = 0;
      let globalBoneDrivenMax = 0;
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

        // Speaking composites C^speak.
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

        // Speaking head-local frame inverse + head-local composites B^speak_j = headInv_speak * C^speak_j.
        const speakHeadComposite = comps[meshHeadIdx];
        const speakHeadInv = new (speakHeadComposite.constructor)();
        speakHeadInv.copy(speakHeadComposite).invert();
        const speakHeadLocalComps = comps.map(function (c) {
          const b = new (c.constructor)();
          b.multiplyMatrices(speakHeadInv, c);
          return b;
        });

        // Rest head-local composites B^rest_j from the stash (already head-bone-local).
        const restHeadLocalComps = (prevMesh.headLocalComps || []).map(function (e) {
          const m = new Matrix4Ctor();
          if (e && e.length === 16) m.fromArray(e);
          return m;
        });

        const posArr = pos.array;
        const idxArr = skinIndex.array;
        const wArr = skinWeight.array;
        const count = pos.count;
        const morphAttrs =
          geom.morphAttributes && geom.morphAttributes.position ? geom.morphAttributes.position : null;
        const influences = mesh.morphTargetInfluences || [];
        const morphCount = morphAttrs ? Math.min(morphAttrs.length, influences.length) : 0;
        const prevLocal = prevMesh.local;

        let meshHeadAssemblyMax = 0;
        let meshMorphDrivenMax = 0;
        let meshBoneDrivenMax = 0;
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
          // Dominant joint for head-assembly classification (weights are state-invariant).
          let maxW = 0, maxJ = -1;
          for (let k = 0; k < 4; k++) {
            const wgt = wArr[i * 4 + k];
            if (wgt > maxW) { maxW = wgt; maxJ = idxArr[i * 4 + k]; }
          }

          // pM = rest bones + speaking morphs, pS = speaking bones + speaking morphs — both
          // already in head-bone-local space (the B composites carry headInv), so a rigid
          // head attachment stays exactly invariant and only jaw/morph articulation shows.
          const morphLocal = skinVec3(bx, by, bz, restHeadLocalComps, wArr, idxArr, i);
          const speakLocal = skinVec3(bx, by, bz, speakHeadLocalComps, wArr, idxArr, i);
          const pM = new Vector3Ctor(morphLocal[0], morphLocal[1], morphLocal[2]);
          const pS = new Vector3Ctor(speakLocal[0], speakLocal[1], speakLocal[2]);
          const pR = new Vector3Ctor(prevLocal[i * 3], prevLocal[i * 3 + 1], prevLocal[i * 3 + 2]);

          const morphDriven = pM.distanceTo(pR);
          const boneDriven = pS.distanceTo(pM);
          const total = pS.distanceTo(pR);
          if (total > meshAllMax) { meshAllMax = total; meshExtremeVertex = i; }
          if (total > allVerticesMax) allVerticesMax = total;
          const boneMax = bones[maxJ];
          if (boneMax && headSet[boneMax.uuid]) {
            headAssemblyVertexCount++;
            if (total > meshHeadAssemblyMax) meshHeadAssemblyMax = total;
            if (morphDriven > meshMorphDrivenMax) meshMorphDrivenMax = morphDriven;
            if (boneDriven > meshBoneDrivenMax) meshBoneDrivenMax = boneDriven;
            if (total > globalHeadAssemblyMax) {
              globalHeadAssemblyMax = total;
              globalHeadAssemblyMesh = mesh.name || "";
              globalHeadAssemblyVertex = i;
            }
            if (morphDriven > globalMorphDrivenMax) globalMorphDrivenMax = morphDriven;
            if (boneDriven > globalBoneDrivenMax) globalBoneDrivenMax = boneDriven;
          }
          // Rigid-100% validity check: weight 1.0 on the head bone exactly.
          if (wArr[i * 4] === 1 && wArr[i * 4 + 1] === 0 && wArr[i * 4 + 2] === 0 && wArr[i * 4 + 3] === 0) {
            const j0 = idxArr[i * 4];
            if (bones[j0] && bones[j0].name === "head" && total > rigid100Max) rigid100Max = total;
          }
        }
        perMesh.push({
          name: mesh.name || "",
          uuid: mesh.uuid,
          vertexCount: count,
          headAssemblyMaxDeltaMm: Number((meshHeadAssemblyMax * 1000).toFixed(3)),
          morphDrivenHeadAssemblyDeltaMm: Number((meshMorphDrivenMax * 1000).toFixed(3)),
          boneDrivenHeadAssemblyDeltaMm: Number((meshBoneDrivenMax * 1000).toFixed(3)),
          allMaxDeltaMm: Number((meshAllMax * 1000).toFixed(3)),
          extremeVertexIndex: meshExtremeVertex
        });
        totalVertexCount += count;
      }

      out.maxHeadLocalDeltaMm = Number((globalHeadAssemblyMax * 1000).toFixed(3));
      out.morphDrivenHeadAssemblyDeltaMm = Number((globalMorphDrivenMax * 1000).toFixed(3));
      out.boneDrivenHeadAssemblyDeltaMm = Number((globalBoneDrivenMax * 1000).toFixed(3));
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

/** Read the runtime's current active speaker id (`__openClinXrHumanoidSpeechEvidence.activeActorId`), or null. */
function activeActorIdEvaluate(): string {
  return `(() => {
    const win = window;
    const ev = win.__openClinXrHumanoidSpeechEvidence;
    return ev && typeof ev.activeActorId === "string" ? ev.activeActorId : null;
  })()`;
}

async function readActiveActorId(page: Page): Promise<string | null> {
  return page.evaluate(activeActorIdEvaluate()) as Promise<string | null>;
}

/** Live max |morph influence| across the actor's skinned meshes — no skinning, just the driver input. */
function actorMaxMorphInfluenceEvaluate(actorId: string): string {
  return `(() => {
    const actorId = ${JSON.stringify(actorId)};
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;
    let max = 0;
    let found = false;
    scene.traverse(function (o) {
      if (o.userData && o.userData.openClinXrActorId === actorId) {
        o.traverse(function (c) {
          if (c.isSkinnedMesh && c.morphTargetInfluences && c.morphTargetInfluences.length > 0) {
            found = true;
            for (let k = 0; k < c.morphTargetInfluences.length; k++) {
              const v = Math.abs(c.morphTargetInfluences[k] || 0);
              if (v > max) max = v;
            }
          }
        });
      }
    });
    return found ? max : null;
  })()`;
}

async function readActorMaxMorphInfluence(page: Page, actorId: string): Promise<number | null> {
  return page.evaluate(actorMaxMorphInfluenceEvaluate(actorId)) as Promise<number | null>;
}

/** Wait until the actor is NOT the active speaker (activeActorId !== actorId). */
async function waitForIdleByActiveActor(page: Page, actorId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await readActiveActorId(page);
    if (active !== actorId) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Wait until the actor IS the active speaker (activeActorId === actorId). */
async function waitForSpeakingByActiveActor(page: Page, actorId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await readActiveActorId(page);
    if (active === actorId) return true;
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

/** Drive the actor to speak and wait until it is the active speaker. */
async function driveActorToSpeak(page: Page, actorId: string, traces: string[]): Promise<{ trace: string | null; attempts: string[] }> {
  const attempts: string[] = [];
  for (const trace of traces) {
    const clicked = await clickTrace(page, trace);
    attempts.push(trace);
    if (!clicked) continue;
    const spoke = await waitForSpeakingByActiveActor(page, actorId, 14_000);
    if (spoke) return { trace, attempts };
  }
  return { trace: null, attempts };
}

type ActorMeasurement = {
  actor: string;
  rest: { stateId: string; activeActorId: string | null; restInfluence: number | null; t: number };
  speaking: { stateId: string; activeActorId: string | null; speakingInfluence: number | null; t: number; driveTrace: string | null };
  result: Record<string, unknown>;
  assetPath: string | null;
};

type SampleOutcome = {
  ok: boolean;
  error: string | null;
  speakingFlag: boolean | null;
  activeActorId: string | null;
  meshCount: number;
  totalVertexCount: number;
  headBoneName: string | null;
  headDescendantCount: number;
  assetPath?: string | null;
};

async function measureActor(
  page: Page,
  actorId: string,
  traces: string[],
  t0: number,
): Promise<ActorMeasurement> {
  // 1. rest: the actor is not the active speaker. State identity comes from activeActorId
  // (clause (4) — never from mouth-cue visibility), and the rest influence is read off the
  // live driver input below.
  const idle = await waitForIdleByActiveActor(page, actorId, 120_000);
  if (!idle) {
    throw new Error(`${actorId}: activeActorId never left ${actorId} in 120s`);
  }
  // Let any lingering viseme/emotion transition settle before sampling the rest pose.
  await page.waitForTimeout(1_500);
  const restInfluence = await readActorMaxMorphInfluence(page, actorId);
  const restT = (Date.now() - t0) / 1000;
  const restSample = (await page.evaluate(
    samplerEvaluate(actorId, "rest"),
  )) as unknown as SampleOutcome;
  if (!restSample.ok) {
    throw new Error(`${actorId}: rest sample failed: ${restSample.error}`);
  }
  const restActiveActorId = restSample.activeActorId;

  // 2. speaking: drive via trace buttons until the actor is the active speaker, then sample
  // mid-utterance.
  const drive = await driveActorToSpeak(page, actorId, traces);
  if (!drive.trace) {
    throw new Error(`${actorId}: no trace drove speech (tried ${drive.attempts.join(", ")})`);
  }
  let speakingSample: SampleOutcome | null = null;
  for (let attempt = 0; attempt < 8 && speakingSample === null; attempt++) {
    const speaking = await waitForSpeakingByActiveActor(page, actorId, 20_000);
    if (!speaking) break;
    const candidate = (await page.evaluate(
      samplerEvaluate(actorId, "speaking"),
    )) as unknown as SampleOutcome;
    // The sampler atomically stamps activeActorId at the sampling instant, so a short
    // utterance that ends between the poll and the sample is refused and retried rather
    // than silently recording a driven actor as "speaking" (clause (4)).
    if (candidate.ok && candidate.activeActorId === actorId) {
      speakingSample = candidate;
    }
  }
  if (speakingSample === null) {
    throw new Error(`${actorId}: no active-speaker sample captured after speech drive (${drive.trace})`);
  }
  const speakingT = (Date.now() - t0) / 1000;
  const speakingActiveActorId = speakingSample.activeActorId;
  const speakingInfluence = await readActorMaxMorphInfluence(page, actorId);

  // 3. delta + decomposition.
  const result = (await page.evaluate(
    deltaEvaluate(actorId, "speaking"),
  )) as unknown as Record<string, unknown>;
  if (result.ok !== true) {
    throw new Error(`${actorId}: delta failed: ${String(result.error)}`);
  }
  return {
    actor: actorId,
    rest: {
      stateId: "rest",
      activeActorId: restActiveActorId,
      restInfluence: restInfluence,
      t: Number(restT.toFixed(2)),
    },
    speaking: {
      stateId: "speaking",
      activeActorId: speakingActiveActorId,
      speakingInfluence: speakingInfluence,
      t: Number(speakingT.toFixed(2)),
      driveTrace: drive.trace,
    },
    result,
    assetPath: speakingSample.assetPath ?? restSample.assetPath ?? null,
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

      const frame = `sampled at page-elapsed seconds: parent rest t=${parent.rest.t}, parent speaking t=${parent.speaking.t} (trace "${parent.speaking.driveTrace}"); child rest t=${child.rest.t}, child speaking t=${child.speaking.t} (trace "${child.speaking.driveTrace}")`;

      // The 2026-08-18 pre-fix numbers, preserved BEFORE any re-run (the OVERWRITE TRAP in the
      // planted header). These are the driven-to-driven measurement this slice supersedes —
      // copied verbatim from the issue's MEASURED block, not reconstructed after the fact.
      const priorObservation = {
        measuredAt: "2026-08-18T21:13:32.077Z",
        artifact: "speaking-actor-head-local.json",
        stateSelection: "speaking vs mouth-cue-invisible (both mid-drive — no rest zero)",
        actors: [
          {
            actor: "parent_tara_johnson_v1",
            speakingMorphInfluence: 1,
            notSpeakingMorphInfluence: 0.4998,
            headAssemblyMaxDeltaMm: 8.729,
            allVerticesMaxHeadLocalDeltaMm: 35.584,
            headRigid100MaxDeltaMm: 0,
            maxHeadLocalVertexMesh: "mpfb_ob_patient_aisha_body_1",
          },
          {
            actor: "patient_maya_johnson_v1",
            speakingMorphInfluence: 0.5485,
            notSpeakingMorphInfluence: 1,
            headAssemblyMaxDeltaMm: 3.401,
            allVerticesMaxHeadLocalDeltaMm: 3.401,
            headRigid100MaxDeltaMm: 0.008,
            maxHeadLocalVertexMesh: "mpfb_peds_patient_child_body",
          },
        ],
      };

      const artifact = {
        schemaVersion: "openclinxr.speaking-actor-head-rest-baseline.v1",
        generatedAt: new Date().toISOString(),
        priorObservation,
        source:
          "live runtime read via playwright headless chromium against the ui-xr portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); " +
          "page.evaluate on window.__openClinXrDebugScene of peds_asthma_parent_anxiety_v1; " +
          "per-vertex CPU skinning replicating the three.js shader (world = mesh.matrixWorld * sum_j weight_j * boneWorld_j * boneInverse_j * bindVertex) " +
          "sampled in head-bone-local frame; rest is the idle state (activeActorId !== actor), speaking is the active-speaker state (activeActorId === actor, mid-utterance); " +
          "rest->speaking excursion decomposed into morph-driven and bone-driven components in the rest head-local frame (morphDriven + boneDriven >= total by construction); " +
          "dialogue driven by trace-button clicks; NOT a static asset read",
        url,
        frame,
        claimScope:
          "rest-to-speaking head-assembly excursion + morph/bone decomposition for parent_tara_johnson_v1 and patient_maya_johnson_v1, peds asthma station; makes #402's spike measurable from a zero",
        notEvidenceFor: [
          "the cause (naming a mechanism is the next slice)",
          "any fix",
          "whether the spike is visible (pixel grade is the orchestrator's)",
          "hair-mesh weights specifically (per-mesh extremes are recorded)",
          "other actors or scenarios",
          "production phoneme timing",
          "clinical validity",
          "scoring validity",
          "quest readiness",
        ],
        actors: [
          {
            actor: parent.actor,
            stateIdentifiedBy: "activeActorId",
            restMorphInfluence: parent.result.notSpeakingMorphInfluence,
            speakingMorphInfluence: parent.result.speakingMorphInfluence,
            restToSpeakingHeadAssemblyDeltaMm: parent.result.maxHeadLocalDeltaMm,
            morphDrivenHeadAssemblyDeltaMm: parent.result.morphDrivenHeadAssemblyDeltaMm,
            boneDrivenHeadAssemblyDeltaMm: parent.result.boneDrivenHeadAssemblyDeltaMm,
            restActiveActorId: parent.rest.activeActorId,
            speakingActiveActorId: parent.speaking.activeActorId,
            allVerticesMaxHeadLocalDeltaMm: parent.result.allVerticesMaxHeadLocalDeltaMm,
            headRigid100MaxDeltaMm: parent.result.headRigid100MaxDeltaMm,
            vertexCount: parent.result.vertexCount,
            totalVertexCount: parent.result.totalVertexCount,
            worldTranslationDeltaMm: parent.result.worldTranslationDeltaMm,
            rootRelativeBoneDeltaMm: parent.result.rootRelativeBoneDeltaMm,
            headBoneName: parent.result.headBoneName,
            headDescendantBoneCount: parent.result.headDescendantCount,
            maxHeadLocalVertexMesh: parent.result.maxHeadLocalVertexMesh,
            maxHeadLocalVertexIndex: parent.result.maxHeadLocalVertexIndex,
            restState: parent.rest,
            speakingState: parent.speaking,
            perMesh: parent.result.perMesh,
          },
          {
            actor: child.actor,
            stateIdentifiedBy: "activeActorId",
            restMorphInfluence: child.result.notSpeakingMorphInfluence,
            speakingMorphInfluence: child.result.speakingMorphInfluence,
            restToSpeakingHeadAssemblyDeltaMm: child.result.maxHeadLocalDeltaMm,
            morphDrivenHeadAssemblyDeltaMm: child.result.morphDrivenHeadAssemblyDeltaMm,
            boneDrivenHeadAssemblyDeltaMm: child.result.boneDrivenHeadAssemblyDeltaMm,
            restActiveActorId: child.rest.activeActorId,
            speakingActiveActorId: child.speaking.activeActorId,
            allVerticesMaxHeadLocalDeltaMm: child.result.allVerticesMaxHeadLocalDeltaMm,
            headRigid100MaxDeltaMm: child.result.headRigid100MaxDeltaMm,
            vertexCount: child.result.vertexCount,
            totalVertexCount: child.result.totalVertexCount,
            worldTranslationDeltaMm: child.result.worldTranslationDeltaMm,
            rootRelativeBoneDeltaMm: child.result.rootRelativeBoneDeltaMm,
            headBoneName: child.result.headBoneName,
            headDescendantBoneCount: child.result.headDescendantCount,
            maxHeadLocalVertexMesh: child.result.maxHeadLocalVertexMesh,
            maxHeadLocalVertexIndex: child.result.maxHeadLocalVertexIndex,
            restState: child.rest,
            speakingState: child.speaking,
            perMesh: child.result.perMesh,
          },
        ],
      };

      const restPath = join(HERE, "speaking-actor-head-rest-baseline.json");
      await writeFile(restPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      process.stdout.write(`${restPath}\n`);

      for (const a of artifact.actors) {
        process.stdout.write(
          `${a.actor}: rest->speaking=${a.restToSpeakingHeadAssemblyDeltaMm}mm (morph=${a.morphDrivenHeadAssemblyDeltaMm} + bone=${a.boneDrivenHeadAssemblyDeltaMm}) all=${a.allVerticesMaxHeadLocalDeltaMm}mm rigid100=${a.headRigid100MaxDeltaMm}mm morph(${a.restMorphInfluence}->${a.speakingMorphInfluence}) verts=${a.vertexCount}/${a.totalVertexCount} world=${a.worldTranslationDeltaMm}mm rootRel=${a.rootRelativeBoneDeltaMm}mm restActive=${a.restActiveActorId} speakingActive=${a.speakingActiveActorId}\n`,
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
