import playwright from 'playwright';

const PORT = 5199;

async function main() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  const url = `http://127.0.0.1:${PORT}/?humanoidSourceComparator=ed_anny_real_garment_patient&capture=physics-clinical-touch`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(10000);

  // Check garment mesh emissive more deeply
  const emissives = await page.evaluate(() => {
    const results = [];
    const scene = window.__openClinXrDebugScene;
    if (!scene) return [{ note: 'no debug scene' }];
    
    // Deep traverse to find garment meshes
    const visit = (obj, depth) => {
      if (depth > 10) return;
      if (obj.name && (obj.name.includes('garment') || obj.name.includes('real_garment'))) {
        const mat = obj.material;
        const info = {
          name: obj.name,
          hasUserData: !!obj.userData?.openClinXrPhysicsTouchEvidence,
          frustumCulled: obj.frustumCulled,
          visible: obj.visible,
          hasEmissive: !!(mat?.emissive),
          emissiveHex: mat?.emissive ? '#' + mat.emissive.getHexString() : 'none',
          emissiveIntensity: mat?.emissiveIntensity,
          materialType: mat?.type || 'unknown',
        };
        results.push(info);
      }
      if (obj.children) {
        for (const child of obj.children) {
          visit(child, depth + 1);
        }
      }
    };
    visit(scene, 0);
    return results;
  });
  
  console.log('Garment surfaces:', JSON.stringify(emissives.slice(0, 5), null, 2));
  
  await browser.close();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
