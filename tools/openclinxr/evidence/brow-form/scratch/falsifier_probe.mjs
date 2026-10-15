import { NodeIO } from "@gltf-transform/core";

// Falsifier probe: replicate the-reduced-eyebrow gate instrument
// (the-reduced-eyebrow-still-spans-and-darkens-the-brow-band.test.ts:168-207)
// on the motivating head + shipped Aisha, plus /eyebrow/i presence
// (every-actor-has-brows-lashes-and-teeth.test.ts:124).
const GRID_X = 96, GRID_Y = 24, PAD_X = 0.5, Y_BELOW = 0.3, Y_ABOVE = 0.5;
const REF = { covFrac: 0.122, inkPerEye: 1.24 }; // pinned aisha row (:99)

function primOf(doc, re) {
  for (const mesh of doc.getRoot().listMeshes()) {
    if (re.test(mesh.getName() ?? "")) {
      const prim = mesh.listPrimitives()[0];
      if (prim) return prim;
    }
  }
  return null;
}
function xyTriangles(prim) {
  const pos = prim.getAttribute("POSITION");
  const idx = prim.getIndices();
  const arr = pos.getArray(), iarr = idx.getArray();
  const tris = [];
  for (let t = 0; t < iarr.length; t += 3) {
    const i0 = iarr[t], i1 = iarr[t + 1], i2 = iarr[t + 2];
    tris.push([arr[i0 * 3], arr[i0 * 3 + 1], arr[i1 * 3], arr[i1 * 3 + 1], arr[i2 * 3], arr[i2 * 3 + 1]]);
  }
  return tris;
}
function eyeBand(doc) {
  const eyes = primOf(doc, /eyes_low_poly/i);
  const pos = eyes.getAttribute("POSITION");
  const arr = pos.getArray();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.getCount(); i++) {
    x0 = Math.min(x0, arr[i * 3]); x1 = Math.max(x1, arr[i * 3]);
    y0 = Math.min(y0, arr[i * 3 + 1]); y1 = Math.max(y1, arr[i * 3 + 1]);
  }
  const w = x1 - x0, h = y1 - y0;
  return { x0: x0 - PAD_X * w, x1: x1 + PAD_X * w, y0: y1 - Y_BELOW * h, y1: y1 + Y_ABOVE * h };
}
function projectedArea(tris) {
  let a = 0;
  for (const t of tris) a += Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2;
  return a;
}
function bandCoverage(tris, band) {
  const cw = (band.x1 - band.x0) / GRID_X, ch = (band.y1 - band.y0) / GRID_Y;
  const hit = new Uint8Array(GRID_X * GRID_Y);
  for (const t of tris) {
    const d = (t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]);
    if (Math.abs(d) < 1e-12) continue;
    const gx0 = Math.max(0, Math.floor((Math.min(t[0], t[2], t[4]) - band.x0) / cw));
    const gx1 = Math.min(GRID_X - 1, Math.ceil((Math.max(t[0], t[2], t[4]) - band.x0) / cw));
    const gy0 = Math.max(0, Math.floor((Math.min(t[1], t[3], t[5]) - band.y0) / ch));
    const gy1 = Math.min(GRID_Y - 1, Math.ceil((Math.max(t[1], t[3], t[5]) - band.y0) / ch));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      if (hit[gy * GRID_X + gx]) continue;
      const px = band.x0 + (gx + 0.5) * cw, py = band.y0 + (gy + 0.5) * ch;
      const w0 = ((t[2] - px) * (t[5] - py) - (t[4] - px) * (t[3] - py)) / d;
      const w1 = ((t[4] - px) * (t[1] - py) - (t[0] - px) * (t[5] - py)) / d;
      if (w0 >= -1e-6 && w1 >= -1e-6 && 1 - w0 - w1 >= -1e-6) hit[gy * GRID_X + gx] = 1;
    }
  }
  let n = 0; for (const h of hit) n += h;
  return n / (GRID_X * GRID_Y);
}
const io = new NodeIO();
const out = {};
for (const [tag, f] of [
  ["motivating_head", "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/regen3/aisha-ref3.glb"],
  ["shipped_aisha", "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb"],
]) {
  const doc = await io.read(f);
  const names = doc.getRoot().listMeshes().map((m) => m.getName() ?? "");
  const hasEyebrow = names.some((n) => /eyebrow/i.test(n));
  const browTris = xyTriangles(primOf(doc, /fitted_eyebrow/i));
  const eyeTris = xyTriangles(primOf(doc, /eyes_low_poly/i));
  const cov = bandCoverage(browTris, eyeBand(doc));
  const ink = projectedArea(browTris) / Math.max(projectedArea(eyeTris), 1e-12);
  out[tag] = { has_eyebrow_mesh: hasEyebrow, brow_tris: browTris.length,
    cov: +cov.toFixed(4), cov_floor: +(REF.covFrac * 0.25).toFixed(4), cov_pass: cov >= REF.covFrac * 0.25,
    inkPerEye: +ink.toFixed(3), ink_floor: +(REF.inkPerEye * 0.1).toFixed(3), ink_pass: ink >= REF.inkPerEye * 0.1 };
}
console.log(JSON.stringify(out, null, 1));
