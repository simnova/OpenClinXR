#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const required = [
  "image-key.py", "check-image-key.mjs", "row-key.json", "sweep-key.png",
  "front-key.png", "mask-overlay-key.png", "hair-sheen-key.png", "hair-id-key.png",
];

function structuralErrors(row, requireFiles = true, dir = here) {
  const errors = [];
  if (!row || typeof row !== "object") return ["row must be an object"];
  if (!Array.isArray(row.cells) || row.cells.length !== 4) {
    errors.push("row must contain exactly four cells");
    return errors;
  }
  if (requireFiles) {
    for (const name of required) if (!fs.existsSync(path.join(dir, name))) errors.push(`missing ${name}`);
  }
  const expected = [[null, 0.25], [55, 0.25], [55, 0.12], [65, 0.12]];
  row.cells.forEach((cell, i) => {
    const tag = `cell ${i + 1}`;
    if (!cell || typeof cell !== "object") { errors.push(`${tag} is missing`); return; }
    for (const field of ["elevationDegrees", "roughness", "exposureStops", "coveragePixels",
      "meanRBSpread", "sheenBandFraction", "faceMeanLuminance", "backgroundLuminance",
      "volume", "strandsAfter", "coverageHairLuminance", "lightReadBack", "checks"]) {
      if (!(field in cell)) errors.push(`${tag} missing ${field}`);
    }
    if (expected[i][0] !== null && Math.abs(cell.elevationDegrees - expected[i][0]) > 1) {
      errors.push(`${tag} elevation differs from request by >1 degree`);
    }
    if (Math.abs(cell.roughness - expected[i][1]) > 1e-6) errors.push(`${tag} roughness mismatch`);
    if (cell.lightReadBack && Math.abs(cell.lightReadBack.keyElevationDegrees - cell.elevationDegrees) > 1e-6) {
      errors.push(`${tag} key elevation read-back mismatch`);
    }
    if (cell.lightReadBack && Math.abs(cell.lightReadBack.roughness - cell.roughness) > 1e-6) {
      errors.push(`${tag} roughness read-back mismatch`);
    }
    if (cell.coveragePixels < 100000) errors.push(`${tag} contaminated/undersized mask: ${cell.coveragePixels}`);
    if (!(cell.meanRBSpread < 0.20)) errors.push(`${tag} contaminated mask spread: ${cell.meanRBSpread}`);
    if (cell.strandsAfter !== 50265) errors.push(`${tag} strandsAfter mismatch`);
    if (requireFiles) {
      for (const key of ["beautyPng", "idPng"]) {
        if (!cell[key] || !fs.existsSync(path.join(dir, cell[key]))) errors.push(`${tag} missing ${key}`);
      }
    }
  });
  if (!row.selected || !row.cells.some(c => c.index === row.selected.index)) errors.push("selected is not a rendered cell");
  if (typeof row.ok !== "boolean") errors.push("row ok must be boolean");
  return errors;
}

function recompute(row, dir) {
  const payload = row.cells.map(c => ({ beauty: path.join(dir, c.beautyPng), id: path.join(dir, c.idPng) }));
  const py = String.raw`
import json, math, sys
import numpy as np
from PIL import Image
out=[]
for item in json.loads(sys.argv[1]):
    beauty=np.asarray(Image.open(item["beauty"]).convert("RGB"),dtype=np.float64)/255.0
    alpha=np.asarray(Image.open(item["id"]).convert("RGBA"),dtype=np.float64)[...,3]/255.0
    mask=alpha>=0.9
    rgb=beauty[mask]
    lumfull=.2126*beauty[...,0]+.7152*beauty[...,1]+.0722*beauty[...,2]
    lum=lumfull[mask]
    p=np.percentile(lum,[10,50,90]) if lum.size else [0,0,0]
    ys,xs=np.nonzero(mask)
    if len(ys):
        bottom=int(ys.min())+max(1,int(math.ceil(.30*(int(ys.max())-int(ys.min())+1))))
        hi=mask & (lumfull>float(p[2]))
        rows=np.indices(mask.shape)[0]
        band=float((hi & (rows<bottom)).sum())/max(1,int(hi.sum()))
    else: band=0.0
    measurelum=.299*beauty[...,0]+.587*beauty[...,1]+.114*beauty[...,2]
    H,W=measurelum.shape
    fx0,fx1=int(W*.30),int(W*.70); fy0,fy1=int(H*.25),int(H*.70)
    face=measurelum[fy0:fy1,fx0:fx1]; face=face[face>.30]
    q=32
    bg=float(sum(measurelum[y:y+q,x:x+q].mean() for y,x in ((0,0),(0,W-q),(H-q,0),(H-q,W-q)))/4)
    x0,x1=int(W*.15),int(W*.85); y1=int(H*.75)
    volume=float((measurelum[:y1,x0:x1]<.30).mean())
    out.append({"coverage":int(mask.sum()),"p10":float(p[0]),"p50":float(p[1]),"p90":float(p[2]),
      "rb":float(rgb[:,0].mean()/max(rgb[:,2].mean(),1e-9)) if len(rgb) else 0.0,
      "spread":float(np.abs(rgb[:,0]-rgb[:,2]).mean()) if len(rgb) else 1.0,
      "band":band,"face":float(face.mean()) if len(face) else 0.0,"background":bg,"volume":volume})
print(json.dumps(out))`;
  const proc = spawnSync("python3", ["-c", py, JSON.stringify(payload)], {
    cwd: path.resolve(dir, "../../../.."), encoding: "utf8",
    env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: path.resolve(dir, "../../../..") },
  });
  if (proc.status !== 0) throw new Error((proc.stderr || proc.stdout).trim());
  return JSON.parse(proc.stdout);
}

function metricErrors(row, actual) {
  const errors = [];
  row.cells.forEach((cell, i) => {
    const got = actual[i]; const hair = cell.coverageHairLuminance; const tag = `cell ${i + 1}`;
    const pairs = [["p10", hair.p10, got.p10], ["p50", hair.p50, got.p50], ["p90", hair.p90, got.p90],
      ["R/B", hair.rbRatio, got.rb], ["spread", cell.meanRBSpread, got.spread],
      ["band", cell.sheenBandFraction, got.band], ["face", cell.faceMeanLuminance, got.face],
      ["background", cell.backgroundLuminance, got.background], ["volume", cell.volume, got.volume]];
    for (const [name, claimed, measured] of pairs) {
      if (!Number.isFinite(claimed) || Math.abs(claimed - measured) > 0.005) {
        errors.push(`${tag} ${name} differs: row=${claimed} recomputed=${measured}`);
      }
    }
    if (cell.coveragePixels !== got.coverage) errors.push(`${tag} coverage differs: row=${cell.coveragePixels} recomputed=${got.coverage}`);
  });
  return errors;
}

if (process.argv[2] === "--self-test") {
  const skeleton = { ok: true, cells: [], selected: null };
  if (!structuralErrors(skeleton, false).length) throw new Error("self-test accepted skeleton row");
  const contaminated = { ok: false, selected: { index: 1 }, cells: Array.from({ length: 4 }, (_, i) => ({
    index: i + 1, elevationDegrees: i === 0 ? 20 : (i === 3 ? 65 : 55), roughness: i < 2 ? .25 : .12,
    exposureStops: 0, coveragePixels: 99999, meanRBSpread: .20, sheenBandFraction: 0,
    faceMeanLuminance: .6, backgroundLuminance: .5, volume: .224, strandsAfter: 50265,
    coverageHairLuminance: {}, lightReadBack: { keyElevationDegrees: i === 0 ? 20 : (i === 3 ? 65 : 55), roughness: i < 2 ? .25 : .12 }, checks: {},
  })) };
  const errs = structuralErrors(contaminated, false);
  if (!errs.some(e => e.includes("undersized")) || !errs.some(e => e.includes("spread"))) {
    throw new Error("self-test failed to reject contaminated mask");
  }
  console.log("PASS self-test: skeleton and contaminated rows rejected");
  process.exit(0);
}

const rowPath = path.resolve(process.argv[2] || path.join(here, "row-key.json"));
const row = JSON.parse(fs.readFileSync(rowPath, "utf8"));
const dir = path.dirname(rowPath);
const errors = structuralErrors(row, true, dir);
if (!errors.length) errors.push(...metricErrors(row, recompute(row, dir)));
if (errors.length) {
  console.error(errors.map(e => `FAIL ${e}`).join("\n"));
  process.exit(1);
}
console.log(`PASS row-key.json: four cells, selected=${row.selected.index}, ok=${row.ok}`);
