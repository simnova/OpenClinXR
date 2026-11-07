// Gate checker for hair-scalp-1 row-scalp.json.
// Usage: node tools/openclinxr/evidence/hair-scalp/check-scalp.mjs [--self-test]
// Exit 0 iff every gate PASSES. --self-test builds an all-pass row from the
// real one, asserts it passes, then plants one violation per gate and asserts
// each is reported MISS (fails otherwise).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const E = dirname(fileURLToPath(import.meta.url));
const ROW = join(E, "row-scalp.json");

function fail(id, detail) {
  return { id, status: "MISS", detail };
}
function pass(id, detail) {
  return { id, status: "PASS", detail };
}

function checkGates(row) {
  const out = [];
  const C = row.cells || {};
  const best = row.bestCell && C[row.bestCell] ? row.bestCell : "K3";
  const B = C[best] || {};
  const P = (B.photo || {});
  const K0P = ((C.K0 || {}).photo || {});
  // G1: geometry unchanged in every cell.
  {
    const bad = Object.entries(C).filter(([, c]) => c.sha256 !== row.ptC3Sha256).map(([k]) => k);
    out.push(bad.length === 0
      ? pass("G1", `all cells sha256=${(row.ptC3Sha256 || "").slice(0, 16)}`)
      : fail("G1", `changed cells: ${bad.join(",")}`));
  }
  // G2: part no longer glows.
  {
    const ok = (P.partBandRatio ?? 1e9) <= 1.6 && (B.partPx ?? 1e9) <= 27;
    out.push(ok
      ? pass("G2", `band ratio=${P.partBandRatio} part=${B.partPx}px`)
      : fail("G2", `band ratio=${P.partBandRatio} (bar <=1.6) part=${B.partPx}px (bar <=27)`));
  }
  // G3: hair photometrics.
  {
    const ok = (P.p50 >= 0.06 && P.p50 <= 0.10) && (P.p90 >= 0.11 && P.p90 <= 0.20)
      && (P.RB >= 1.3 && P.RB <= 1.7) && (P.redness <= 0.6 * (K0P.redness ?? 0));
    out.push(ok
      ? pass("G3", `p50=${P.p50} p90=${P.p90} RB=${P.RB} red=${P.redness}`)
      : fail("G3", `p50=${P.p50} (bar 0.06-0.10) p90=${P.p90} (bar 0.11-0.20) RB=${P.RB} (bar 1.3-1.7) red=${P.redness} (bar <=${(0.6 * (K0P.redness ?? 0)).toFixed(5)})`));
  }
  // G4: fix is not "everything darker".
  {
    const df = Math.abs(P.faceSkin - K0P.faceSkin) / K0P.faceSkin;
    const db = Math.abs(P.bgMean - K0P.bgMean) / K0P.bgMean;
    out.push(df <= 0.15 && db <= 0.10
      ? pass("G4", `face d=${(100 * df).toFixed(1)}% bg d=${(100 * db).toFixed(1)}%`)
      : fail("G4", `face d=${(100 * df).toFixed(1)}% (bar 15%) bg d=${(100 * db).toFixed(1)}% (bar 10%)`));
  }
  // G5: no regression.
  {
    const ok = (B.iou ?? -1) >= 0.608 && (B.idShow ?? 1e9) <= 0.032;
    out.push(ok
      ? pass("G5", `IoU=${B.iou} idShow=${B.idShow}`)
      : fail("G5", `IoU=${B.iou} (bar >=0.608) idShow=${B.idShow} (bar <=0.032)`));
  }
  // G6: no dark band on the forehead.
  {
    const dh = Math.abs(P.forehead - K0P.forehead) / K0P.forehead;
    out.push(dh <= 0.10
      ? pass("G6", `forehead d=${(100 * dh).toFixed(1)}%`)
      : fail("G6", `forehead d=${(100 * dh).toFixed(1)}% (bar 10%)`));
  }
  return out;
}

function selfTest() {
  const real = JSON.parse(readFileSync(ROW, "utf8"));
  const base = structuredClone(real);
  const BK = base.bestCell;
  base.ptC3Sha256 = base.cells[ BK ].sha256;
  base.cells[ BK ].photo.partBandRatio = 1.2;
  base.cells[ BK ].partPx = 22;
  base.cells[ BK ].photo.p50 = 0.078;
  base.cells[ BK ].photo.p90 = 0.159;
  base.cells[ BK ].photo.RB = 1.5;
  base.cells[ BK ].photo.redness = 0.5 * 0.6 * base.cells.K0.photo.redness;
  base.cells[ BK ].photo.faceSkin = base.cells.K0.photo.faceSkin;
  base.cells[ BK ].photo.bgMean = base.cells.K0.photo.bgMean;
  base.cells[ BK ].photo.forehead = base.cells.K0.photo.forehead;
  base.cells[ BK ].iou = 0.62;
  base.cells[ BK ].idShow = 0.02;
  let pass0 = checkGates(base);
  if (!pass0.every((g) => g.status === "PASS")) {
    console.error(`SELF-TEST FAIL: all-pass row reports ${JSON.stringify(pass0.map((g) => g.status))}`);
    process.exit(1);
  }
  const plants = {
    G1: (r) => { r.cells[ BK ].sha256 = "0".repeat(64); },
    G2: (r) => { r.cells[ BK ].photo.partBandRatio = 4.0; },
    G3: (r) => { r.cells[ BK ].photo.p50 = 0.30; },
    G4: (r) => { r.cells[ BK ].photo.faceSkin = 2.0 * r.cells.K0.photo.faceSkin; },
    G5: (r) => { r.cells[ BK ].iou = 0.5; },
    G6: (r) => { r.cells[ BK ].photo.forehead = 2.0 * r.cells.K0.photo.forehead; },
  };
  for (const [id, plant] of Object.entries(plants)) {
    const r = structuredClone(base);
    plant(r);
    const got = Object.fromEntries(checkGates(r).map((g) => [g.id, g.status]));
    const othersPass = Object.entries(got).filter(([k]) => k !== id).every(([, s]) => s === "PASS");
    if (got[id] !== "MISS" || !othersPass) {
      console.error(`SELF-TEST FAIL: plant ${id} gives ${JSON.stringify(got)}`);
      process.exit(1);
    }
    console.log(`self-test plant ${id}: MISS as expected`);
  }
  console.log("SELF-TEST PASS: all-pass passes, each planted violation fails its gate only");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  selfTest();
} else {
  const row = JSON.parse(readFileSync(ROW, "utf8"));
  const res = checkGates(row);
  for (const g of res) console.log(`${g.id} ${g.status}: ${g.detail}`);
  if (!res.every((g) => g.status === "PASS")) process.exit(1);
}
