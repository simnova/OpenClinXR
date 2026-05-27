import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const base = 'http://127.0.0.1:5173/?openclinxrScenarioId=ob_headache_preeclampsia_triage_v1&openclinxrCaptureMode=face-detail-mouth-gaze-pose-source-clean&openclinxrPortalStart=encounter&openclinxrAcceleratedExam=1';
const captures = [
  { id: 'reom_face_pose', url: `${base}&humanoidSourceComparator=charmorph_reom_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-reom-face-pose-2026-05-27.png' },
  { id: 'reom_local_fitted_garment_face_pose', url: `${base}&humanoidSourceComparator=reom_local_fitted_garment_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-local-fitted-garment-face-pose-2026-05-27.png' },
  { id: 'reom_local_authored_curved_garment_face_pose', url: `${base}&humanoidSourceComparator=reom_local_authored_curved_garment_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-local-authored-curved-garment-face-pose-2026-05-27.png' },
  { id: 'reom_shirts01_cc0_face_pose', url: `${base}&humanoidSourceComparator=reom_shirts01_cc0_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-shirts01-cc0-face-pose-2026-05-27.png' },
  { id: 'reom_toigo_basic_tucked_tshirt_face_pose', url: `${base}&humanoidSourceComparator=reom_toigo_basic_tucked_tshirt_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-toigo-basic-tucked-tshirt-face-pose-2026-05-27.png' },
  { id: 'reom_namuhekam_polo_face_pose', url: `${base}&humanoidSourceComparator=reom_namuhekam_polo_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-reom-namuhekam-polo-face-pose-2026-05-27.png' },
  { id: 'antonia_face_pose', url: `${base}&humanoidSourceComparator=charmorph_antonia_patient&humanoidSourceCleanCapture=1`, screenshot: 'docs/openclinxr/screenshots/ui-xr-ob-humanoid-source-charmorph-antonia-face-pose-2026-05-27.png' },
];

function assertOpenClinXrTarget(capture, guard) {
  const failures = [];
  if (!guard.titleIncludesScenario && !guard.bodyIncludesScenario) failures.push('scenario_text_missing');
  if (guard.canvasCount < 1) failures.push('webxr_canvas_missing');
  if (guard.bootError) failures.push(`boot_error:${guard.bootError}`);
  if (guard.locationScenario !== 'ob_headache_preeclampsia_triage_v1') failures.push(`scenario_query_mismatch:${guard.locationScenario}`);
  if (failures.length > 0) {
    throw new Error(`${capture.id} capture target guard failed: ${failures.join(', ')}`);
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];
for (const capture of captures) {
  const page = await browser.newPage({ viewport: { width: 900, height: 824 }, deviceScaleFactor: 1 });
  await page.goto(capture.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 8000 });
  await page.waitForTimeout(2600);
  const guard = await page.evaluate(() => {
    const scenario = 'OB Headache Preeclampsia Triage';
    const params = new URLSearchParams(window.location.search);
    return {
      href: window.location.href,
      locationScenario: params.get('openclinxrScenarioId'),
      title: document.title,
      titleIncludesScenario: document.title.includes(scenario),
      bodyIncludesScenario: document.body.innerText.includes(scenario),
      canvasCount: document.querySelectorAll('canvas').length,
      bootError: window.__openClinXrLastStationSceneBootError ?? null,
      humanoidSpeech: window.__openClinXrHumanoidSpeechEvidence ?? null,
      portal: window.__openClinXrPortalTransitionEvidence ?? null,
    };
  });
  assertOpenClinXrTarget(capture, guard);
  await page.screenshot({ path: path.join(root, capture.screenshot), clip: { x: 0, y: 0, width: 480, height: 824 } });
  await page.close();
  results.push({ ...capture, guard });
}
await browser.close();
const evidencePath = 'docs/openclinxr/ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27.json';
await fs.writeFile(path.join(root, evidencePath), JSON.stringify({
  capturedAt: new Date().toISOString(),
  claimBoundary: 'guarded_desktop_webxr_closeup_comparator_only_not_quest_or_production_readiness',
  targetGuard: 'scenario_text_canvas_and_boot_error_asserted_before_screenshot_write',
  captures: results,
}, null, 2));
console.log(JSON.stringify({ evidencePath, captures: results.map(({ id, screenshot, guard }) => ({ id, screenshot, canvasCount: guard.canvasCount, bootError: guard.bootError })) }, null, 2));
