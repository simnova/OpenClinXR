/**
 * Download VERIFIED Sketchfab models for equipment bank (MADR 0054 lane 1).
 *
 * Requires SKETCHFAB_API_TOKEN in env (.env.local via mise/direnv).
 *
 *   pnpm factory:equipment:sketchfab:download
 *   pnpm factory:equipment:sketchfab:download -- --only hospital_bed
 *
 * claimScope: licence-aware offline acquisition into staging.
 * notEvidenceFor: clinical accuracy, Quest readiness, automatic promotion.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const STAGING = path.join(REPO, ".openclinxr/staging/equipment/sketchfab");

export type SketchfabTarget = {
  id: string;
  uid: string;
  equipmentId: string;
  attribution: string;
  licence: string;
  url: string;
};

/** VERIFIED CC BY 4.0 downloadable targets (equipment-oss-candidates.md). */
export const SKETCHFAB_TARGETS: SketchfabTarget[] = [
  {
    id: "hospital_bed",
    uid: "9cd9464990d2456e98b69978447852aa",
    equipmentId: "hospital_bed_equipment",
    attribution: "Hospital Bed by Matt LeMoine (Sketchfab, CC BY 4.0)",
    licence: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/hospital-bed-9cd9464990d2456e98b69978447852aa",
  },
  {
    id: "stretcher",
    uid: "edfeb93b201b4c8da2c7a4fb5dea090c",
    equipmentId: "stretcher_equipment",
    attribution: "Hospital Stretcher Trolley by UsmanAzhar2256 (Sketchfab, CC BY 4.0)",
    licence: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/hospital-stretcher-trolley-edfeb93b201b4c8da2c7a4fb5dea090c",
  },
  {
    id: "exam_table",
    uid: "459c00d5a0524c67a4ad2fa5c6eacb15",
    equipmentId: "exam_table_equipment",
    attribution: "Exam Table by orphic_oasis8 (Sketchfab, CC BY 4.0)",
    licence: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/exam-table-459c00d5a0524c67a4ad2fa5c6eacb15",
  },
  {
    id: "curtain_monitor",
    uid: "295ed50eeaa249e8bbeed7b305d3da71",
    equipmentId: "privacy_curtain_equipment",
    attribution: "Bed Curtain and Vital Signs Monitor by Ethan Cragun (Sketchfab, CC BY 4.0)",
    licence: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/bed-curtain-and-vital-signs-monitor-295ed50eeaa249e8bbeed7b305d3da71",
  },
];

type DownloadUrls = {
  glb?: { url: string; size?: number };
  gltf?: { url: string; size?: number };
  usdz?: { url: string; size?: number };
  source?: { url: string; size?: number };
};

async function fetchDownloadUrls(uid: string, token: string): Promise<DownloadUrls> {
  const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sketchfab download API ${res.status} for ${uid}: ${body.slice(0, 400)}`);
  }
  return (await res.json()) as DownloadUrls;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} → ${dest}`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  // Node 18+ Readable.fromWeb
  const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
}

export async function downloadSketchfabTarget(
  target: SketchfabTarget,
  token: string,
): Promise<{ glbPath: string; provenancePath: string; bytes: number }> {
  const dir = path.join(STAGING, target.id);
  mkdirSync(dir, { recursive: true });
  const urls = await fetchDownloadUrls(target.uid, token);
  const glbUrl = urls.glb?.url ?? urls.gltf?.url;
  if (!glbUrl) {
    throw new Error(`${target.id}: no glb/gltf URL in download response (keys: ${Object.keys(urls).join(",")})`);
  }
  const ext = urls.glb?.url ? "glb" : "zip";
  const glbPath = path.join(dir, `${target.id}.${ext}`);
  await downloadFile(glbUrl, glbPath);
  const bytes = readFileSync(glbPath).byteLength;
  const provenance = {
    schemaVersion: "openclinxr.equipment-sketchfab-provenance.v1",
    measuredAt: new Date().toISOString(),
    target,
    sketchfabUid: target.uid,
    downloadFormat: ext,
    bytes,
    claimScope: "offline bank staging of CC-BY Sketchfab equipment mesh",
    notEvidenceFor: ["clinical_accuracy", "quest_readiness", "exam_equivalence", "hospital_deck_ssot"],
  };
  const provenancePath = path.join(dir, "provenance.json");
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  return { glbPath, provenancePath, bytes };
}

async function main(): Promise<void> {
  const token = process.env.SKETCHFAB_API_TOKEN?.trim();
  if (!token) {
    console.error("SKETCHFAB_API_TOKEN missing — set in .env.local and reload direnv/mise");
    process.exit(1);
  }
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  const targets = only
    ? SKETCHFAB_TARGETS.filter((t) => t.id === only || t.equipmentId === only)
    : SKETCHFAB_TARGETS;
  if (targets.length === 0) {
    console.error(`no targets match --only ${only}`);
    process.exit(1);
  }
  mkdirSync(STAGING, { recursive: true });
  const results = [];
  for (const t of targets) {
    process.stdout.write(`[sketchfab] ${t.id}… `);
    try {
      const r = await downloadSketchfabTarget(t, token);
      console.log(`ok ${r.bytes} B → ${r.glbPath}`);
      results.push({ id: t.id, ok: true, ...r });
    } catch (e) {
      console.log(`FAIL ${e instanceof Error ? e.message : e}`);
      results.push({ id: t.id, ok: false, error: String(e) });
    }
  }
  const reportPath = path.join(STAGING, "download-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2) + "\n",
  );
  console.log(`[sketchfab] report → ${reportPath}`);
  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 2 : 0);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
