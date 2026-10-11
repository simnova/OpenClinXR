/*
IN-SCOPE: JSON-only deletion of ,"normalTexture":{"index":3} on mpfb_skin_robert_reference; BIN chunk byte-identical; provenance output fields re-recorded; two-field scene-plan re-record (assetSha256 + byteCount on patient_margaret_ellis_v1).
OUT-OF-SCOPE: Blender runs; re-export; clothing, hair, eyes, teeth edits; gown mesh edits; sidecar PNG edits; this follow-up does not edit the hash-test file, the freeze generator, other instances, or the GLB.
CLAIM: edited GLB sha256 88f094703dfc96811af56c6bb6070933f654a6a58c8ded3e5feac296e5561406, 20462724 bytes; BIN sha256 c1c3fbc9a3ef380271b700e9d42cc2cc163feb5fbf6359e67b26b254b605d584 unchanged; patient instance records same sha 88f094703dfc96811af56c6bb6070933f654a6a58c8ded3e5feac296e5561406 and byte count 20462724.
NOT TESTED: pixel grading and the learner WebGL route were not re-run here; runtime rendering; realism gates; clinical or scoring validity.
*/
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const GLB = 'apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb';
const PROVENANCE = 'apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.provenance.json';
const HASH_TEST = 'apps/ui-xr/src/the-shipped-humanoids-hash-to-their-provenance.test.ts';
const BAKED_PNG = 'apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.skin-baked.png';
const NORMAL_PNG = 'apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.skin-normal.png';
const EXPECT_GLB_SHA = '88f094703dfc96811af56c6bb6070933f654a6a58c8ded3e5feac296e5561406';
const EXPECT_GLB_BYTES = 20462724;
const EXPECT_BIN_SHA = 'c1c3fbc9a3ef380271b700e9d42cc2cc163feb5fbf6359e67b26b254b605d584';
const EXPECT_BIN_LEN = 19927184;
const EXPECT_IMG2_SHA = '4e37d3c8816612e43ebd34b08a405f28f26fbe5f8909a5a78d0c06f7757b6709';
const EXPECT_IMG3_SHA = 'c32ac936138b2146dfd796f29009b4395ab07f6ed80f66f3a7f1877b36e5fdd9';
const EXPECT_LINEAGE_SHA = 'ceb34c139a5f21460cd4518e2fb023fabed45279a87d48d983bc22b9dd744643';
const DELETED = ',"normalTexture":{"index":3}';

const fails = [];
const check = (name, ok) => { if (!ok) fails.push(name); };

const buf = readFileSync(GLB);
check('magic', buf.readUInt32LE(0) === 0x46546c67);
check('header-length-equals-file', buf.readUInt32LE(8) === buf.length);
const jsonLen = buf.readUInt32LE(12);
check('json-chunk-type', buf.readUInt32LE(16) === 0x4e4f534a);
check('json-pad-multiple-4', jsonLen % 4 === 0);
const jsonBytes = buf.subarray(20, 20 + jsonLen);
const j = JSON.parse(Buffer.from(jsonBytes).toString('utf8'));
const binOff = 20 + jsonLen;
const binLen = buf.readUInt32LE(binOff);
check('bin-chunk-type', buf.readUInt32LE(binOff + 4) === 0x004e4942);
check('bin-length', binLen === EXPECT_BIN_LEN);
const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);
check('bin-sha', createHash('sha256').update(bin).digest('hex') === EXPECT_BIN_SHA);

check('no-material-has-normalTexture', j.materials.every((m) => !('normalTexture' in m)));
const skin = j.materials.find((m) => m.name === 'mpfb_skin_robert_reference');
check('skin-material-exists', !!skin);
check('skin-baseColor-index-2', skin?.pbrMetallicRoughness?.baseColorTexture?.index === 2);
check('textures2-source-3', j.textures?.[2]?.source === 3);
check('textures3-source-2', j.textures?.[3]?.source === 2);
const imgBytes = (idx) => {
  const bv = j.bufferViews?.[j.images?.[idx]?.bufferView];
  return bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
};
check('image2-sha', createHash('sha256').update(imgBytes(2)).digest('hex') === EXPECT_IMG2_SHA);
check('image3-sha', createHash('sha256').update(imgBytes(3)).digest('hex') === EXPECT_IMG3_SHA);
check('mesh-count-10', j.meshes?.length === 10);

const originGlb = execSync(`git show origin/main:${GLB}`, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
const oJsonLen = originGlb.readUInt32LE(12);
const oJsonBytes = originGlb.subarray(20, 20 + oJsonLen);
const oj = JSON.parse(Buffer.from(oJsonBytes).toString('utf8'));
const prims = (d) => (d.meshes || []).map((m) => (m.primitives || []).map((p) => p.material));
check('primitive-material-indices-equal-origin-main', JSON.stringify(prims(j)) === JSON.stringify(prims(oj)));

const stripPad = (b) => { let e = b.length; while (e > 0 && b[e - 1] === 0x20) e--; return b.subarray(0, e); };
const editedStripped = stripPad(jsonBytes).toString('utf8');
const originStripped = stripPad(oJsonBytes).toString('utf8');
check('origin-has-one-deletion', originStripped.split(DELETED).length - 1 === 1);
check('edited-equals-origin-minus-one-deletion', editedStripped === originStripped.replace(DELETED, ''));

for (const rel of [BAKED_PNG, NORMAL_PNG]) {
  const cur = readFileSync(rel);
  const base = execSync(`git show origin/main:${rel}`, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  check(`sidecar-byte-identical-${rel.split('.').slice(-2, -1)[0]}`, Buffer.compare(cur, base) === 0);
}

const prov = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
const originProv = JSON.parse(execSync(`git show origin/main:${PROVENANCE}`, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
check('provenance-outputSha256', prov.outputSha256 === EXPECT_GLB_SHA);
check('provenance-outputBytes', prov.outputBytes === EXPECT_GLB_BYTES);
const { outputSha256: a, outputBytes: b, ...provRest } = prov;
const { outputSha256: c, outputBytes: d, ...originRest } = originProv;
check('provenance-rest-equal-origin-main', JSON.stringify(provRest) === JSON.stringify(originRest));
check('byteLineage-recordedBefore-outputSha256', prov.byteLineage?.recordedBefore?.outputSha256 === EXPECT_LINEAGE_SHA);
check('byteLineage-preImageSha256', prov.byteLineage?.preImageSha256 === EXPECT_LINEAGE_SHA);
check('provenance-no-sourceNotes', !('sourceNotes' in prov));

check('glb-sha', createHash('sha256').update(buf).digest('hex') === EXPECT_GLB_SHA);
check('glb-bytes', buf.length === EXPECT_GLB_BYTES);

const shipped = readFileSync(HASH_TEST);
const baseline = execSync(`git show origin/main:${HASH_TEST}`, { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
check('hash-test-byte-identical-to-origin-main', Buffer.compare(shipped, baseline) === 0);

const SCENE_PLAN = 'packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts';
const OLD_SHA_LINE = '"assetSha256": "0640ebfe12f5c8e53c5355ccf5b71ccf6c740d52af238f1e74b8845841d9caa0"';
const OLD_BYTES_LINE = '"byteCount": 20462752';
const curPlan = readFileSync(SCENE_PLAN, 'utf8');
const originPlan = execSync(`git show origin/main:${SCENE_PLAN}`, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
check('scene-plan-old-sha-line-unique-in-origin', originPlan.split(OLD_SHA_LINE).length - 1 === 1);
check('scene-plan-old-bytes-line-unique-in-origin', originPlan.split(OLD_BYTES_LINE).length - 1 === 1);
const expectedPlan = originPlan
  .replace(OLD_SHA_LINE, `"assetSha256": "${EXPECT_GLB_SHA}"`)
  .replace(OLD_BYTES_LINE, `"byteCount": ${EXPECT_GLB_BYTES}`);
check('scene-plan-equals-origin-plus-two-field-rerecord', curPlan === expectedPlan);
check('scene-plan-patient-sha', curPlan.includes(`"assetSha256": "${EXPECT_GLB_SHA}"`));
check('scene-plan-patient-bytes', curPlan.includes(`"byteCount": ${EXPECT_GLB_BYTES}`));

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('PASS gown normalTexture removed; BIN and sidecars intact');
