/**
 * Quick Playwright capture for physics clinical touch R3 evidence.
 * Run from repo root: node --input-type=module tools/openclinxr/evidence/physics-touch-capture.mjs
 */
import playwright from 'playwright';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = '.openclinxr/evidence/physics-clinical-touch/2026-08-02-uixr-bind';
const PORT = 5199;

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Navigate to ED patient with physics touch capture
  const url = `http://127.0.0.1:${PORT}/?humanoidSourceComparator=ed_anny_real_garment_patient&capture=physics-clinical-touch`;
  console.log(`[capture] Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for humanoid to load, physics transforms to apply, and garment to settle
  console.log('[capture] Waiting 10s for humanoid load + physics settle...');
  await page.waitForTimeout(10000);

  // Check evidence globals
  const evidence = await page.evaluate(() => {
    const w = window;
    return {
      hasMouthGazeEvidence: !!(w.__openClinXrMouthGazePoseComparatorEvidence),
      comparator: w.__openClinXrMouthGazePoseComparatorEvidence?.comparator || 'none',
      hasGarmentGeometry: !!(w.__openClinXrMouthGazePoseComparatorEvidence?.garmentGeometry),
      sleeveDeform: w.__openClinXrMouthGazePoseComparatorEvidence?.garmentGeometry?.sleeveDeform || 'none',
    };
  });
  console.log('[capture] Evidence:', JSON.stringify(evidence, null, 2));

  // Check for physics touch user data on garment meshes
  const physicsUserData = await page.evaluate(() => {
    const results = [];
    const scene = window.__openClinXrDebugScene;
    if (scene) {
      scene.traverse((obj) => {
        if (obj.userData?.openClinXrPhysicsTouchEvidence) {
          results.push({
            name: obj.name || 'unnamed',
            physicsTouch: obj.userData.openClinXrPhysicsTouchEvidence,
          });
        }
      });
    }
    return results;
  });
  console.log('[capture] Physics touch userData:', JSON.stringify(physicsUserData, null, 2));

  // Check if garment mesh has the orange emissive
  const emissiveInfo = await page.evaluate(() => {
    const results = [];
    const scene = window.__openClinXrDebugScene;
    if (scene) {
      scene.traverse((obj) => {
        if (obj.material && obj.material.emissive) {
          const hex = '#' + obj.material.emissive.getHexString();
          results.push({
            name: obj.name || 'unnamed',
            emissive: hex,
            intensity: obj.material.emissiveIntensity,
          });
        }
      });
    }
    return results;
  });
  console.log('[capture] Emissive surfaces:', JSON.stringify(emissiveInfo.slice(0, 5), null, 2));

  // Take screenshot
  const screenshotPath = path.join(OUTPUT_DIR, 'physics-touch-ed-patient-front.png');
  await page.screenshot({ path: screenshotPath });
  const stat = fs.statSync(screenshotPath);
  console.log(`[capture] Screenshot: ${screenshotPath} (${(stat.size / 1024).toFixed(1)} KB)`);

  // Take second screenshot after another 3s (for different palpation phase)
  await page.waitForTimeout(3000);
  const screenshot2Path = path.join(OUTPUT_DIR, 'physics-touch-ed-patient-palpation.png');
  await page.screenshot({ path: screenshot2Path });
  const stat2 = fs.statSync(screenshot2Path);
  console.log(`[capture] Screenshot 2: ${screenshot2Path} (${(stat2.size / 1024).toFixed(1)} KB)`);

  // Write inspection JSON
  const inspectionPath = path.join(OUTPUT_DIR, 'inspection.json');
  fs.writeFileSync(inspectionPath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    url,
    evidence,
    physicsUserData,
    emissiveInfo: emissiveInfo.slice(0, 10),
    screenshots: [
      { path: screenshotPath, sizeBytes: stat.size },
      { path: screenshot2Path, sizeBytes: stat2.size },
    ],
    notEvidenceFor: [
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ],
  }, null, 2));
  console.log(`[capture] Inspection: ${inspectionPath}`);

  await browser.close();
  console.log('[capture] Done.');
}

main().catch((err) => {
  console.error('[capture] ERROR:', err);
  process.exit(1);
});
