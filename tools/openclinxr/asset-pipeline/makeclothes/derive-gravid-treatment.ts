/**
 * derive-gravid-treatment.ts — re-derive the recorded #581/#509 gravid treatment
 * field from the repo's own history, and write recorded-gravid-treatment.json.
 *
 * BACKGROUND (measured 2026-10-30): the OB 34-week patient's treated body was
 * wiped by the 4b151efbe WIP rebake (fresh materializer export without
 * --pregnancy-weeks) and carried forward through the 2803b7746 fp-r0.4
 * decimation and the HB-02 42c42140a albedo rebake — not by HB-02 itself.
 * The bake-chain wiring (--pregnancy-weeks in
 * materialize_mpfb_humanoid_candidate.py + pregnancy_target.py) is still live,
 * but no caller passes the flag, so the recorded treatment below is the
 * chain's way back. A full materializer re-bake is refused: it would replay
 * months of pinned post-bake work (teeth #739/#741, walk bind, chest anchors,
 * albedo HB-02, garment extras) and each replay breaks other pins.
 *
 * METHOD (order-preserving-subset transfer — verified, not assumed):
 *  - T = 57e277301 OB GLB (treated abdomen 319.22 mm = the TREATED pin 319.2).
 *  - U = 4b151efbe OB GLB (untreated 246.52 mm, same tightjeans recipe:
 *    every garment/face/teeth mesh bit-identical except the gravid refit).
 *  - The foot body primitive (1910 verts) is per-index bit-identical between
 *    T and U, proving both bakes share MPFB base ordering. Other body prims
 *    differ by garment-masking deletions only, so per-prim greedy monotone
 *    alignment on exact positions recovers the index map (9978/10012 skin
 *    anchors; all residual asymmetric gaps sit in zero-delta zones).
 *  - Garments the #581 bake refit (t-shirt 270 verts to 77.1 mm, tight jeans
 *    1582 verts to 69.4 mm) transfer per-index (equal counts, order kept).
 *  - C (the shipped decimated GLB) is a 100% exact-position subset of U, so
 *    the field lands on identical bytes. Unmoved verts keep their shipped
 *    normals (the recorded bake's normals agree there up to neighbour tilt,
 *    except at duplicate-seam picks where they can flip 180°).
 *
 * Run: tsx tools/openclinxr/asset-pipeline/makeclothes/derive-gravid-treatment.ts \
 *        --treated-blob /tmp/ob-57e2.glb --untreated-blob /tmp/ob-4b15.glb \
 *        --target apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb \
 *        [--out <artifact>] [--check]
 * (Blobs: `git show 57e277301:<path>` and `git show 4b151efbe:<path>`.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const TREATED_REV = "57e277301";
const UNTREATED_REV = "4b151efbe";
const GLB_PATH = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
const BODY_RE = /_body$|^mpfb$/;
const GARMENT_RES = [/tight_jeans/, /t_shirt/];
const MOVE_EPS_M = 0.0002; // below this a vert is unmoved: no entry is stored
const BAND_LO = 0.4;
const BAND_HI = 0.66; // every stored delta must sit in the abdomen stature band

interface Entry { m: string; p: number; i: number; d: [number, number, number]; n: [number, number, number]; }

const keyOf = (a: ArrayLike<number>, i: number): string => `${a[3 * i]},${a[3 * i + 1]},${a[3 * i + 2]}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const treatedBlob = opt("--treated-blob") ?? `/tmp/ob-treated-${TREATED_REV}.glb`;
  const untreatedBlob = opt("--untreated-blob") ?? `/tmp/ob-untreated-${UNTREATED_REV}.glb`;
  const target = opt("--target") ?? GLB_PATH;
  const out = opt("--out") ?? "tools/openclinxr/asset-pipeline/makeclothes/recorded-gravid-treatment.json";
  const check = args.includes("--check");

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const findMesh = (doc: Awaited<ReturnType<NodeIO["read"]>>, re: RegExp) => {
    for (const m of doc.getRoot().listMeshes()) {
      if (re.test(m.getName() ?? "")) return m;
    }
    throw new Error(`no mesh matching ${re}`);
  };
  const [Tdoc, Udoc, Cdoc] = await Promise.all([treatedBlob, untreatedBlob, target].map((f) => io.read(f)));
  const Tb = findMesh(Tdoc, BODY_RE).listPrimitives();
  const Ub = findMesh(Udoc, BODY_RE).listPrimitives();
  const Cb = findMesh(Cdoc, BODY_RE).listPrimitives();

  // Stature from the untreated full-res body.
  let minY = Infinity, maxY = -Infinity;
  for (const p of Ub) {
    const a = p.getAttribute("POSITION")!.getArray() as Float32Array;
    for (let i = 1; i < a.length; i += 3) {
      if (a[i]! < minY) minY = a[i]!;
      if (a[i]! > maxY) maxY = a[i]!;
    }
  }
  const H = maxY - minY;

  const entries: Entry[] = [];
  const topology: Record<string, number[]> = {};
  const stats = { anchors: 0, gapSym: 0, gapAsym: 0, maxMm: 0, yfMin: 1, yfMax: 0 };

  const cBodyName = findMesh(Cdoc, BODY_RE).getName()!;
  if (Tb.length !== Ub.length || Ub.length !== Cb.length) {
    throw new Error(`body prim count mismatch T=${Tb.length} U=${Ub.length} C=${Cb.length}`);
  }
  topology[cBodyName] = Cb.map((p) => p.getAttribute("POSITION")!.getCount());

  for (let k = 0; k < Ub.length; k++) {
    const ta = Tb[k]!.getAttribute("POSITION")!.getArray() as Float32Array;
    const tn = Tb[k]!.getAttribute("NORMAL")!.getArray() as Float32Array;
    const ua = Ub[k]!.getAttribute("POSITION")!.getArray() as Float32Array;
    const un = Ub[k]!.getAttribute("NORMAL")!.getArray() as Float32Array;
    const ca = Cb[k]!.getAttribute("POSITION")!.getArray() as Float32Array;
    const cn = Cb[k]!.getAttribute("NORMAL")!.getArray() as Float32Array;
    const nu = ua.length / 3, nt = ta.length / 3, nc = ca.length / 3;

    // Greedy monotone alignment U -> T on exact positions; among duplicate
    // positions prefer the seam-side whose recorded normal best matches.
    const tByPos = new Map<string, number[]>();
    for (let j = 0; j < nt; j++) {
      const kk = keyOf(ta, j);
      let l = tByPos.get(kk);
      if (!l) tByPos.set(kk, (l = []));
      l.push(j);
    }
    const map = new Int32Array(nu).fill(-1);
    let cursor = 0, anchored = 0;
    for (let i = 0; i < nu; i++) {
      const l = tByPos.get(keyOf(ua, i));
      if (!l) continue;
      let pick = -1, best = Infinity;
      for (const j of l) {
        if (j < cursor) continue;
        const dx = tn[3 * j]! - un[3 * i]!, dy = tn[3 * j + 1]! - un[3 * i + 1]!, dz = tn[3 * j + 2]! - un[3 * i + 2]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; pick = j; }
      }
      if (pick >= 0) { map[i] = pick; cursor = pick + 1; anchored++; }
    }
    // Gap fill: symmetric gaps are index-exact; asymmetric gaps (masking
    // deletions with no counterpart) interpolate the DELTA from brackets.
    let prevU = -1, prevT = -1;
    const flush = (uEnd: number, tEnd: number): void => {
      const lu = uEnd - prevU - 1, lt = tEnd - prevT - 1;
      if (lu === 0) return;
      if (lu === lt) { stats.gapSym += lu; for (let q = 1; q <= lu; q++) map[prevU + q] = prevT + q; }
      else stats.gapAsym += lu; // left at -1: handled as lerp below
    };
    for (let i = 0; i < nu; i++) {
      if (map[i]! >= 0) { flush(i, map[i]!); prevU = i; prevT = map[i]!; }
    }
    flush(nu, nt);
    stats.anchors += anchored;

    const deltaOf = (i: number): [number, number, number] => {
      const j = map[i]!;
      return [ta[3 * j]! - ua[3 * i]!, ta[3 * j + 1]! - ua[3 * i + 1]!, ta[3 * j + 2]! - ua[3 * i + 2]!];
    };
    const deltas = new Float32Array(nu * 3);
    const normals = new Float32Array(nu * 3);
    for (let i = 0; i < nu; i++) {
      if (map[i]! < 0) {
        let lo = i - 1;
        while (lo >= 0 && map[lo]! < 0) lo--;
        let hi = i + 1;
        while (hi < nu && map[hi]! < 0) hi++;
        const L = lo >= 0 ? deltaOf(lo) : deltaOf(hi);
        const Hh = hi < nu ? deltaOf(hi) : deltaOf(lo);
        const t = lo >= 0 && hi < nu ? (i - lo) / (hi - lo) : 0;
        deltas[3 * i] = L[0] + (Hh[0] - L[0]) * t;
        deltas[3 * i + 1] = L[1] + (Hh[1] - L[1]) * t;
        deltas[3 * i + 2] = L[2] + (Hh[2] - L[2]) * t;
        const j = i - lo <= hi - i && lo >= 0 ? map[lo]! : hi < nu ? map[hi]! : map[lo]!;
        normals[3 * i] = tn[3 * j]!; normals[3 * i + 1] = tn[3 * j + 1]!; normals[3 * i + 2] = tn[3 * j + 2]!;
        continue;
      }
      const [dx, dy, dz] = deltaOf(i);
      deltas[3 * i] = dx; deltas[3 * i + 1] = dy; deltas[3 * i + 2] = dz;
      const j = map[i]!;
      normals[3 * i] = tn[3 * j]!; normals[3 * i + 1] = tn[3 * j + 1]!; normals[3 * i + 2] = tn[3 * j + 2]!;
    }

    // C -> U by exact position (normal-aware among duplicates).
    const uByPos = new Map<string, number[]>();
    for (let i = 0; i < nu; i++) {
      const kk = keyOf(ua, i);
      let l = uByPos.get(kk);
      if (!l) uByPos.set(kk, (l = []));
      l.push(i);
    }
    for (let i = 0; i < nc; i++) {
      const l = uByPos.get(keyOf(ca, i));
      if (!l) throw new Error(`body prim ${k} vert ${i}: no untreated counterpart — target topology drifted`);
      let u = l[0]!, best = Infinity;
      for (const q of l) {
        const dx = un[3 * q]! - cn[3 * i]!, dy = un[3 * q + 1]! - cn[3 * i + 1]!, dz = un[3 * q + 2]! - cn[3 * i + 2]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; u = q; }
      }
      const dx = deltas[3 * u]!, dy = deltas[3 * u + 1]!, dz = deltas[3 * u + 2]!;
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (m < MOVE_EPS_M) continue;
      const yf = (ua[3 * u + 1]! - minY) / H;
      if (!(yf >= BAND_LO && yf <= BAND_HI)) {
        throw new Error(`body prim ${k} vert ${i}: ${(m * 1000).toFixed(1)} mm delta at yf=${yf.toFixed(3)} — outside the abdomen band`);
      }
      if (m > stats.maxMm) stats.maxMm = m;
      if (yf < stats.yfMin) stats.yfMin = yf;
      if (yf > stats.yfMax) stats.yfMax = yf;
      entries.push({
        m: cBodyName, p: k, i,
        d: [dx, dy, dz],
        n: [normals[3 * u]!, normals[3 * u + 1]!, normals[3 * u + 2]!],
      });
    }
  }

  // Garments the #581 bake refit: per-index field (equal counts, order kept).
  for (const re of GARMENT_RES) {
    const tm = findMesh(Tdoc, re), um = findMesh(Udoc, re), cm = findMesh(Cdoc, re);
    const tp = tm.listPrimitives()[0]!, up = um.listPrimitives()[0]!, cp = cm.listPrimitives()[0]!;
    const cName = cm.getName() ?? tm.getName() ?? "?";
    const ta = tp.getAttribute("POSITION")!.getArray() as Float32Array;
    const tn = tp.getAttribute("NORMAL")!.getArray() as Float32Array;
    const ua = up.getAttribute("POSITION")!.getArray() as Float32Array;
    const ca = cp.getAttribute("POSITION")!.getArray() as Float32Array;
    const n = ta.length / 3, nc = ca.length / 3;
    if (ua.length / 3 !== n) throw new Error(`garment ${re}: count mismatch T=${n} U=${ua.length / 3}`);
    topology[cName] = [nc];
    const uByPos = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const kk = keyOf(ua, i);
      let l = uByPos.get(kk);
      if (!l) uByPos.set(kk, (l = []));
      l.push(i);
    }
    const una = up.getAttribute("NORMAL")!.getArray() as Float32Array;
    const cna = cp.getAttribute("NORMAL")!.getArray() as Float32Array;
    for (let i = 0; i < nc; i++) {
      const l = uByPos.get(keyOf(ca, i));
      if (!l) throw new Error(`garment ${re} vert ${i}: no untreated counterpart`);
      let j = l[0]!, best = Infinity;
      for (const q of l) {
        const dx = una[3 * q]! - cna[3 * i]!, dy = una[3 * q + 1]! - cna[3 * i + 1]!, dz = una[3 * q + 2]! - cna[3 * i + 2]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; j = q; }
      }
      const dx = ta[3 * j]! - ua[3 * j]!, dy = ta[3 * j + 1]! - ua[3 * j + 1]!, dz = ta[3 * j + 2]! - ua[3 * j + 2]!;
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (m < MOVE_EPS_M) continue;
      const yf = (ua[3 * j + 1]! - minY) / H;
      if (!(yf >= BAND_LO && yf <= BAND_HI)) {
        throw new Error(`garment ${re} vert ${i}: ${(m * 1000).toFixed(1)} mm delta at yf=${yf.toFixed(3)} — outside the abdomen band`);
      }
      if (m > stats.maxMm) stats.maxMm = m;
      if (yf < stats.yfMin) stats.yfMin = yf;
      if (yf > stats.yfMax) stats.yfMax = yf;
      entries.push({ m: cName, p: 0, i, d: [dx, dy, dz], n: [tn[3 * j]!, tn[3 * j + 1]!, tn[3 * j + 2]!] });
    }
  }

  const artifact = {
    schemaVersion: "openclinxr.recorded-gravid-treatment.v1",
    target: GLB_PATH,
    provenance: {
      treated: { rev: TREATED_REV, path: GLB_PATH, note: "abdomen 319.22 mm — the #581 TREATED pin" },
      untreated: { rev: UNTREATED_REV, path: GLB_PATH, note: "abdomen 246.52 mm — same tightjeans recipe, no --pregnancy-weeks" },
      wipe: { rev: "4b151efbe", note: "WIP rebake dropped the treatment; 2803b7746 decimation + 42c42140a HB-02 carried the untreated bytes forward" },
      method: "order-preserving-subset transfer of the recorded #581 displacement field (MakeHuman-derived via pregnancy_target.py at 34wk/weight 0.85); no hand-authored geometry",
      derivation: "derive-gravid-treatment.ts",
    },
    derivationStats: {
      bodyAnchors: stats.anchors,
      symmetricGapVerts: stats.gapSym,
      lerpedGapVerts: stats.gapAsym,
      maxDeltaMm: Math.round(stats.maxMm * 1000 * 10) / 10,
      entryBandYf: [Math.round(stats.yfMin * 1e4) / 1e4, Math.round(stats.yfMax * 1e4) / 1e4],
      moveEpsilonMm: MOVE_EPS_M * 1000,
    },
    topology,
    entries,
  };

  if (check) {
    const prev = JSON.parse(readFileSync(out, "utf8")) as typeof artifact;
    const a = JSON.stringify(prev.entries);
    const b = JSON.stringify(entries);
    if (a !== b) throw new Error(`--check: re-derived field differs from ${out}`);
    process.stdout.write(JSON.stringify({ check: "match", entries: entries.length }, null, 2) + "\n");
    return;
  }
  writeFileSync(out, JSON.stringify(artifact, null, 1) + "\n");
  process.stdout.write(JSON.stringify({
    out, entries: entries.length,
    maxDeltaMm: artifact.derivationStats.maxDeltaMm,
    entryBandYf: artifact.derivationStats.entryBandYf,
    anchors: stats.anchors, gapSym: stats.gapSym, gapAsym: stats.gapAsym,
  }, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
