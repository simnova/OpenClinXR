#!/usr/bin/env node
/**
 * graft-hem-garment.mjs — build the hem-finish output without round-tripping
 * untouched meshes through Blender.
 *
 * The Blender full-GLB round trip rewrites every mesh it does not finish
 * (st-palette round 5 C2: nurse eyebrows 9597/9856 -> 8690/10838, body verts
 * 8437 -> 8455, pants 2704 -> 2676 tris). This script takes the finished
 * garment mesh primitives from the Blender export and grafts them into the
 * stage INPUT document, so every other mesh keeps its exact input accessor
 * data. It then re-reads the output and proves, per mesh, that all
 * non-garment POSITION/index (and other attribute) bytes are identical to
 * the input file. Any mismatch fails loudly — no silent re-pin.
 *
 * st-palette round 6 F1: the Blender export recomputes normals over the whole
 * finished garment, and the family t-shirt mesh is unwelded (2 verts per
 * face), so recomputed normals are flat per face — visible as vertical facet
 * bands on the chest the hem never touched. Measured: the export also adds
 * sub-micron float noise to every POSITION (0/5400 verts bit-exact, 5328
 * under 1 um, 72 hem verts moved millimetres), so exact equality never fires.
 * Verts whose finished POSITION is within 1 micron of the input POSITION
 * keep the full input vertex (POSITION, NORMAL and all other attributes);
 * only verts the hem actually moved (millimetre drift) take the finished
 * vertex. Vert-count changes (e.g. the nurse closed-solid cut) fall back to
 * the finished vertex for that prim.
 *
 * Usage:
 *   node graft-hem-garment.mjs \
 *     --origin <stage-input.glb> --finished <blender-export.glb> \
 *     --garment <meshName> --output <out.glb> [--report <report.json>]
 */

import { NodeIO } from "@gltf-transform/core";
import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1];
  }
  for (const k of ["origin", "finished", "garment", "output"]) {
    if (!out[k]) throw new Error(`missing required --${k}`);
  }
  return out;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Snapshot every primitive accessor array of a mesh, keyed for comparison. */
function snapshotMesh(doc, meshName) {
  const mesh = doc.getRoot().listMeshes().find((m) => m.getName() === meshName);
  if (!mesh) throw new Error(`mesh ${JSON.stringify(meshName)} not found`);
  return mesh.listPrimitives().map((prim) => {
    const attrs = {};
    for (const sem of prim.listSemantics()) {
      const acc = prim.getAttribute(sem);
      attrs[sem] = {
        array: Array.from(acc.getArray()),
        type: acc.getType(),
        normalized: acc.getNormalized(),
      };
    }
    const idx = prim.getIndices();
    return {
      attrs,
      indices: idx ? Array.from(idx.getArray()) : null,
      targets: prim.listTargets().length,
    };
  });
}

function findMesh(doc, meshName, label) {
  const mesh = doc.getRoot().listMeshes().find((m) => m.getName() === meshName);
  if (!mesh) {
    const names = doc.getRoot().listMeshes().map((m) => m.getName()).join("\n  ");
    throw new Error(`${label}: mesh ${JSON.stringify(meshName)} not found. Meshes:\n  ${names}`);
  }
  return mesh;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const io = new NodeIO();
  const originDoc = await io.readBinary(readFileSync(args.origin));
  const finDoc = await io.readBinary(readFileSync(args.finished));

  const originMesh = findMesh(originDoc, args.garment, "origin");
  const finMesh = findMesh(finDoc, args.garment, "finished");
  const originPrims = originMesh.listPrimitives();
  const finPrims = finMesh.listPrimitives();
  if (originPrims.length !== finPrims.length) {
    throw new Error(
      `primitive count mismatch on ${args.garment}: origin ${originPrims.length} vs finished ${finPrims.length}`,
    );
  }

  let attrsCopied = 0;
  let normalPreservedVerts = 0;
  let normalFinishedVerts = 0;
  let normalPreservedPrims = 0;
  for (let p = 0; p < originPrims.length; p += 1) {
    const op = originPrims[p];
    const fp = finPrims[p];
    if (op.listTargets().length !== fp.listTargets().length) {
      throw new Error(`morph target count mismatch on ${args.garment} prim ${p}`);
    }
    // Snapshot origin/finished POSITION before any replacement so the
    // per-vertex comparison below always reads input bytes (round 6 F1).
    const oPosAcc = op.getAttribute("POSITION");
    const fPosAcc = fp.getAttribute("POSITION");
    const oPosArr = oPosAcc ? Array.from(oPosAcc.getArray()) : null;
    const fPosArr = fPosAcc ? Array.from(fPosAcc.getArray()) : null;
    // Round 6 F1: alignable when the prim is index-aligned with the input.
    // The per-vertex moved/stayed decision uses a 1 um POSITION drift
    // threshold (measured: unmoved verts carry sub-micron export noise,
    // hem verts move millimetres — clean separation, no cliff).
    const POSITION_TOL_M = 1e-6;
    const primAlignable =
      oPosArr !== null && fPosArr !== null &&
      oPosAcc.getCount() === fPosAcc.getCount();
    let movedVerts = null;
    if (primAlignable) {
      movedVerts = new Uint8Array(oPosAcc.getCount());
      for (let v = 0; v < oPosAcc.getCount(); v += 1) {
        const px = v * 3;
        const dx = oPosArr[px] - fPosArr[px];
        const dy = oPosArr[px + 1] - fPosArr[px + 1];
        const dz = oPosArr[px + 2] - fPosArr[px + 2];
        movedVerts[v] = Math.sqrt(dx * dx + dy * dy + dz * dz) < POSITION_TOL_M ? 0 : 1;
      }
    }
    for (const sem of fp.listSemantics()) {
      const facc = fp.getAttribute(sem);
      const oacc = op.getAttribute(sem);
      if (primAlignable && oacc && oacc.getCount() === facc.getCount()) {
        // Per-vertex graft: stayed verts keep input bytes, moved verts take
        // the finish. Covers POSITION, NORMAL and every other attribute.
        // The merged array keeps the input's TypedArray class so component
        // types (float32 positions/normals, uint joints) never change.
        const oArr = Array.from(oacc.getArray());
        const fArr = Array.from(facc.getArray());
        const perVert = oArr.length / oPosAcc.getCount();
        const Ctor = oacc.getArray().constructor;
        const merged = new Ctor(oArr.length);
        for (let v = 0; v < oPosAcc.getCount(); v += 1) {
          const moved = movedVerts[v] === 1;
          for (let c = 0; c < perVert; c += 1) {
            merged[v * perVert + c] = moved ? fArr[v * perVert + c] : oArr[v * perVert + c];
          }
        }
        const copy = originDoc
          .createAccessor()
          .setType(facc.getType())
          .setArray(merged)
          .setNormalized(facc.getNormalized());
        op.setAttribute(sem, copy);
        attrsCopied += 1;
        if (sem === "NORMAL") {
          normalPreservedPrims += 1;
          for (let v = 0; v < oPosAcc.getCount(); v += 1) {
            if (movedVerts[v] === 1) normalFinishedVerts += 1;
            else normalPreservedVerts += 1;
          }
        }
        continue;
      }
      const copy = originDoc
        .createAccessor()
        .setType(facc.getType())
        .setArray(facc.getArray())
        .setNormalized(facc.getNormalized());
      op.setAttribute(sem, copy);
      attrsCopied += 1;
    }
    // Drop origin-only attributes the finish removed (none expected; loud).
    for (const sem of op.listSemantics()) {
      if (!fp.getAttribute(sem)) throw new Error(`finished prim ${p} lost attribute ${sem}`);
    }
    const fidx = fp.getIndices();
    if (fidx) {
      op.setIndices(
        originDoc.createAccessor().setType("SCALAR").setArray(fidx.getArray()),
      );
    } else if (op.getIndices()) {
      throw new Error(`finished prim ${p} lost its indices`);
    }
  }

  const untouched = originDoc
    .getRoot()
    .listMeshes()
    .map((m) => m.getName())
    .filter((n) => n !== args.garment);
  const before = new Map(untouched.map((n) => [n, snapshotMesh(originDoc, n)]));

  const outBytes = await io.writeBinary(originDoc);
  writeFileSync(args.output, Buffer.from(outBytes));

  // Prove the writer preserved every untouched mesh byte-exactly.
  const reread = await io.readBinary(readFileSync(args.output));
  let compared = 0;
  for (const name of untouched) {
    const want = before.get(name);
    const got = snapshotMesh(reread, name);
    if (want.length !== got.length) {
      throw new Error(`output primitive count changed on untouched mesh ${name}`);
    }
    for (let p = 0; p < want.length; p += 1) {
      const w = want[p];
      const g = got[p];
      if (w.targets !== g.targets) throw new Error(`morph drift on untouched ${name}`);
      const sems = new Set([...Object.keys(w.attrs), ...Object.keys(g.attrs)]);
      for (const sem of sems) {
        if (!w.attrs[sem] || !g.attrs[sem]) throw new Error(`attribute set drift on untouched ${name} prim ${p}: ${sem}`);
        if (!arraysEqual(w.attrs[sem].array, g.attrs[sem].array)) {
          throw new Error(`accessor bytes changed on untouched mesh ${name} prim ${p} ${sem}`);
        }
        compared += w.attrs[sem].array.length;
      }
      if ((w.indices === null) !== (g.indices === null)) throw new Error(`index presence drift on untouched ${name}`);
      if (w.indices && !arraysEqual(w.indices, g.indices)) {
        throw new Error(`index bytes changed on untouched mesh ${name} prim ${p}`);
      }
      if (w.indices) compared += w.indices.length;
    }
  }

  const report = {
    tool: "graft-hem-garment.mjs",
    origin: args.origin,
    finished: args.finished,
    garment: args.garment,
    output: args.output,
    primsReplaced: originPrims.length,
    attrsCopied,
    normalPreservedVerts,
    normalFinishedVerts,
    normalPreservedPrims,
    untouchedMeshes: untouched.length,
    accessorScalarsCompared: compared,
  };
  if (args.report) writeFileSync(args.report, `${JSON.stringify(report, null, 1)}\n`);
  process.stdout.write(`GRAFT_HEM_GARMENT ${JSON.stringify(report)}\n`);
}

main().catch((err) => {
  process.stderr.write(`graft-hem-garment FAILED: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
