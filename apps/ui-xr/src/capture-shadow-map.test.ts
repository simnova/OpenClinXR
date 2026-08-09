/**
 * #249 — capture-path contact shadows must not leak into the learner runtime.
 * The gating contract: shadows activate only when the URL carries a capture mode param;
 * every wiring call is additionally gated by the caller on isCaptureShadowPath(...).
 */

import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import {
  createCaptureKeyLight,
  enableCaptureRendererShadowMap,
  isCaptureShadowPath,
  markActorCastShadow,
  markFloorReceiveShadow,
} from "./capture-shadow-map.js";

describe("capture-shadow-map (#249)", () => {
  it("capture path is active only when a capture mode param is present", () => {
    // Learner runtime: no capture param → no shadows.
    expect(isCaptureShadowPath("")).toBe(false);
    // Capture paths (scene-overview is ROOM_CAPTURE_MODE; others carry the same param).
    expect(isCaptureShadowPath("scene-overview")).toBe(true);
    expect(isCaptureShadowPath("actor-realism")).toBe(true);
  });

  it("key light casts shadows only in the capture path", () => {
    const runtime = createCaptureKeyLight({ name: "key", scene: new Scene(), active: false });
    expect(runtime.castShadow).toBe(false);

    const capture = createCaptureKeyLight({ name: "key", scene: new Scene(), active: true });
    expect(capture.castShadow).toBe(true);
    expect(capture.shadow.mapSize.x).toBe(2048);
    expect(capture.shadow.camera.right).toBe(6);
  });

  it("renderer shadow map can be enabled (assigned on a stub — no WebGL in unit env)", () => {
    const renderer = { shadowMap: { enabled: false, type: 0 } } as unknown as WebGLRenderer;
    enableCaptureRendererShadowMap(renderer);
    expect(renderer.shadowMap.enabled).toBe(true);
  });

  it("floor receives and actor meshes cast shadows", () => {
    const floor = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    expect(floor.receiveShadow).toBe(false);
    markFloorReceiveShadow(floor);
    expect(floor.receiveShadow).toBe(true);

    const root = new Group();
    const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    root.add(body);
    expect(body.castShadow).toBe(false);
    markActorCastShadow(root);
    expect(body.castShadow).toBe(true);
    expect(body.userData.openClinXrCaptureShadowPolicy).toBe(
      "cast_shadow_for_capture_path_contact_shadows",
    );
  });
});
