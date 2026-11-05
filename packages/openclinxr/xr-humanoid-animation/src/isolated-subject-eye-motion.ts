import { Group, Quaternion, Vector3, type Object3D } from "three";

/** Conversation-relative states supported by the one-subject capture lab. */
export type IsolatedSubjectEyeMotionState = "listening" | "rest";

/** Applied morph and eye-bone readback captured after one product animation frame. */
export type IsolatedSubjectEyeMotionFrame = {
  tMs: number;
  state: IsolatedSubjectEyeMotionState;
  blinkClosureInfluence: number | null;
  leftEyeYaw: number | null;
  leftEyePitch: number | null;
};

/** Product eye-motion function injected into the package-neutral isolated lab. */
export type IsolatedSubjectEyeMotionDriver = (
  root: Group,
  state: IsolatedSubjectEyeMotionState,
  nowMs: number,
) => number;

/** Window-shaped surface used by the isolated lab without coupling its scene package. */
export type IsolatedSubjectEyeMotionSurface = {
  location?: { search: string };
  __openClinXrIsolatedSceneRoot?: Object3D;
  __openClinXrIsolatedRenderFrame?: () => void;
  __openClinXrProductEyeMotionDriver?: IsolatedSubjectEyeMotionDriver;
  __openClinXrIsolatedEyeMotionFrames?: IsolatedSubjectEyeMotionFrame[];
  __openClinXrIsolatedEyeMotionFrame?: (nowMs: number) => IsolatedSubjectEyeMotionFrame;
};

type InstallOptions = {
  state: IsolatedSubjectEyeMotionState | null;
  root: Group;
  driver: IsolatedSubjectEyeMotionDriver;
  render: () => void;
  startedAtMs: number;
};

const WORLD_UP = new Vector3(0, 1, 0);
const LOCAL_GAZE = new Vector3(0, 1, 0);

function signedAngle(from: Vector3, to: Vector3, axis: Vector3): number {
  const angle = from.angleTo(to);
  return Math.sign(from.clone().cross(to).dot(axis)) * angle;
}

function finiteVector(raw: unknown): Vector3 | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const [x, y, z] = raw;
  if (![x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return new Vector3(x as number, y as number, z as number).normalize();
}

function findLeftEye(root: Group): Object3D | undefined {
  return root.getObjectByName("eyeL") ?? root.getObjectByName("mixamorig:LeftEye");
}

function readLeftEyeAngles(root: Group): { yaw: number | null; pitch: number | null } {
  const control = root.getObjectByName("openclinxr_left_eye_gaze_control");
  if (control) {
    const base = control.userData["openClinXrRigControlBaseTransform"] as
      | { rotation?: { x?: unknown; y?: unknown } }
      | undefined;
    const baseX = typeof base?.rotation?.x === "number" ? base.rotation.x : 0;
    const baseY = typeof base?.rotation?.y === "number" ? base.rotation.y : 0;
    return { yaw: control.rotation.y - baseY, pitch: control.rotation.x - baseX };
  }
  const eye = findLeftEye(root);
  if (!eye) return { yaw: null, pitch: null };
  const rest = finiteVector(eye.userData["openClinXrEyeRestWorldForward"]);
  const right = finiteVector(eye.userData["openClinXrEyeHeadWorldRight"]);
  if (!rest || !right) return { yaw: null, pitch: null };
  eye.updateWorldMatrix(true, false);
  const current = LOCAL_GAZE.clone().applyQuaternion(eye.getWorldQuaternion(new Quaternion())).normalize();
  const yaw = signedAngle(rest, current, WORLD_UP);
  const yawedRest = rest.clone().applyAxisAngle(WORLD_UP, yaw);
  return { yaw, pitch: signedAngle(yawedRest, current, right) };
}

function readMeanClosure(root: Group): number | null {
  let left: number | null = null;
  let right: number | null = null;
  root.traverse((object) => {
    const candidate = object as Object3D & {
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    };
    const dictionary = candidate.morphTargetDictionary;
    const influences = candidate.morphTargetInfluences;
    if (!dictionary || !influences) return;
    for (const [name, index] of Object.entries(dictionary)) {
      const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const isLeft = normalized === "openclinxr-eye-left-closure" || normalized === "eye-left-closure";
      const isRight = normalized === "openclinxr-eye-right-closure" || normalized === "eye-right-closure";
      if (!isLeft && !isRight) continue;
      const value = influences[index];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (isLeft) left = left === null ? value : Math.max(left, value);
      if (isRight) right = right === null ? value : Math.max(right, value);
    }
  });
  const values: number[] = [];
  if (left !== null) values.push(left);
  if (right !== null) values.push(right);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Install the lab frame/readback hook only when eye motion was explicitly requested. */
export function installIsolatedSubjectEyeMotionFrame(
  surface: IsolatedSubjectEyeMotionSurface,
  options: InstallOptions,
): boolean {
  if (options.state === null) return false;
  const frames: IsolatedSubjectEyeMotionFrame[] = [];
  surface.__openClinXrIsolatedEyeMotionFrames = frames;
  surface.__openClinXrIsolatedEyeMotionFrame = (nowMs) => {
    options.driver(options.root, options.state as IsolatedSubjectEyeMotionState, nowMs);
    options.root.updateMatrixWorld(true);
    const closure = readMeanClosure(options.root);
    const angles = readLeftEyeAngles(options.root);
    const frame: IsolatedSubjectEyeMotionFrame = {
      tMs: Number(Math.max(0, nowMs - options.startedAtMs).toFixed(3)),
      state: options.state as IsolatedSubjectEyeMotionState,
      blinkClosureInfluence: closure === null ? null : Number(closure.toFixed(6)),
      leftEyeYaw: angles.yaw === null ? null : Number(angles.yaw.toFixed(6)),
      leftEyePitch: angles.pitch === null ? null : Number(angles.pitch.toFixed(6)),
    };
    frames.push(frame);
    options.render();
    return frame;
  };
  return true;
}

/** Parse an opt-in eyeMotion value from direct query fields or the lab's JSON subject spec. */
export function requestedIsolatedEyeMotion(search: string): IsolatedSubjectEyeMotionState | null {
  const params = new URLSearchParams(search);
  const direct = params.get("eyeMotion");
  if (direct === "listening" || direct === "rest") return direct;
  const rawSubject = params.get("subject");
  if (!rawSubject) return null;
  try {
    const parsed = JSON.parse(rawSubject) as { eyeMotion?: unknown };
    return parsed.eyeMotion === "listening" || parsed.eyeMotion === "rest" ? parsed.eyeMotion : null;
  } catch {
    return null;
  }
}

/** Wait for xr-scene to load the isolated body, then advance the product eye driver. */
export function bootIsolatedSubjectEyeMotion(
  surface: IsolatedSubjectEyeMotionSurface,
  driver?: IsolatedSubjectEyeMotionDriver,
  requestFrame?: (callback: FrameRequestCallback) => number,
  now?: () => number,
): boolean {
  const state = requestedIsolatedEyeMotion(surface.location?.search ?? "");
  if (state === null) return false;
  const productDriver = driver ?? surface.__openClinXrProductEyeMotionDriver;
  if (!productDriver) throw new Error("eyeMotion requested but the apps-side product eye-motion bridge is absent");
  const scheduleFrame = requestFrame ?? requestAnimationFrame;
  const currentTime = now ?? (() => performance.now());
  const waitForSubject = (): void => {
    const root = surface.__openClinXrIsolatedSceneRoot;
    const render = surface.__openClinXrIsolatedRenderFrame;
    if (!(root instanceof Group) || !render) {
      scheduleFrame(waitForSubject);
      return;
    }
    installIsolatedSubjectEyeMotionFrame(surface, { state, root, driver: productDriver, render, startedAtMs: currentTime() });
    const advance = (nowMs: number): void => {
      surface.__openClinXrIsolatedEyeMotionFrame?.(nowMs);
      scheduleFrame(advance);
    };
    scheduleFrame(advance);
  };
  scheduleFrame(waitForSubject);
  return true;
}
