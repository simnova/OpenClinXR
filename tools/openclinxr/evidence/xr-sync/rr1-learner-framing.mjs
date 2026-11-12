#!/usr/bin/env node
/**
 * RR1 learner-framing recorders (pure, offline-testable).
 *
 * The browser runner (rr1-run.mjs --run) calls these helpers: page.evaluate
 * only READS window.__openClinXrGazeCamera (world position/direction, fov,
 * aspect, near, far) and the response tap hashes bytes already received via
 * response.body() (never refetches). All wall-clock comparison semantics live
 * here so vitest can pin them without a browser.
 */
import { createHash } from "node:crypto";

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number; got ${JSON.stringify(value)}`);
  }
  return value;
}

function vec3(value, label) {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label} must be an {x,y,z} object`);
  }
  return {
    x: finiteNumber(value.x, `${label}.x`),
    y: finiteNumber(value.y, `${label}.y`),
    z: finiteNumber(value.z, `${label}.z`),
  };
}

/**
 * Snapshot a camera-like object without mutating it.
 *
 * cameraLike: { position: {x,y,z}, direction: {x,y,z}, fov, aspect, near, far }
 * (the runner builds this plain object inside page.evaluate from
 * cam.getWorldPosition/getWorldDirection plus cam.fov/aspect/near/far, so
 * this helper never touches a live camera).
 */
export function snapshotLearnerPose(cameraLike, wallMs) {
  if (cameraLike === null || typeof cameraLike !== "object") {
    throw new Error("cameraLike must be an object");
  }
  const position = vec3(cameraLike.position, "camera.position");
  const direction = vec3(cameraLike.direction, "camera.direction");
  const snapshot = {
    position,
    direction,
    fov: finiteNumber(cameraLike.fov, "camera.fov"),
    aspect: finiteNumber(cameraLike.aspect, "camera.aspect"),
    near: finiteNumber(cameraLike.near, "camera.near"),
    far: finiteNumber(cameraLike.far, "camera.far"),
    wallMs: finiteNumber(wallMs, "wallMs"),
  };
  return snapshot;
}

function bodyBytes(body) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  throw new Error("body must be a Buffer, Uint8Array, ArrayBuffer, or string");
}

/**
 * Record one environment-GLB response already received by the page.
 *
 * Inputs: url, body bytes (Buffer/Uint8Array, never refetched), response
 * wallMs, sceneReady wallMs, ch1-capture wallMs.
 * loadedBefore* flips exactly at equality (wallMs == marker -> false).
 */
export function recordEnvironmentGlb({ url, body, wallMs, sceneReadyWallMs, ch1WallMs }) {
  if (typeof url !== "string" || url === "") {
    throw new Error("url must be a non-empty string");
  }
  const bytes = bodyBytes(body);
  const responseMs = finiteNumber(wallMs, "wallMs");
  const sceneReadyMs = finiteNumber(sceneReadyWallMs, "sceneReadyWallMs");
  const ch1Ms = finiteNumber(ch1WallMs, "ch1WallMs");
  return {
    url,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    wallMs: responseMs,
    loadedBeforeSceneReady: responseMs < sceneReadyMs,
    loadedBeforeCh1: responseMs < ch1Ms,
  };
}
