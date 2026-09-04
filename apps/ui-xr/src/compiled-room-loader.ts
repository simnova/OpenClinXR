/**
 * Load a compiled room GLB from encounter materialization and tag it as the
 * learner-visible station shell. Parametric `buildStationEnvironment` remains
 * the fallback when no compiled URL is supplied.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness, HIPAA certification
 */

import type { Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type CompiledRoomLoadInput = {
  environmentId: string;
  compiledRoomAssetUrl: string;
  compileNodeId: string;
  /** Injectable for tests; production uses three.js GLTFLoader.loadAsync. */
  loadGltf?: (url: string) => Promise<Group>;
};

export function hasCompiledRoomAssetUrl(
  input: { compiledRoomAssetUrl?: string | null; compileNodeId?: string | null },
): boolean {
  const url = input.compiledRoomAssetUrl?.trim() ?? "";
  const nodeId = input.compileNodeId?.trim() ?? "";
  return url.length > 0 && nodeId.length > 0;
}

export function tagCompiledRoomUserData(
  root: Group,
  input: Pick<CompiledRoomLoadInput, "environmentId" | "compiledRoomAssetUrl" | "compileNodeId">,
): Group {
  root.name = "openclinxr.compiled-room-shell";
  root.userData.openClinXrCompiledRoom = true;
  root.userData.environmentId = input.environmentId;
  root.userData.compileNodeId = input.compileNodeId;
  root.userData.compiledRoomAssetUrl = input.compiledRoomAssetUrl;
  root.userData.openClinXrEnvironmentPolicy =
    "compiled_room_glb_from_encounter_materialization_compile_node";
  return root;
}

async function defaultLoadGltf(url: string): Promise<Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

/**
 * Load the compiled room GLB and stamp compile-node identity onto the root.
 * Does not spawn the parametric box.
 */
export async function loadCompiledRoomShell(input: CompiledRoomLoadInput): Promise<Group> {
  const load = input.loadGltf ?? defaultLoadGltf;
  const scene = await load(input.compiledRoomAssetUrl);
  return tagCompiledRoomUserData(scene, input);
}
