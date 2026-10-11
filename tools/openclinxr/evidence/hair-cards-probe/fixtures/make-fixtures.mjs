#!/usr/bin/env node
// Writes one tiny valid GLB (<4KB) + report fixtures into fixtures/.
// The GLB holds 510 triangles over 3 shared vertices; the hairTriangleCount
// FIELD is what the judge checks (tri-window), so field and mesh agree.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const TRI = 510;

function makeGlb(triCount) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint16Array(triCount * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i % 3;
  const posBytes = Buffer.from(pos.buffer);
  const idxBytes = Buffer.from(idx.buffer);
  const bin = Buffer.concat([posBytes, idxBytes]);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: idxBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', max: [1, 1, 0], min: [0, 0, 0] },
      { bufferView: 1, componentType: 5123, count: triCount * 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const jb = Buffer.from(JSON.stringify(json));
  const jpad = (4 - (jb.length % 4)) % 4;
  const jp = Buffer.concat([jb, Buffer.alloc(jpad, 0x20)]);
  const total = 12 + 8 + jp.length + 8 + Math.ceil(bin.length / 4) * 4;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546C67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jp.length, 12);
  out.writeUInt32LE(0x4E4F534A, 16);
  jp.copy(out, 20);
  const o = 20 + jp.length;
  const bpad = Math.ceil(bin.length / 4) * 4;
  out.writeUInt32LE(bpad, o);
  out.writeUInt32LE(0x004E4942, o + 4);
  bin.copy(out, o + 8);
  return out;
}

const BODY = 'body-sha-common-aaa';
const glb = makeGlb(TRI);
writeFileSync(join(dir, 'c.glb'), glb);
const shaC = createHash('sha256').update(glb).digest('hex');

const GLB = 'tools/openclinxr/evidence/hair-cards-probe/fixtures/c.glb';
function arm(tri, before, after, opts = {}) {
  return {
    ok: opts.ok ?? true,
    error: (opts.ok ?? true) ? null : (opts.error ?? 'x'),
    strandCountBefore: before,
    strandCountAfter: after,
    hairTriangleCount: tri,
    glbPath: GLB,
    glbSha256: opts.sha ?? shaC,
    bodySha256: opts.body ?? BODY,
    headPng: 'h.png',
    read: 'r',
  };
}
const A = () => arm(TRI, 10, 20);
const B = () => arm(TRI, 5, 9);
const C = () => arm(TRI, 0, 0);
function j(name, obj) { writeFileSync(join(dir, name), JSON.stringify(obj, null, 1)); }

j('good.json', { arms: { C: C() } });
j('good-all.json', { arms: { A: A(), B: B(), C: C() } });
j('bad-tri-high.json', { arms: { C: { ...C(), hairTriangleCount: 9000 } } });
j('bad-sha-mismatch.json', { arms: { C: { ...C(), glbSha256: '0'.repeat(64) } } });
j('bad-no-children.json', { arms: { A: { ...A(), strandCountAfter: 10 }, B: B(), C: C() } });
j('bad-empty-error.json', { arms: { A: A(), B: B(), C: { ...C(), ok: false, error: '' } } });
j('bad-body-mismatch.json', { arms: { A: A(), B: { ...B(), bodySha256: 'different-body' }, C: C() } });
j('bad-eevee.json', { arms: { C: C() }, labCapture: { harness: 'lab1', glbSha256: shaC }, render: { engine: 'EEVEE' } });
j('bad-forbidden.json', { arms: { C: C() } });
const NEGERR = 'Traceback (most recent call last): File "generate_hair_cards_operator.py", line 135, in execute: AttributeError: GeometryNodeResampleCurve has no attribute mode';
j('neg-good.json', { arms: { C: { ...C(), ok: false, error: NEGERR } }, stage: 'cards' });
j('neg-no-stage.json', { arms: { C: { ...C(), ok: false, error: NEGERR } } });
j('neg-short-error.json', { arms: { C: { ...C(), ok: false, error: 'x' } }, stage: 'cards' });
j('ok-no-png.json', { arms: { C: { ...C(), headPng: 'h.png' } }, stage: 'count' });
// v3 ribbon fixtures: 252 guides x 10 segments -> 5040 tris; dedicated 5040-tri GLB + big PNG probe.
const V3G = 252, V3S = 10, V3T = 2 * V3G * V3S;
const glbV3 = makeGlb(V3T);
writeFileSync(join(dir, 'c-v3.glb'), glbV3);
const shaV3 = createHash('sha256').update(glbV3).digest('hex');
const big = Buffer.alloc(200000, 7);
writeFileSync(join(dir, 'head-big.bin'), big);
const small = Buffer.alloc(100000, 7);
writeFileSync(join(dir, 'head-small.bin'), small);
const V3GLB = 'tools/openclinxr/evidence/hair-cards-probe/fixtures/c-v3.glb';
const V3BIG = 'tools/openclinxr/evidence/hair-cards-probe/fixtures/head-big.bin';
const V3SMALL = 'tools/openclinxr/evidence/hair-cards-probe/fixtures/head-small.bin';
const Cv3 = (o = {}) => ({ ok: true, error: '', strandCountBefore: V3G, strandCountAfter: V3G,
  hairTriangleCount: V3T, glbPath: V3GLB, glbSha256: shaV3, bodySha256: BODY, headPng: V3BIG,
  read: 'r', guideCount: V3G, segments: V3S, cardCount: V3G, bytes: glbV3.length, uvAttributeStored: true, ...o });
j('ok-good.json', { arms: { C: Cv3() }, bodySha256: BODY, stage: 'count', blenderVersion: '5.1.1',
  cardCount: V3G, trisPerCard: 20, cardBboxM: [1, 1, 1], headBboxM: [1, 1, 1],
  withDuplicate: { cardCount: V3G, trisPerCard: 20 }, render: { engine: 'EEVEE' } });
j('bad-tri-derived.json', { arms: { C: Cv3({ hairTriangleCount: Math.round(V3T * 1.2) }) }, bodySha256: BODY, stage: 'count', blenderVersion: '5.1.1', cardCount: V3G, trisPerCard: 24, cardBboxM: [1, 1, 1], headBboxM: [1, 1, 1], withDuplicate: { cardCount: V3G, trisPerCard: 24 }, render: { engine: 'EEVEE' } });
const LOWG = 100, LOWT = 2 * LOWG * V3S;
const glbLow = makeGlb(LOWT);
writeFileSync(join(dir, 'c-low.glb'), glbLow);
const shaLow = createHash('sha256').update(glbLow).digest('hex');
const V3LOW = 'tools/openclinxr/evidence/hair-cards-probe/fixtures/c-low.glb';
j('bad-guides-low.json', { arms: { C: Cv3({ guideCount: LOWG, hairTriangleCount: LOWT, glbPath: V3LOW, glbSha256: shaLow, cardCount: LOWG, bytes: glbLow.length }) }, bodySha256: BODY, stage: 'count', blenderVersion: '5.1.1', cardCount: LOWG, trisPerCard: 20, cardBboxM: [1, 1, 1], headBboxM: [1, 1, 1], withDuplicate: { cardCount: LOWG, trisPerCard: 20 }, render: { engine: 'EEVEE' } });
j('bad-glb-big.json', { arms: { C: Cv3({ headPng: V3SMALL }) }, bodySha256: BODY, stage: 'count', blenderVersion: '5.1.1', cardCount: V3G, trisPerCard: 20, cardBboxM: [1, 1, 1], headBboxM: [1, 1, 1], withDuplicate: { cardCount: V3G, trisPerCard: 20 }, render: { engine: 'EEVEE' } });
j('bad-neg-nonerror.json', { arms: { C: { ...Cv3({ guideCount: 0, segments: V3S, cardCount: 0, bytes: 0 }), ok: false, error: 'something went wrong quietly here!!', glbSha256: '0'.repeat(64) } }, bodySha256: BODY, stage: 'cards', blenderVersion: '5.1.1', cardCount: 0, trisPerCard: 0, cardBboxM: [0, 0, 0], headBboxM: [0, 0, 0], withDuplicate: { cardCount: 0, trisPerCard: 0 }, render: { engine: 'EEVEE' } });
console.log('fixtures written shaC=' + shaC + ' bytes=' + glb.length);
