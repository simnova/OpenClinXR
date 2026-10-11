/*
IN-SCOPE: JSON-only deletion of ,"normalTexture":{"index":4} on mpfb_skin_ed_chest_pain_spouse_adult; BIN chunk byte-identical; provenance output fields re-recorded; scene-plan instance daughter_lena_ellis_v1 assetSha256 and byteCount re-recorded.
OUT-OF-SCOPE: albedo, mesh, other materials, historical requalification hashes, supine-control-freeze, Tara Toigo, Cycles, learner WebGL.
CLAIM: the edited GLB has no normalTexture; BIN sha256 is 9746502c7406b3d9dca053117d9f9c6a112f902a55da2de5433509fe67aa0ab2; the scene-plan instance matches the file hash and byte length.
NOT TESTED: learner WebGL and pixel grade.
*/
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const GLB = 'apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb';
const PROVENANCE = 'apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.provenance.json';
const SCENE_PLAN = 'packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts';
const RAW_HASHES = 'tools/openclinxr/evidence/scene-closure/proofs/sc-06/requalification-20261009/raw-inputs-hashes.txt';
const OLD_GLB_SHA = '4ca47db44375865bf51806abadccc1ac08c0a47a3a7a1835c77e1ce9dc830eaf';
const EXPECT_GLB_SHA = '6d078108a2372092bb267df33618966d0f232243e28c966eeb65d4b4242da3de';
const EXPECT_GLB_BYTES = 10529144;
const EXPECT_BIN_SHA = '9746502c7406b3d9dca053117d9f9c6a112f902a55da2de5433509fe67aa0ab2';
const EXPECT_BIN_LEN = 10015808;
const EXPECT_LINEAGE_SHA = 'dc5dec43210748c25a586dfc0c803923004160a8467787022045301cf3462b49';
const EXPECT_LINEAGE_BYTES = 10529168;
const DELETED = ',"normalTexture":{"index":4}';

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
const skin = j.materials.find((m) => m.name === 'mpfb_skin_ed_chest_pain_spouse_adult');
check('skin-material-exists', !!skin);
check('skin-baseColor-index-3', skin?.pbrMetallicRoughness?.baseColorTexture?.index === 3);

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

const prov = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
const originProv = JSON.parse(execSync(`git show origin/main:${PROVENANCE}`, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
check('provenance-outputSha256', prov.outputSha256 === EXPECT_GLB_SHA);
check('provenance-outputBytes', prov.outputBytes === EXPECT_GLB_BYTES);
const { outputSha256: a, outputBytes: b, ...provRest } = prov;
const { outputSha256: c, outputBytes: d, ...originRest } = originProv;
check('provenance-rest-equal-origin-main', JSON.stringify(provRest) === JSON.stringify(originRest));
check('byteLineage-recordedBefore-outputSha256', prov.byteLineage?.recordedBefore?.outputSha256 === EXPECT_LINEAGE_SHA);
check('byteLineage-recordedBefore-outputBytes', prov.byteLineage?.recordedBefore?.outputBytes === EXPECT_LINEAGE_BYTES);

check('glb-sha', createHash('sha256').update(buf).digest('hex') === EXPECT_GLB_SHA);
check('glb-bytes', buf.length === EXPECT_GLB_BYTES);

const rawHashes = readFileSync(RAW_HASHES, 'utf8');
check('raw-inputs-hashes-still-contains-old-sha', rawHashes.includes(OLD_GLB_SHA));

const OLD_SHA_LINE = `"assetSha256": "${OLD_GLB_SHA}"`;
const OLD_BYTES_LINE = '"byteCount": 10529172';
const curPlan = readFileSync(SCENE_PLAN, 'utf8');
const originPlan = execSync(`git show origin/main:${SCENE_PLAN}`, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
check('scene-plan-old-sha-line-unique-in-origin', originPlan.split(OLD_SHA_LINE).length - 1 === 1);
check('scene-plan-old-bytes-line-unique-in-origin', originPlan.split(OLD_BYTES_LINE).length - 1 === 1);
const expectedPlan = originPlan
  .replace(OLD_SHA_LINE, `"assetSha256": "${EXPECT_GLB_SHA}"`)
  .replace(OLD_BYTES_LINE, `"byteCount": ${EXPECT_GLB_BYTES}`);
check('scene-plan-equals-origin-plus-two-field-rerecord', curPlan === expectedPlan);
check('scene-plan-daughter-sha', curPlan.includes(`"assetSha256": "${EXPECT_GLB_SHA}"`));
check('scene-plan-daughter-bytes', curPlan.includes(`"byteCount": ${EXPECT_GLB_BYTES}`));

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('PASS family normalTexture removed; BIN and sidecars intact');
