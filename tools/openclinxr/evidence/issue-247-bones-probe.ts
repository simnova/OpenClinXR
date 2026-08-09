/**
 * #247 arm-stance + effective-visibility check for the ED stroke station.
 * Reports shoulder/wrist world positions (arm hang vs T-pose) and the EFFECTIVE
 * (ancestor-aware) visibility of the ragdoll-collision-proxy groups.
 */
import { chromium } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  buildRoomCaptureUrl,
  ROOM_CAPTURE_MODE,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

const EVAL = `(() => {
  const win = window;
  const scene = win.__openClinXrDebugScene;
  if (!scene) return { error: "no scene" };
  function effVisible(obj) {
    let cur = obj;
    while (cur) {
      if (cur.visible === false) return false;
      cur = cur.parent;
    }
    return true;
  }
  function worldPos(obj) {
    if (typeof obj.updateMatrixWorld === "function") obj.updateMatrixWorld(true);
    const e = obj.matrixWorld && obj.matrixWorld.elements;
    return e ? { x: e[12], y: e[13], z: e[14] } : null;
  }
  const out = { actors: [], proxies: [] };
  scene.traverse(function (o) {
    const posture = o.userData && o.userData.openClinXrActorPosture;
    if (posture !== "standing" && posture !== "seated" && posture !== "supine") return;
    let hasStaged = false;
    let p = o, depth = 0;
    while (p && depth < 6) {
      if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId.length > 0) { hasStaged = true; break; }
      p = p.parent; depth++;
    }
    if (!hasStaged) return;
    const actorId = (o.userData && o.userData.openClinXrActorId) || o.name || "unknown";
    const bones = {};
    o.traverse(function (b) {
      const n = (b.name || "").toLowerCase();
      if (/upper_arm|shoulder|forearm|hand|wrist|elbow/.test(n)) {
        if (!bones[n]) bones[n] = worldPos(b);
      }
    });
    out.actors.push({ actorId, posture, bones });
  });
  scene.traverse(function (o) {
    if (o.userData && o.userData.openClinXrRagdollCollisionProxy) {
      out.proxies.push({
        name: o.name || "",
        meshVisible: o.visible,
        effectiveVisible: effVisible(o),
        worldY: worldPos(o),
        parentVisibleChain: (function () {
          const chain = [];
          let cur = o.parent, d = 0;
          while (cur && d < 5) { chain.push(cur.name + ":" + String(cur.visible)); cur = cur.parent; d++; }
          return chain;
        })(),
      });
    }
  });
  return out;
})()`;

async function main(): Promise<void> {
  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(server.url, "ed_stroke_alert_handoff_v1", ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await page.waitForFunction(
          ({ minFrames: need }) => {
            const win = window as unknown as {
              __openClinXrFrameStats?: { framesObserved?: number };
              __openClinXrDebugScene?: { traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void };
            };
            if ((win.__openClinXrFrameStats?.framesObserved ?? 0) < need) return false;
            let skinned = 0;
            win.__openClinXrDebugScene?.traverse?.((object) => { if (object.isSkinnedMesh) skinned += 1; });
            return skinned >= 1;
          },
          { minFrames: 8 },
          { timeout: 180_000 },
        );
        await page.waitForTimeout(900);
        const data = (await page.evaluate(EVAL)) as {
          actors: { actorId: string; posture: string; bones: Record<string, { x: number; y: number; z: number } | null> }[];
          proxies: { name: string; meshVisible: boolean; effectiveVisible: boolean; worldY: { x: number; y: number; z: number } | null; parentVisibleChain: string[] }[];
        };
        for (const a of data.actors) {
          const keys = Object.keys(a.bones).sort();
          console.log(`== ${a.actorId} (${a.posture})`);
          for (const k of keys) {
            const b = a.bones[k];
            console.log(`   ${k}: ${b ? `(${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)})` : "null"}`);
          }
        }
        for (const pr of data.proxies) {
          console.log(`PROXY ${pr.name}`);
          console.log(`   meshVisible=${pr.meshVisible} effectiveVisible=${pr.effectiveVisible} worldY=${pr.worldY ? pr.worldY.y.toFixed(3) : "null"}`);
          console.log(`   parentChain: ${pr.parentVisibleChain.join(" <- ")}`);
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (server) {
      try { server.proc.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
}

if (process.argv[1]?.endsWith("issue-247-bones-probe.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
