/** Page bundle for c52c-plant-parity.mjs: same plant + read code as node, running in the GPU browser. */
import { Group, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyAndPlantSupineOnDeck } from "@openclinxr/xr-pose";
import { buildPatientStretcher } from "@openclinxr/xr-station";
import { plantLoadedHumanoid, readPose, caseKey } from "./c52c-plant-core.mjs";

const registry = new Map();
const state = { started: 0, finished: 0, errors: [] };
const deps = { Group, buildPatientStretcher, applyAndPlantSupineOnDeck };

async function plantOne(spec) {
  const gltf = await new GLTFLoader().loadAsync(`/generated-humanoids/${spec.body}`);
  const root = gltf.scene;
  const parent = plantLoadedHumanoid(root, spec, deps);
  registry.set(caseKey(spec), { spec, root, parent });
}

window.__c52c = {
  state,
  count: () => registry.size,
  /** Kicks off every plant without awaiting them; the driver polls count() until it is stable. */
  start(specs) {
    state.started = specs.length;
    void (async () => {
      for (const spec of specs) {
        try { await plantOne(spec); } catch (e) { state.errors.push(`${caseKey(spec)}: ${String(e?.stack ?? e).slice(0, 300)}`); }
        state.finished += 1;
      }
    })();
  },
  /** Destructive probe hook: move one bone's WORLD x by dx metres in the live scene. */
  offsetBone(key, boneName, dx) {
    const entry = registry.get(key);
    let bone = null;
    entry.root.traverse((o) => { if (!bone && o.isBone === true && o.name === boneName) bone = o; });
    const wp = bone.getWorldPosition(new Vector3());
    wp.x += dx;
    bone.parent.worldToLocal(wp);
    bone.position.copy(wp);
    bone.updateMatrixWorld(true);
  },
  /** Reads the planted humanoids in the scene (not the plant's return values). */
  readAll() {
    return [...registry.entries()].map(([key, { spec, root }]) => ({ key, spec, pose: readPose(root, Vector3) }));
  },
  environment() {
    const g = document.createElement("canvas").getContext("webgl");
    const d = g && g.getExtension("WEBGL_debug_renderer_info");
    return { userAgent: navigator.userAgent, renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null };
  },
};
