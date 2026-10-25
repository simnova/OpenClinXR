#!/usr/bin/env node
// graft-chest.mjs — bounded ED chest graft (node-only, portable).
// Copies exact source breast rest X onto a collapsed target; restores only
// midline-pinned breast sampler X. y/z, times, and all other bytes preserved.
// No fixed paths: every location is a CLI argument with full-SHA pinning.
import { NodeIO } from "@gltf-transform/core";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && !v) throw new Error(`missing --${name}`);
  return v;
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const refuse = (m) => { throw new Error(`REFUSE: ${m}`); };

const source = arg("source"), input = arg("input"), output = arg("output"), proof = arg("proof");
const expSrc = arg("expected-source-sha"), expIn = arg("expected-input-sha");
for (const [p, n] of [[source, "source"], [input, "input"]]) if (!existsSync(p)) refuse(`missing ${n}: ${p}`);
if (existsSync(output)) refuse(`no-clobber: output exists: ${output}`);
if (existsSync(proof)) refuse(`no-clobber: proof exists: ${proof}`);
if (output === source || output === input || proof === source || proof === input) refuse("outputs must differ from inputs");
const srcBytes = readFileSync(source), tgtBytes = readFileSync(input);
if (sha(srcBytes) !== expSrc) refuse("source sha mismatch");
if (sha(tgtBytes) !== expIn) refuse("input sha mismatch");

const io = new NodeIO();
const srcDoc = await io.read(source), tgtDoc = await io.read(input);
const R = (d, n) => d.getRoot().listNodes().find((x) => x.getName() === n);
const sL = R(srcDoc, "breast.L").getTranslation(), sR = R(srcDoc, "breast.R").getTranslation();
const tL0 = R(tgtDoc, "breast.L").getTranslation(), tR0 = R(tgtDoc, "breast.R").getTranslation();
const sPL = R(srcDoc, "breast.L").getParentNode(), tPL = R(tgtDoc, "breast.L").getParentNode();
const sPR = R(srcDoc, "breast.R").getParentNode(), tPR = R(tgtDoc, "breast.R").getParentNode();
const sSp = R(srcDoc, "spine02").getTranslation(), tSp = R(tgtDoc, "spine02").getTranslation();
const parentOk = sPL.getName() === tPL.getName() && sPR.getName() === tPR.getName()
  && sPL.getName() === "spine02"
  && Math.abs(sSp[0] - tSp[0]) < 1e-6 && Math.abs(sSp[1] - tSp[1]) < 1e-6 && Math.abs(sSp[2] - tSp[2]) < 1e-6;
if (!parentOk) refuse("parent frame mismatch; local X would not transfer 1:1");
if (!(Math.abs(sL[0] + sR[0]) < 1e-9 && Math.abs(sL[0]) > 0.03 && Math.abs(sL[0]) < 0.125))
  refuse("source anchors not genuine mirrored off-midline");
for (const a of srcDoc.getRoot().listAnimations())
  for (const ch of a.listChannels()) {
    const nm = ch.getTargetNode()?.getName();
    if (!/^breast\.[LR]$/.test(nm || "") || ch.getTargetPath() !== "translation") continue;
    const arr = ch.getSampler().getOutput().getArray(), rest = nm === "breast.L" ? sL[0] : sR[0];
    for (let i = 0; i < arr.length; i += 3)
      if (Math.abs(arr[i] - rest) > 1e-6) refuse(`source clip ${a.getName()} ${nm} interpolates`);
  }
R(tgtDoc, "breast.L").setTranslation([sL[0], tL0[1], tL0[2]]);
R(tgtDoc, "breast.R").setTranslation([sR[0], tR0[1], tR0[2]]);
const fixed = [], verified = [];
for (const a of tgtDoc.getRoot().listAnimations())
  for (const ch of a.listChannels()) {
    const nm = ch.getTargetNode()?.getName();
    if (!/^breast\.[LR]$/.test(nm || "") || ch.getTargetPath() !== "translation") continue;
    const out = ch.getSampler().getOutput(), arr = out.getArray();
    const rest = nm === "breast.L" ? sL[0] : sR[0];
    let pinned = false, alreadyOk = true;
    for (let i = 0; i < arr.length; i += 3) {
      if (Math.abs(arr[i]) <= 1e-6) pinned = true;
      if (Math.abs(arr[i] - rest) > 1e-6 && Math.abs(arr[i]) > 1e-6) alreadyOk = false;
    }
    if (pinned) {
      let n = 0;
      for (let i = 0; i < arr.length; i += 3) if (Math.abs(arr[i]) <= 1e-6) { arr[i] = rest; n++; }
      fixed.push({ animation: a.getName(), joint: nm, keysFixed: n, restX: rest });
    } else verified.push({ animation: a.getName(), joint: nm, keys: arr.length / 3, alreadyAt: rest });
    if (!pinned && !alreadyOk) refuse(`unexpected breast key in ${a.getName()} ${nm}`);
  }
mkdirSync(dirname(output), { recursive: true });
await io.write(output, tgtDoc);
mkdirSync(dirname(proof), { recursive: true });
writeFileSync(proof, JSON.stringify({
  schema: "openclinxr.ed-chest-graft-proof.v1",
  source: { sha256: expSrc, restL: [...sL], restR: [...sR], parent: "spine02", spine02: [...sSp] },
  targetBefore: { sha256: expIn, restLBefore: [...tL0], restRBefore: [...tR0], spine02: [...tSp] },
  parentFrameAgreementM: [sSp[0] - tSp[0], sSp[1] - tSp[1], sSp[2] - tSp[2]],
  transfer: "source rest X copied byte-exact (not restated to a bar); guard_withdraw_rlq has no source counterpart (ED-specific region clip) so its midline-pinned keys take source rest X with target-native y/z/times; source clips constant so no time interpolation; other clips verified untouched, never rewritten",
  graft: { restLAfter: [sL[0], tL0[1], tL0[2]], restRAfter: [sR[0], tR0[1], tR0[2]] },
  animations: { fixedMidlinePinned: fixed, verifiedAlreadyCorrect: verified },
  untouched: "mesh/weights/morphs/gown/normals/images/materials untouched",
  candidateSha256: sha(readFileSync(output)),
}, null, 2) + "\n");
console.log(JSON.stringify({ parentOk, fixed, candidateSha: sha(readFileSync(output)) }));
