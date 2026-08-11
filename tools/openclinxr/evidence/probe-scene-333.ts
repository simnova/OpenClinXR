import { chromium } from "playwright";
import { spawnPortlessDevServer } from "./lib/portless-server.js";

async function main() {
  const server = await spawnPortlessDevServer({
    filter: "@openclinxr/ui-xr",
    readyTimeoutMs: 180000,
  });
  console.log("SERVER_URL=" + server.url);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleMsgs: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/error|refused|404|fail/i.test(t)) consoleMsgs.push(`[${msg.type()}] ${t.slice(0, 300)}`);
  });
  page.on("requestfailed", (req) =>
    failedRequests.push(`${req.url().slice(0, 160)} :: ${req.failure()?.errorText ?? "?"}`),
  );

  const target = `${server.url}/?openclinxrScenarioId=peds_asthma_parent_anxiety_v1&scenarioId=peds_asthma_parent_anxiety_v1&openclinxrCaptureMode=scene-overview&capture=scene-overview&openclinxrPortalStart=encounter&openclinxrAcceleratedExam=1`;
  await page.goto(target, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(25000);

  const sceneState = (await page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene) return { noDebugScene: true };
    const actors = {};
    scene.traverse(function (o) {
      let cur = o;
      while (cur) {
        if (cur.userData && typeof cur.userData.openClinXrActorId === "string") {
          const aid = cur.userData.openClinXrActorId;
          if (!actors[aid]) actors[aid] = [];
          if (o.isMesh || o.isSkinnedMesh) {
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            actors[aid].push({
              name: o.name || "(unnamed)",
              tris: o.geometry && o.geometry.index ? Math.floor(o.geometry.index.count / 3) : 0,
              visible: o.visible,
              mat: (mats[0] && mats[0].name) || "",
            });
          }
          break;
        }
        cur = cur.parent;
      }
    });
    return actors;
  })()`)) as Record<string, unknown>;

  console.log("=== ACTOR MESHES ===");
  for (const [aid, meshes] of Object.entries(sceneState)) {
    if (aid === "noDebugScene") { console.log("NO DEBUG SCENE"); continue; }
    console.log(aid, "count=" + (meshes as unknown[]).length);
    for (const m of (meshes as { name: string; tris: number; visible: boolean; mat: string }[]).slice(0, 6)) {
      console.log("   ", m.name, "tris=" + m.tris, "visible=" + m.visible, "mat=" + m.mat.slice(0, 40));
    }
  }
  console.log("=== CONSOLE ERRORS ===");
  for (const m of consoleMsgs.slice(0, 25)) console.log(m);
  console.log("=== FAILED REQUESTS ===");
  for (const f of failedRequests.slice(0, 25)) console.log(f);

  await browser.close();
  try { server.proc.kill("SIGTERM"); } catch { /* ignore */ }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
