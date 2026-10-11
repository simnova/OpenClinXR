#!/usr/bin/env node
// Hair probe judge: verifies a hair-cards probe report.json against named clauses.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CLAUSES = ['sha-matches','tri-window','children-added','error-on-failure','body-same','lab-provenance','forbidden-sha','tri-derived','guide-count','size','negative-honest'];

function shaFile(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function triCountOfGlb(p) {
  const buf = readFileSync(p);
  if (buf.length < 20) throw new Error('too small');
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4E4F534A) throw new Error('bad chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let sum = 0;
  for (const m of (json.meshes ?? [])) {
    for (const prim of (m.primitives ?? [])) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      if (prim.indices !== undefined) {
        const acc = json.accessors[prim.indices];
        sum += acc.count / 3;
      } else {
        const acc = json.accessors[prim.attributes.POSITION];
        sum += acc.count / 3;
      }
    }
  }
  return sum;
}

function parseArgs(argv) {
  const out = { report: null, arms: null, requireLab: false, forbidSha: null, triMax: 8000, allowNegative: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arms') out.arms = argv[++i];
    else if (a === '--require-lab') out.requireLab = true;
    else if (a === '--forbid-sha') out.forbidSha = String(argv[++i]).toLowerCase();
    else if (a === '--tri-max') out.triMax = Number(argv[++i]);
    else if (a === '--allow-negative') out.allowNegative = true;
    else if (!out.report) out.report = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.report) { console.error('missing report'); process.exit(2); }
  let rep;
  try {
    rep = JSON.parse(readFileSync(args.report, 'utf8'));
  } catch { process.exit(2); }
  if (typeof rep !== 'object' || rep === null) process.exit(2);
  let armsAll = rep.arms;
  if (typeof armsAll !== 'object' || armsAll === null) process.exit(2);
  let names;
  if (args.arms) {
    names = String(args.arms).split(',').map(s => s.trim()).filter(Boolean);
    for (const n of names) if (!armsAll[n]) process.exit(2);
  } else {
    names = Object.keys(armsAll);
  }
  const fails = [];
  const fail = (id, detail) => fails.push(`FAIL ${id}: ${detail}`);

  // structural: each selected arm must be an object with required fields; else exit 2
  for (const n of names) {
    const a = armsAll[n];
    if (typeof a !== 'object' || a === null) process.exit(2);
    for (const f of ['ok','error','strandCountBefore','strandCountAfter','hairTriangleCount','glbPath','glbSha256','bodySha256','headPng','read']) {
      if (!(f in a)) process.exit(2);
    }
  }

  // sha-matches
  for (const n of names) {
    const a = armsAll[n];
    if (a.ok === true) {
      try {
        if (!existsSync(a.glbPath)) { fail('sha-matches', `arm ${n} glb missing`); continue; }
        const h = shaFile(a.glbPath);
        if (h !== String(a.glbSha256).toLowerCase()) fail('sha-matches', `arm ${n} sha mismatch`);
      } catch (e) { fail('sha-matches', `arm ${n} unreadable`); }
    }
  }

  // tri-window: arm C only (upper bound from --tri-max)
  if (names.includes('C')) {
    const c = armsAll['C'];
    if (c.ok === true) {
      const t = c.hairTriangleCount;
      if (!(typeof t === 'number' && t > 500 && t < args.triMax)) fail('tri-window', `arm C triangles ${t} outside (500,${args.triMax})`);
    }
  }

  // children-added: A and B
  for (const n of ['A','B']) {
    if (!names.includes(n)) continue;
    const a = armsAll[n];
    if (a.ok === true) {
      if (!(a.strandCountAfter > a.strandCountBefore)) fail('children-added', `arm ${n} no children added`);
    }
  }

  // error-on-failure
  for (const n of names) {
    const a = armsAll[n];
    if (a.ok === false) {
      if (typeof a.error !== 'string' || a.error.length === 0) fail('error-on-failure', `arm ${n} empty error`);
    }
  }

  // body-same
  {
    const bodies = new Set(names.map(n => String(armsAll[n].bodySha256)));
    if (bodies.size > 1) fail('body-same', `body sha differs across ${names.join(',')}`);
  }

  // lab-provenance
  if (args.requireLab) {
    const lab = rep.labCapture;
    const eng = rep.render?.engine;
    let ok = false;
    if (lab && typeof lab.harness === 'string' && lab.harness.length > 0) {
      const shas = new Set(names.map(n => String(armsAll[n].glbSha256).toLowerCase()));
      if (shas.has(String(lab.glbSha256).toLowerCase())) {
        if (!(typeof eng === 'string' && /eevee|workbench/i.test(eng))) ok = true;
      }
    }
    if (!ok) fail('lab-provenance', `lab capture provenance invalid`);
  }

  // forbidden-sha
  if (args.forbidSha) {
    for (const n of names) {
      if (String(armsAll[n].glbSha256).toLowerCase() === args.forbidSha) {
        fail('forbidden-sha', `arm ${n} uses forbidden sha`);
      }
    }
  }

  // tri-derived: v3 reports carry guideCount+segments (legacy fixtures without them skip);
  // field within 2% of product, GLB parse within 2% of field
  if (names.includes('C')) {
    const c = armsAll['C'];
    if (c.ok === true && ('guideCount' in c || 'segments' in c)) {
      const g = c.guideCount, s = c.segments, t = c.hairTriangleCount;
      if (!(typeof g === 'number' && typeof s === 'number')) fail('tri-derived', `arm C missing guideCount/segments`);
      else {
        const prod = 2 * g * s;
        if (!(typeof t === 'number' && Math.abs(t - prod) <= 0.02 * prod)) fail('tri-derived', `arm C triangles ${t} not within 2% of 2*${g}*${s}=${prod}`);
        else {
          try {
            const parsed = triCountOfGlb(c.glbPath);
            if (Math.abs(parsed - t) > 0.02 * t) fail('tri-derived', `arm C GLB parsed ${parsed} not within 2% of field ${t}`);
          } catch (e) { fail('tri-derived', `arm C GLB unparsable`); }
        }
      }
    }
  }

  // guide-count: >=200 guides, segments 8..20 (v3 only; legacy skip)
  if (names.includes('C')) {
    const c = armsAll['C'];
    if (c.ok === true && ('guideCount' in c || 'segments' in c)) {
      if (!(typeof c.guideCount === 'number' && c.guideCount >= 200)) fail('guide-count', `arm C guideCount ${c.guideCount} < 200`);
      if (!(typeof c.segments === 'number' && c.segments >= 8 && c.segments <= 20)) fail('guide-count', `arm C segments ${c.segments} outside 8..20`);
    }
  }

  // size: v3 only (reports carrying bytes field); GLB under 500000, PNG >= 200000
  if (names.includes('C')) {
    const c = armsAll['C'];
    if (c.ok === true && ('bytes' in c)) {
      try {
        if (readFileSync(c.glbPath).length >= 500000) fail('size', `arm C GLB over 500000 bytes`);
      } catch { fail('size', `arm C GLB unreadable`); }
      try {
        if (readFileSync(c.headPng).length < 200000) fail('size', `arm C PNG under 200000 bytes`);
      } catch { fail('size', `arm C PNG unreadable`); }
    }
  }

  // negative-honest: v3 only (reports carrying blenderVersion); ok:false needs stage, blenderVersion, error>=20 chars with Traceback/Error, glbSha256 64 zeros
  if (args.allowNegative && ('blenderVersion' in rep)) {
    for (const n of names) {
      const a = armsAll[n];
      if (a.ok === false) {
        const st = rep.stage ?? a.stage;
        if (!['setup','apply','cards','export','count'].includes(st)) fail('negative-honest', `arm ${n} stage ${JSON.stringify(st)} not one of five`);
        if (!(typeof rep.blenderVersion === 'string' && rep.blenderVersion.length > 0)) fail('negative-honest', `arm ${n} missing blenderVersion`);
        if (!(typeof a.error === 'string' && a.error.length >= 20 && /Traceback|Error/.test(a.error))) fail('negative-honest', `arm ${n} error not honest`);
        if (String(a.glbSha256).toLowerCase() !== '0'.repeat(64)) fail('negative-honest', `arm ${n} claims GLB sha`);
      }
    }
  }

  for (const l of fails) console.log(l);
  // allow-negative: ok:false passes only with long error + named stage;
  // ok:true additionally requires a >=50000-byte head PNG.
  if (args.allowNegative) {
    const negFails = [];
    for (const n of names) {
      const a = armsAll[n];
      if (a.ok === false) {
        const st = rep.stage ?? a.stage;
        if (!['setup', 'apply', 'cards', 'export', 'count'].includes(st)) negFails.push(`FAIL negative-stage: arm ${n} stage ${JSON.stringify(st)} not one of five`);
        if (!(typeof a.error === 'string' && a.error.length > 20)) negFails.push(`FAIL negative-error: arm ${n} error too short`);
      } else {
        try {
          if (!existsSync(a.headPng) || readFileSync(a.headPng).length < 50000) negFails.push(`FAIL png-present: arm ${n} head PNG missing or under 50000 bytes`);
        } catch { negFails.push(`FAIL png-present: arm ${n} head PNG unreadable`); }
      }
    }
    for (const l of negFails) console.log(l);
    process.exit(fails.concat(negFails).length ? 1 : 0);
  }
  process.exit(fails.length ? 1 : 0);
}
main();
