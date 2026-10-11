/**
 * Score a bound-turn take source-side (Kimodo export frame) + detect contact windows.
 *
 * Reads a pass work dir (joints.json Blender Z-up, contacts.json raw npz
 * foot_contacts, profile.json boundaries) and reports, in the take frame:
 * - sourceTurnDeg: unwrapped pelvis-forward yaw change over [stand0End, turnEnd]
 *   (pelvis forward = up x lateral from the hip vector, the same basis the bind
 *   builds it from; yaw = atan2(fx, -fy) on Blender ground XY, which equals the
 *   glTF-convention yaw by the export mapping).
 * - endFacingErrorDeg: mean |wrapped pelvis-forward vs constrained turn| over hold.
 * - rootDriftM: max Hips XZ distance from the frame-0 root over the whole take.
 * - perWindowToeTravelM: per contact window, toe travel from the window anchor.
 * Writes windows.json: maximal per-foot contact runs [{foot,start,end}].
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/pinned-turn/score-turn-take.ts \
 *   --work-dir .openclinxr/evidence/pinned-turn/pass1 --out <row.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE_FPS = 30;

/** Map.get that throws instead of asserting non-null (biome forbids `!`). */
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = must(argv[i], "arg flag").replace(/^--/, "");
    out[key] = argv[i + 1] ?? "";
  }
  return out;
}

type Joints = Record<string, number[][]>;

async function main(): Promise<void> {
  const args = parseArgs();
  const workDir = args["work-dir"] ?? "";
  const outPath = args["out"] ?? "";
  if (!workDir || !outPath) throw new Error("required: --work-dir --out");

  const joints = JSON.parse(readFileSync(`${workDir}/joints.json`, "utf-8")) as Joints;
  const profile = JSON.parse(readFileSync(`${workDir}/profile.json`, "utf-8")) as {
    boundaries: Record<string, number>;
    turnConstrainedRad: number;
  };
  const contacts = JSON.parse(readFileSync(`${workDir}/contacts.json`, "utf-8")) as number[][];

  const hips = joints["Hips"] ?? [];
  const legL = joints["LeftLeg"] ?? [];
  const legR = joints["RightLeg"] ?? [];
  const toeL = joints["LeftToeBase"] ?? [];
  const toeR = joints["RightToeBase"] ?? [];
  if (hips.length < 2 || legL.length !== hips.length || legR.length !== hips.length) {
    throw new Error("Hips/LeftLeg/RightLeg tracks missing or mismatched in joints.json");
  }
  const b = profile.boundaries;
  const frameAt = (t: number): number => Math.max(0, Math.min(hips.length - 1, Math.round(t * SOURCE_FPS)));
  const standEnd = frameAt(b["stand0End"] ?? 0);
  const turnEnd = frameAt(b["turnEnd"] ?? hips.length / SOURCE_FPS);

  // Pelvis-forward yaw from the hip vector (Blender Z-up ground = XY).
  const forwardYawAt = (i: number): number => {
    const latX = (legR[i]?.[0] ?? 0) - (legL[i]?.[0] ?? 0);
    const latY = (legR[i]?.[1] ?? 0) - (legL[i]?.[1] ?? 0);
    // forward = up(0,0,1) x lateral = (-latY, latX); yaw = atan2(fx, -fy).
    return Math.atan2(-latY, -latX);
  };
  let unwrapped = forwardYawAt(standEnd);
  let total = 0;
  for (let i = standEnd + 1; i <= Math.min(turnEnd, hips.length - 1); i += 1) {
    const y = forwardYawAt(i);
    total += wrapPi(y - unwrapped);
    unwrapped = y;
  }
  const constrained = profile.turnConstrainedRad;
  let endSum = 0;
  let endCount = 0;
  for (let i = turnEnd; i < hips.length; i += 1) {
    endSum += Math.abs(wrapPi(forwardYawAt(i) - constrained));
    endCount += 1;
  }
  const r0 = hips[0];
  if (!r0) throw new Error("no frame-0 Hips");
  let drift = 0;
  for (const h of hips) {
    drift = Math.max(drift, Math.hypot(
      must(h[0], "hips x") - must(r0[0], "root x"),
      must(h[1], "hips y") - must(r0[1], "root y"),
    ));
  }

  // Contact windows: per foot, maximal runs where any of its 3 cols is on.
  const contact = (contactRow: number[], foot: "L" | "R"): boolean => {
    const cols = foot === "L" ? [0, 1, 2] : [3, 4, 5];
    return cols.some((c) => (contactRow[c] ?? 0) !== 0);
  };
  const windows: Array<{ foot: string; start: number; end: number }> = [];
  const perWindowToeTravelM: Array<{ foot: string; start: number; end: number; travelM: number }> = [];
  for (const foot of ["L", "R"] as const) {
    let s = -1;
    const toes = foot === "L" ? toeL : toeR;
    for (let i = 0; i <= contacts.length; i += 1) {
      const on = i < contacts.length && contact(must(contacts[i], "contact row"), foot);
      if (on && s === -1) s = i;
      if (!on && s !== -1) {
        windows.push({ foot, start: s, end: i - 1 });
        const a = toes[s];
        let travel = 0;
        if (a) {
          for (let k = s; k <= i - 1; k += 1) {
            const q = toes[k];
            if (q) {
              travel = Math.max(travel, Math.hypot(
                must(q[0], "toe x") - must(a[0], "anchor x"),
                must(q[1], "toe y") - must(a[1], "anchor y"),
              ));
            }
          }
        }
        perWindowToeTravelM.push({ foot, start: s, end: i - 1, travelM: travel });
        s = -1;
      }
    }
  }
  windows.sort((x, y) => x.start - y.start);
  perWindowToeTravelM.sort((x, y) => x.start - y.start);

  const row = {
    sourceTurnDeg: (total * 180) / Math.PI,
    constrainedDeg: (constrained * 180) / Math.PI,
    endFacingErrorDeg: endCount > 0 ? ((endSum / endCount) * 180) / Math.PI : null,
    rootDriftM: drift,
    perWindowToeTravelM,
  };
  writeFileSync(outPath, `${JSON.stringify(row, null, 2)}\n`);
  writeFileSync(`${workDir}/windows.json`, `${JSON.stringify(windows, null, 2)}\n`);
  console.log(JSON.stringify(row));
}

await main();
