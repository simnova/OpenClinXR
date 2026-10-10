/*
IN-SCOPE: JSON-only removal of normalTexture on mpfb_skin_peds_patient_child; BIN chunk byte-identical; provenance output fields re-recorded.
OUT-OF-SCOPE: Blender runs; gltf-transform; re-export; clothing edits; hash-test file edits; PROVENANCE_HASH_MISMATCH_FREEZE.
CLAIM: edited GLB sha256 a969db3ba0a63d43597b5c3007a6e520a85c46bec9e28c97aa88638500ed79b1, 11743252 bytes; BIN sha256 3ab3605b531fccba0fa1543b8195acf047e8ddcab1b080de97ba35922b44fcb0 unchanged.
NOT TESTED: pixel grading; runtime rendering; realism gates; clinical or scoring validity.
*/
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const GLB = 'apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb';
const PROVENANCE = 'apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.provenance.json';
const HASH_TEST = 'apps/ui-xr/src/the-shipped-humanoids-hash-to-their-provenance.test.ts';
const EXPECT_BIN_SHA = '3ab3605b531fccba0fa1543b8195acf047e8ddcab1b080de97ba35922b44fcb0';
const EXPECT_IMG3_SHA = '8cb2ea66608589ae0911b56bd9b52a00bba4607c88fdce06b4b598359a0f3ff3';
const EXPECT_IMG2_SHA = '210884f2f50eb843dd2f770ad7011ebb753e46c8b9368324d59283736c9af020';
const EXPECT_GLB_SHA = 'a969db3ba0a63d43597b5c3007a6e520a85c46bec9e28c97aa88638500ed79b1';
const EXPECT_GLB_BYTES = 11743252;
const EXPECT_BYTE_LINEAGE_SHA = '38755a96e10945d34265b33b1ef6e8d2b17f34faa2cd84ae8ccdbd8da950c4de';
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
check('bin-length', binLen === 11227152);
const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);
const binSha = createHash('sha256').update(bin).digest('hex');
check('bin-sha', binSha === EXPECT_BIN_SHA);

const skin = j.materials.find((m) => m.name === 'mpfb_skin_peds_patient_child');
check('skin-material-exists', !!skin);
check('skin-no-normalTexture', skin && !('normalTexture' in skin));
check('skin-baseColor-index-2', skin?.pbrMetallicRoughness?.baseColorTexture?.index === 2);
check('textures2-source-3', j.textures?.[2]?.source === 3);
check('textures3-source-2', j.textures?.[3]?.source === 2);
check('no-material-has-normalTexture', j.materials.every((m) => !('normalTexture' in m)));
check('mesh-count-10', j.meshes?.length === 10);
const prims = (j.meshes || []).map((m) => (m.primitives || []).map((p) => p.material));
check('primitive-material-indices', JSON.stringify(prims) === JSON.stringify(EXPECT_PRIMS));

const img3 = j.images?.[3];
const bv3 = j.bufferViews?.[img3?.bufferView];
const img3Bytes = bin.subarray(bv3.byteOffset, bv3.byteOffset + bv3.byteLength);
check('image3-sha', createHash('sha256').update(img3Bytes).digest('hex') === EXPECT_IMG3_SHA);
const img2 = j.images?.[2];
const bv2 = j.bufferViews?.[img2?.bufferView];
const img2Bytes = bin.subarray(bv2.byteOffset, bv2.byteOffset + bv2.byteLength);
check('image2-sha', createHash('sha256').update(img2Bytes).digest('hex') === EXPECT_IMG2_SHA);

for (const [rel, sha] of [
  ['apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.skin-normal.png', '210884f2f50eb843dd2f770ad7011ebb753e46c8b9368324d59283736c9af020'],
  ['apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.skin-baked.png', '8cb2ea66608589ae0911b56bd9b52a00bba4607c88fdce06b4b598359a0f3ff3'],
]) {
  check(`sidecar-${rel.split('.').slice(-2, -1)[0]}`, createHash('sha256').update(readFileSync(rel)).digest('hex') === sha);
}

check('glb-sha', createHash('sha256').update(buf).digest('hex') === EXPECT_GLB_SHA);
check('glb-bytes', buf.length === EXPECT_GLB_BYTES);

const prov = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
check('provenance-outputSha256', prov.outputSha256 === EXPECT_GLB_SHA);
check('provenance-outputBytes', prov.outputBytes === EXPECT_GLB_BYTES);
check('byteLineage-recordedBefore-outputSha256', prov.byteLineage?.recordedBefore?.outputSha256 === EXPECT_BYTE_LINEAGE_SHA);
check('byteLineage-preImageSha256', prov.byteLineage?.preImageSha256 === EXPECT_BYTE_LINEAGE_SHA);

const shipped = readFileSync(HASH_TEST);
const baseline = execSync(`git show origin/main:${HASH_TEST}`, { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
check('hash-test-byte-identical-to-origin-main', Buffer.compare(shipped, baseline) === 0);

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('PASS child normalTexture removed; BIN and sidecars intact');
