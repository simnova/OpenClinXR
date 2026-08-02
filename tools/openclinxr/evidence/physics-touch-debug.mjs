import playwright from 'playwright';

const PORT = 5199;

async function main() {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().substring(0, 200));
  });

  const url = `http://127.0.0.1:${PORT}/?humanoidSourceComparator=peds_anny_real_garment_patient&capture=physics-clinical-touch`;
  console.log(`Navigating to ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  } catch (e) {
    console.log('Goto failed, checking console...');
  }
  
  await page.waitForTimeout(8000);

  console.log('Page errors:');
  errors.slice(0, 10).forEach((e) => console.log('  ', e));

  const hasDebugScene = await page.evaluate(() => !!window.__openClinXrDebugScene);
  console.log('Has debug scene:', hasDebugScene);

  const bootEvidence = await page.evaluate(() => {
    const w = window;
    return {
      bundleId: w.__openClinXrSelectedRuntimeAssetBundleId || 'none',
      bootPhases: w.__openClinXrBootEvidence?.events?.map(e => e.phase)?.join(',') || 'none',
      sceneAssetStatus: JSON.stringify(w.__openClinXrSceneAssetEvidence?.assetStatuses || {}),
    };
  });
  console.log('Boot:', JSON.stringify(bootEvidence, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
