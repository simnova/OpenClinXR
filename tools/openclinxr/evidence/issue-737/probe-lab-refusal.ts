/**
 * #737 debug — browser-side probe of the isolated-subject-lab focus=head refusal on the
 * ED actors. Opens the lab page for each ED actor and records the page error text plus
 * the subject AABB the page computed, so the refusal can be traced (body bounds vs the
 * derivation's silhouette profile).
 */
import { chromium } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";

const ED_ACTORS = [
  "mpfb-gown-adult-patient",
  "mpfb-clinical-nurse-adult",
  "mpfb-family-partner-adult",
  "mpfb-clinical-physician-adult",
];

const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: process.cwd(), readyTimeoutMs: 180_000 });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
for (const actor of ED_ACTORS) {
  const params = new URLSearchParams({
    subjectId: `${actor}_head`,
    subjectKind: "glb",
    bodyGlb: `generated-humanoids/${actor}.glb`,
    view: "front",
    focus: "head",
    subjectOnly: "true",
  });
  const url = `${server.url.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => {
    const w = browserPageWindow as unknown as { __openClinXrSubjectAabb?: unknown };
    const app = browserPageDocument.querySelector("#app");
    return w.__openClinXrSubjectAabb !== undefined || (app?.textContent ?? "").includes("Isolated subject lab error");
  }, null, { timeout: 120_000 });
  const result = await page.evaluate(() => {
    const w = browserPageWindow as unknown as { __openClinXrSubjectAabb?: unknown; __openClinXrIsolatedSubjectEvidence?: unknown };
    const app = browserPageDocument.querySelector("#app");
    return {
      aabb: w.__openClinXrSubjectAabb ?? null,
      evidence: w.__openClinXrIsolatedSubjectEvidence ?? null,
      appText: (app?.textContent ?? "").slice(0, 400),
    };
  });
  console.log(`${actor}: aabb=${JSON.stringify(result.aabb)} meshCount=${(result.evidence as { meshCount?: number } | null)?.meshCount ?? "n/a"} err=${result.appText.includes("error") ? "YES" : "no"}`);
  if (result.appText.includes("Isolated subject lab error")) {
    console.log(`   ERR: ${result.appText.slice(0, 200)}`);
  }
}
await browser.close();
await stopPortlessDevServer(server.proc);
