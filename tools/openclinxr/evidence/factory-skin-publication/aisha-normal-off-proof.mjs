import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GLB = 'apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb';
const EXPECT_BIN_SHA = 'df1e9778e79987c35218d058a0132d7d3a8b61a6940987e421549ec3cd4d7cd1';
const EXPECT_IMG4_SHA = '423dd04117de74131ccadb8c4b8905679505350c316454bed307a37f5dbb5871';
const EXPECT_PRIMS = [[0],[1],[2],[3],[4,5,6,7,8,9,10,11],[12],[13],[14],[15],[16]];

const fails = [];
const check = (name, ok) => { if (!ok) fails.push(name); };

const buf = readFileSync(GLB);
check('magic', buf.readUInt32LE(0) === 0x46546c67);
check('header-length-equals-file', buf.readUInt32LE(8) === buf.length);
const jsonLen = buf.readUInt32LE(12);
const jsonType = buf.readUInt32LE(16);
check('json-chunk-type', jsonType === 0x4e4f534a);
check('json-pad-multiple-4', jsonLen % 4 === 0);
const jsonBytes = buf.subarray(20, 20 + jsonLen);
const j = JSON.parse(Buffer.from(jsonBytes).toString('utf8'));
const binOff = 20 + jsonLen;
const binLen = buf.readUInt32LE(binOff);
const binType = buf.readUInt32LE(binOff + 4);
check('bin-chunk-type', binType === 0x004e4942);
check('bin-length', binLen === 9554520);
const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);
const binSha = createHash('sha256').update(bin).digest('hex');
check('bin-sha', binSha === EXPECT_BIN_SHA);

const skin = j.materials.find((m) => m.name === 'mpfb_skin_ob_patient_aisha_v1');
check('skin-material-exists', !!skin);
check('skin-no-normalTexture', skin && !('normalTexture' in skin));
check('skin-baseColor-index-3', skin?.pbrMetallicRoughness?.baseColorTexture?.index === 3);
check('textures3-source-4', j.textures?.[3]?.source === 4);
check('no-material-has-normalTexture', j.materials.every((m) => !('normalTexture' in m)));
check('mesh-count-10', j.meshes?.length === 10);
const prims = (j.meshes || []).map((m) => (m.primitives || []).map((p) => p.material));
check('primitive-material-indices', JSON.stringify(prims) === JSON.stringify(EXPECT_PRIMS));

const img = j.images?.[4];
const bv = j.bufferViews?.[img?.bufferView];
const imgBytes = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
check('image4-sha', createHash('sha256').update(imgBytes).digest('hex') === EXPECT_IMG4_SHA);

for (const [rel, sha] of [
  ['apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.skin-normal.png', '9cf3c36784e50ae912e2a49917fbae6d9560ba6e95519d6646b336a224009da7'],
  ['apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.skin-baked.png', '423dd04117de74131ccadb8c4b8905679505350c316454bed307a37f5dbb5871'],
]) {
  check(`sidecar-${rel.split('.').slice(-2, -1)[0]}`, createHash('sha256').update(readFileSync(rel)).digest('hex') === sha);
}

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('PASS aisha normalTexture removed; BIN and sidecars intact');
