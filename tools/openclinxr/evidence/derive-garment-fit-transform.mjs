import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('/Volumes/files/src/openclinxr');
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const fitQualityPath = argValue('--fit-quality', 'docs/openclinxr/garment-fit-quality-reom-shirts01-cc0-transform-2026-05-27.json');
const inputWorkOrderPath = argValue('--work-order', 'docs/openclinxr/garment-work-order-ob-reom-shirts01-cc0-2026-05-27.json');
const outputWorkOrderPath = argValue('--output', 'docs/openclinxr/garment-work-order-ob-reom-shirts01-cc0-derived-transform-2026-05-27.json');

const fit = JSON.parse(await fs.readFile(path.resolve(root, fitQualityPath), 'utf8'));
const workOrder = JSON.parse(await fs.readFile(path.resolve(root, inputWorkOrderPath), 'utf8'));
const offset = fit.metrics?.centerOffset ?? [0, 0, 0];
const widthRatio = Number(fit.metrics?.widthRatio ?? 1);
const heightRatio = Number(fit.metrics?.heightRatio ?? 1);

const scaleX = Number(Math.min(1.25, Math.max(0.75, 1 / Math.max(widthRatio, 0.01))).toFixed(3));
const scaleY = Number(Math.min(1.15, Math.max(0.65, 0.45 / Math.max(heightRatio, 0.01))).toFixed(3));
const scaleZ = 1.35;

workOrder.semanticGarmentKey = `${workOrder.semanticGarmentKey}:derived-transform-v1`;
workOrder.outputCandidate = '.openclinxr-local/provider-cache/garments/generated/reom-shirts01-cc0-elvs-crude-tshirt-derived-transform-candidate.glb';
workOrder.fitTransform = {
  offset: offset.map((value) => Number((-value).toFixed(4))),
  rotation: [0, 0, 0],
  scale: [scaleX, scaleY, scaleZ],
  derivedFrom: fitQualityPath,
  policy: 'automatic_bounds_centering_and_width_height_normalization'
};

await fs.writeFile(path.resolve(root, outputWorkOrderPath), `${JSON.stringify(workOrder, null, 2)}\n`);
console.log(JSON.stringify({ outputWorkOrderPath, fitTransform: workOrder.fitTransform }, null, 2));
