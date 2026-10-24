import { BoxGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, type WebGLRenderer } from "three";
import type { ResourceCounts } from "./types.js";
export const SCENE_MANIFEST = Object.freeze({ version: 1, meshes: 8, geometries: 3, materials: 5, textures: 0, expectedProgramDelta: 1, trianglesPerView: 46, colors: [0x264638, 0x586878, 0xe33939, 0x36c66a, 0x397de3], dimensions: [8, 3, .25], frustumCulled: false, state: "one monotonically increasing frame counter and actual viewer head pose" });
export const RENDER_OPTIONS = Object.freeze({ antialias: true, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: false, powerPreference: "default" as const });
export function counts(renderer: WebGLRenderer): ResourceCounts { return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 }; }
export function createRoom() {
  const scene = new Scene(); scene.background = new Color(0x101820);
  const geometries = [new PlaneGeometry(8, 8), new PlaneGeometry(8, 3), new BoxGeometry(.25, .25, .25)];
  const materials = SCENE_MANIFEST.colors.map(color => new MeshBasicMaterial({ color, side: DoubleSide }));
  const floor = new Mesh(geometries[0], materials[0]); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  for (const [x, z, ry] of [[0, -4, 0], [0, 4, Math.PI], [-4, 0, Math.PI / 2], [4, 0, -Math.PI / 2]]) { const wall = new Mesh(geometries[1], materials[1]); wall.position.set(x!, 1.5, z!); wall.rotation.y = ry!; scene.add(wall); }
  for (let i = 0; i < 3; i++) { const cube = new Mesh(geometries[2], materials[i + 2]); cube.position.set((i - 1) * .8, 1.2, -1.5); scene.add(cube); }
  scene.traverse(o => { o.frustumCulled = false; }); let disposed = false;
  return { scene, ownedCount: () => disposed ? 0 : geometries.length + materials.length, validate() { return scene.children.length === 8 && scene.children.every(o => o instanceof Mesh && o.visible && !o.frustumCulled) && geometries.every(g => g.attributes["position"] && g.attributes["position"].count > 0); }, dispose() { if (disposed) return; disposed = true; scene.clear(); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); } };
}
export function previewCamera() { const camera = new PerspectiveCamera(65, 16 / 9, .05, 30); camera.position.set(0, 1.6, 2.8); camera.lookAt(0, 1.1, -1.5); return camera; }