/**
 * Inspector silhouette-mask instrument (card W4a-1a): measure the on-screen
 * silhouette of one actor so the coordinator can compare it against the
 * projectActorBbox region (bind-pose box, clamped to the canvas).
 *
 * maskExtent(page, actorId):
 * - finds the node stamped userData.openClinXrActorId === actorId under
 *   window.__openClinXrDebugScene,
 * - hides every Mesh NOT under that node, swaps every effectively-visible
 *   Mesh under it (self + ancestors .visible; hidden nameplates, proxies,
 *   interaction targets and dialogue markers are left untouched and uncounted)
 *   to one shared unlit-white material, sets the scene background to black,
 * - waits 2 requestAnimationFrame, screenshots #station-canvas, restores
 *   visibility/material/background exactly (asserted), then decodes the PNG
 *   in the browser (createImageBitmap + OffscreenCanvas, no dependency),
 * - returns { ok:true, maskRect (canvas CSS px, max(r,g,b) > MASK_THRESHOLD),
 *   pixelCount, meshCount, meshNames, histogram, dpr } or { ok:false, why }.
 *
 * extentOf / histogramOf are pure (no browser) so tests can pin them.
 */

export const MASK_THRESHOLD = 32;
export const HISTOGRAM_HIGH_CUT = 224;
/**
 * Mask cut: pixels with max(r,g,b) > MASK_THRESHOLD count as silhouette.
 * Kept as a named constant (not inline) because the w0/run-6 pixel match
 * (owner 2026-11-12, store site-reimagine/w0/run-6/w0-proof.png vs inspector
 * run-4/run-3 still.png: canvas x0-540 mean|d| 0.79 vs 24.69, best vertical
 * shift 0 vs 22 px) anchors the seated-pose still to run-4 (eye y 1.0949).
 * The cut itself is illustrative; the coordinator decides from the numbers.
 */

/**
 * Bounding rect of pixels with max(r,g,b) > threshold.
 * rgbaArray: Uint8Array/Uint8ClampedArray/Array of RGBA bytes, row-major.
 * Returns {x,y,width,height} in the buffer's pixel units, or null.
 */
export function extentOf(rgbaArray, width, height, threshold = MASK_THRESHOLD) {
  const data = rgbaArray;
  const w = Number(width);
  const h = Number(height);
  const cut = Number(threshold);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  if (data == null || data.length < w * h * 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const m = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (m > cut) {
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Histogram of max(r,g,b) over the buffer: { zero (==0), mid (0<..<224),
 * high (>=224) }. An antialiasing ramp shows as mid-band, not silhouette.
 */
export function histogramOf(rgbaArray, width, height, highCut = HISTOGRAM_HIGH_CUT) {
  const data = rgbaArray;
  const w = Number(width);
  const h = Number(height);
  const cut = Number(highCut);
  const histogram = { zero: 0, mid: 0, high: 0 };
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return histogram;
  if (data == null || data.length < w * h * 4) return histogram;
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const m = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (m === 0) histogram.zero += 1;
    else if (m < cut) histogram.mid += 1;
    else histogram.high += 1;
  }
  return histogram;
}

/**
 * Effective visibility: the node draws only when it AND every ancestor is
 * not hidden. This is the runtime-flag-free exclusion for nameplates,
 * ragdoll-collision proxies, interaction targets and dialogue_target markers:
 * nameplates carry visible=false (+ userData openClinXrDynamicScenePolicy,
 * nameplates.ts:28-31), the proxy/interaction-target parent group carries
 * visible=false (+ userData openClinXrRuntimeVisibilityPolicy,
 * humanoid-cues.ts:150-151), and hidden dialogue_target markers carry
 * visible=false (+ userData openClinXrDynamicScenePolicy,
 * humanoid-cues.ts:23-26; always userData openClinXrAffordanceCueId,
 * humanoid-cues.ts:22). No mesh-name list: the renderer uses no layers
 * (no `.layers.` use in apps/ui-xr/src/main.ts), so self+ancestor .visible
 * is the whole draw test. Self-contained: embedded into the in-page setup
 * via toString, so the page copy and this export cannot diverge.
 */
export function isEffectivelyVisible(node) {
  let current = node;
  while (current !== null && current !== undefined) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

/**
 * In-page mask setup. Self-contained apart from its isVisible parameter and
 * globalThis.__openClinXrDebugScene / __openClinXrMaskSaved. Only meshes that
 * are BOTH under the stamped actor root AND effectively visible are whitened
 * and counted; every other mesh is hidden; background goes black. Returns
 * setup { ok, meshCount, meshNames } or { ok:false, why }.
 */
export function planMaskSetupInner(actorId, isVisible) {
  const debugScene = globalThis.__openClinXrDebugScene;
  if (debugScene === undefined || debugScene === null) {
    return { ok: false, why: "no window.__openClinXrDebugScene" };
  }
  let actorRoot = null;
  debugScene.traverse((node) => {
    if (actorRoot !== null) return;
    if (node?.userData?.openClinXrActorId === actorId) actorRoot = node;
  });
  if (actorRoot === null) {
    return { ok: false, why: "no scene node stamped " + String(actorId) };
  }
  const visibleOf = typeof isVisible === "function" ? isVisible : isEffectivelyVisibleFallback;
  function isEffectivelyVisibleFallback(node) {
    let current = node;
    while (current !== null && current !== undefined) {
      if (current.visible === false) return false;
      current = current.parent;
    }
    return true;
  }
  let scene = actorRoot;
  while (scene.parent !== null && scene.parent !== undefined) scene = scene.parent;
  const saved = [];
  const actorMeshes = [];
  const isUnderActor = (obj) => {
    let node = obj;
    while (node !== null && node !== undefined) {
      if (node === actorRoot) return true;
      node = node.parent;
    }
    return false;
  };
  debugScene.traverse((obj) => {
    if (obj?.isMesh !== true) return;
    const underActor = isUnderActor(obj);
    const draws = visibleOf(obj) === true;
    const swapped = underActor && draws;
    saved.push({ id: obj.id, visible: obj.visible, material: obj.material, underActor, draws, swapped });
    if (swapped) actorMeshes.push(obj);
    else if (!underActor) obj.visible = false;
  });
  if (actorMeshes.length === 0) {
    for (const row of saved) {
      const obj = debugScene.getObjectById(row.id);
      if (obj) obj.visible = row.visible;
    }
    return { ok: false, why: "actor has no effectively-visible Mesh descendants: " + String(actorId) };
  }
  const firstMaterial = Array.isArray(actorMeshes[0].material) ? actorMeshes[0].material[0] : actorMeshes[0].material;
  const white = firstMaterial.clone();
  if (white.color !== undefined && white.color !== null && typeof white.color.setRGB === "function") {
    white.color.setRGB(1, 1, 1);
  }
  if (white.emissive !== undefined && white.emissive !== null && typeof white.emissive.setRGB === "function") {
    white.emissive.setRGB(1, 1, 1);
  }
  if ("emissiveIntensity" in white) white.emissiveIntensity = 1;
  if ("map" in white) white.map = null;
  if ("vertexColors" in white) white.vertexColors = false;
  if ("transparent" in white) white.transparent = false;
  if ("opacity" in white) white.opacity = 1;
  if (typeof white.needsUpdate !== "undefined") white.needsUpdate = true;
  for (const mesh of actorMeshes) {
    mesh.material = white;
  }
  const ColorClass = (white.color !== undefined && white.color !== null)
    ? white.color.constructor
    : (scene.background !== null && scene.background !== undefined ? scene.background.constructor : null);
  const savedBackground = scene.background;
  if (ColorClass !== null) {
    scene.background = new ColorClass(0, 0, 0);
  } else {
    for (const row of saved) {
      const obj = debugScene.getObjectById(row.id);
      if (obj) {
        obj.visible = row.visible;
        if (row.swapped) obj.material = row.material;
      }
    }
    return { ok: false, why: "cannot construct a black scene background" };
  }
  globalThis.__openClinXrMaskSaved = {
    actorId,
    sceneId: scene.id,
    saved,
    savedBackground,
    whiteMaterialId: white.id,
  };
  const meshNames = actorMeshes.map((mesh) => mesh.name || ("mesh#" + mesh.id));
  return {
    ok: true,
    meshCount: actorMeshes.length,
    meshNames,
  };
}

export const SETUP_SOURCE = `((actorId) => {
  const isEffectivelyVisible = ${isEffectivelyVisible.toString()};
  return (${planMaskSetupInner.toString()})(actorId, isEffectivelyVisible);
})`;

/**
 * In-page mask restore. Self-contained apart from globalThis. Restores, in
 * order: visibility for every recorded mesh, material for every swapped mesh
 * (asserting unswapped materials are untouched), background by reference.
 * Any mismatch resolves { ok:false, why }.
 */
export function planMaskRestore() {
  const stash = globalThis.__openClinXrMaskSaved;
  if (stash === undefined || stash === null) {
    return { ok: false, why: "no saved mask state to restore" };
  }
  const debugScene = globalThis.__openClinXrDebugScene;
  const scene = debugScene !== undefined && debugScene !== null
    ? (() => { let s = debugScene; while (s.parent !== null && s.parent !== undefined) s = s.parent; return s; })()
    : null;
  const failures = [];
  for (const row of stash.saved) {
    const obj = debugScene.getObjectById(row.id);
    if (obj === undefined || obj === null) {
      failures.push("missing mesh id " + row.id);
      continue;
    }
    obj.visible = row.visible;
    if (row.swapped === true) {
      obj.material = row.material;
    }
    if (obj.visible !== row.visible) failures.push("visibility not restored id " + row.id);
    if (obj.material !== row.material) failures.push("material not restored id " + row.id);
  }
  if (scene !== null) {
    scene.background = stash.savedBackground;
    if (scene.background !== stash.savedBackground) failures.push("background not restored");
  } else {
    failures.push("no scene for background restore");
  }
  globalThis.__openClinXrMaskSaved = null;
  if (failures.length > 0) {
    return { ok: false, why: "restore mismatch: " + failures.join("; ") };
  }
  return { ok: true, restored: stash.saved.length };
}

export const RESTORE_SOURCE = `(${planMaskRestore.toString()})`;

/**
 * Measure one actor's silhouette. Never throws for a missing actor: those
 * resolve { ok:false, why } so the run can record instead of crash.
 */
export async function maskExtent(page, actorId) {
  const setup = await page.evaluate(`(${SETUP_SOURCE})(${JSON.stringify(actorId)})`);
  if (setup?.ok !== true) {
    return { ok: false, why: setup?.why ?? "unknown mask setup failure" };
  }
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const dpr = await page.evaluate(() => globalThis.window?.devicePixelRatio ?? 1);
  let png;
  try {
    png = await page.locator("#station-canvas").screenshot();
  } catch (error) {
    await page.evaluate(`(${RESTORE_SOURCE})()`);
    return { ok: false, why: `canvas screenshot failed: ${error?.message ?? String(error)}` };
  }
  const restore = await page.evaluate(`(${RESTORE_SOURCE})()`);
  if (restore?.ok !== true) {
    return { ok: false, why: restore?.why ?? "unknown mask restore failure" };
  }
  const decoded = await page.evaluate(
    async ({ bytes, threshold, highCut }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const data = image.data;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let pixelCount = 0;
      let zero = 0;
      let mid = 0;
      let high = 0;
      for (let y = 0; y < bitmap.height; y += 1) {
        for (let x = 0; x < bitmap.width; x += 1) {
          const i = (y * bitmap.width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const m = r > g ? (r > b ? r : b) : g > b ? g : b;
          if (m === 0) zero += 1;
          else if (m < highCut) mid += 1;
          else high += 1;
          if (m > threshold) {
            pixelCount += 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      return {
        deviceWidth: bitmap.width,
        deviceHeight: bitmap.height,
        deviceRect:
          pixelCount === 0
            ? null
            : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
        pixelCount,
        histogram: { zero, mid, high },
      };
    },
    { bytes: Array.from(png), threshold: MASK_THRESHOLD, highCut: HISTOGRAM_HIGH_CUT },
  );
  const scale = Number(dpr) > 0 ? Number(dpr) : 1;
  const deviceRect = decoded?.deviceRect ?? null;
  const maskRect =
    deviceRect === null
      ? null
      : {
          x: deviceRect.x / scale,
          y: deviceRect.y / scale,
          width: deviceRect.width / scale,
          height: deviceRect.height / scale,
        };
  return {
    ok: true,
    maskRect,
    pixelCount: decoded.pixelCount,
    meshCount: setup.meshCount,
    meshNames: setup.meshNames,
    histogram: decoded.histogram,
    dpr: scale,
  };
}
