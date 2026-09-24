import { NodeIO } from "@gltf-transform/core";

/**
 * Correlate target hip rotation series with source hip series at lag 0 vs mirrored.
 * Resamples both to 64 samples; correlation computed on the per-frame angular
 * distance from each series' own first frame (a scalar gait-phase signal).
 * A time-reversed target correlates at the mirrored lag, not lag 0.
 */
function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]!;
    if (key.startsWith("--")) {
      const next = argv[i + 1];
      out[key.slice(2)] = next === undefined || next.startsWith("--") ? "1" : next;
      if (out[key.slice(2)] !== "1") i += 1;
    }
  }
  return out;
}

function quatAngle(a: number[], b: number[]): number {
  const dot = Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((acc, x) => acc + x, 0) / n;
  const mb = b.reduce((acc, x) => acc + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}

async function series(glb: string, clip: string, joint: string): Promise<number[]> {
  const doc = await new NodeIO().read(glb);
  const anim = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
  if (!anim) throw new Error(`no clip ${clip} in ${glb}`);
  const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === joint && c.getTargetPath() === "rotation");
  if (!ch) throw new Error(`no rotation channel for ${joint} in ${clip}`);
  const times = Array.from(ch.getSampler()!.getInput()!.getArray() as ArrayLike<number>);
  const vals = Array.from(ch.getSampler()!.getOutput()!.getArray() as ArrayLike<number>);
  const quats: number[][] = [];
  for (let i = 0; i < times.length; i += 1) quats.push([vals[i * 4]!, vals[i * 4 + 1]!, vals[i * 4 + 2]!, vals[i * 4 + 3]!]);
  // Drop frame 0 (possible rest prepend) then angle-from-first per frame.
  const body = quats.slice(1);
  const ref = body[0]!;
  const sig = body.map((q) => quatAngle(ref, q));
  // Resample to 64.
  const out: number[] = [];
  for (let i = 0; i < 64; i += 1) {
    const pos = (i / 63) * (sig.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    out.push(sig[lo]! + (sig[hi]! - sig[lo]!) * (pos - lo));
  }
  return out;
}

const args = parseArgs();
const s = await series(args["sglb"]!, args["sclip"]!, args["sjoint"]!);
const t = await series(args["tglb"]!, args["tclip"]!, args["tjoint"]!);
const mirrored = [...t].reverse();
const rLag0 = pearson(s, t);
let bestLag = 0, bestR = -2;
for (let lag = -32; lag <= 32; lag += 1) {
  const shifted = t.map((_, i) => t[(i + lag + t.length * 4) % t.length]!);
  const r = pearson(s, shifted);
  if (r > bestR) { bestR = r; bestLag = lag; }
}
const rMirror = pearson(s, mirrored);
console.log(JSON.stringify({ pearsonLag0: Math.round(rLag0 * 1000) / 1000, bestLag, bestLagR: Math.round(bestR * 1000) / 1000, pearsonMirrored: Math.round(rMirror * 1000) / 1000 }, null, 1));
