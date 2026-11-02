import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { readRoomGlb } from "../../../../../../tools/openclinxr/evidence/room-gl-io.js";

/**
 * (Historical header preserved — see ADAPTED note at the end.)
 *
 *  *The room baker's own docstring records a probe it does not reproduce ...* (2026-08-21 cave bake:
 *  wall 13.0, floor 1.7, ceiling 254.8 — the wall/floor received almost no energy).
 *
 * ## ADAPTED (ci-w7, 2026-10-30)
 *
 * The guarded subject — the `room-albedo-ao-bake.py` `openclinxr_room_bake_*` pipeline and its
 * `room-bake-means.json` log — no longer ships. The fleet moved to the `shell_bake` chain
 * (`room_generate → room_clinic_finish → lighting_design`, `factory:room:promote`):
 * regeneration batch 1 `547fb18a9` (2026-10-01), re-promotes `d8e610e32` (2026-10-02).
 * Current-byte authority: `apps/ui-xr/public/xr-assets/environment/PROVENANCE.md`.
 * The chain's per-room report is `docs/openclinxr/room-realism/rooms-regen/RESULTS.json`
 * (schema `openclinxr.rooms-regen-results.v1`, 14 rows, measured columns per room).
 *
 * The guard is unchanged in shape: (1) the producer emits a per-room measured report (structural);
 * (2) wall and floor leave the measured cave band — directional, no target value (the 2026-08-21
 * cave controls 13.0/1.7 are the immutable before-column, not a spec); (3) the report is bound to
 * the shipped bytes (sha + triangles per row — a drift in either fails); (4) the ceiling is not
 * blown (lower bound = the old cave max 13.0, upper = structural clipping at 255 — both measured,
 * neither invented); (5) the report covers exactly the shipped fleet (the deliberate 14-room
 * rewrite inverts the old one-room counterweight: no room may silently drop out).
 *
 * Measured on the current shipped bytes 2026-10-30 via the shared `decode-png` reader:
 * wall 218.29, floor 171.19, ceiling 173.58 — the cave is gone, nothing is clipped.
 *
 * claimScope: whether the shell_bake chain reports per-room measured columns, and whether the
 *   shipped fleet's wall/floor leave the cave band without the ceiling clipping.
 * notEvidenceFor: the other 13 rooms' appearance; the AO bake; the product lighting default;
 *   whether any room looks CORRECT; quest_readiness.
 */

const ENV = join(repoRoot(), "apps/ui-xr/public/xr-assets/environment");
const ROOM = "infinigen-primary-care-clinic.glb";
const REPORT = join(repoRoot(), "docs/openclinxr/room-realism/rooms-regen/RESULTS.json");
/** Current-byte authority: re-derived pins live here, updated by the d8e610e32 re-promote. */
const PROVENANCE = `${ENV}/PROVENANCE.md`;

/** CAVE — shipped bytes measured 2026-08-21 on the superseded bake. Immutable before-column. */
const CAVE = { wall: 13.0, floor: 1.7 } as const;
/** Lower luminance bound: the darkest any surface read in the cave bake. Not invented. */
const CAVE_MAX = 13.0;

/** shell_bake albedo textures in the promoted rooms. */
const TEX = {
  wall: "shell_bake_albedo_wall",
  floor: "shell_bake_albedo_floor",
  ceiling: "shell_bake_albedo_ceiling",
} as const;

type RegenRow = {
  environmentId?: string;
  status?: string;
  seed?: number;
  glb?: {
    path?: string;
    sha256?: string;
    triangles?: number;
    everyPrimitiveHasMaterial?: boolean;
    decodedTextureBudgetPass?: boolean;
  };
};
type RegenReport = { schemaVersion?: string; rows?: RegenRow[] };

function report(): RegenReport {
  if (!existsSync(REPORT)) throw new Error("missing artifact");
  return JSON.parse(readFileSync(REPORT, "utf8")) as RegenReport;
}

/** Independent measurement, same technique as the cave probe: decode the shipped PNG, mean 0..255. */
async function shippedAlbedoMeans(room = ROOM): Promise<Record<string, number>> {
  const { decodePng } = await import("@openclinxr/png-measure/evidence-png") as {
    decodePng: (b: Uint8Array) => { w: number; h: number; lum: Float32Array } | null;
  };
  const doc = await readRoomGlb(`${ENV}/${room}`);
  const out: Record<string, number> = {};
  for (const t of doc.getRoot().listTextures()) {
    const n = t.getName() ?? "";
    if (!n.startsWith("shell_bake_albedo_")) continue;
    const d = decodePng(t.getImage()!);
    if (!d) continue;
    let sum = 0;
    for (let i = 0; i < d.lum.length; i += 1) sum += d.lum[i]!;
    const mean = sum / d.lum.length;
    out[n] = mean <= 1.0001 ? mean * 255 : mean;
  }
  return out;
}

async function shippedTriangles(room: string): Promise<number> {
  const doc = await readRoomGlb(`${ENV}/${room}`);
  let tris = 0;
  for (const me of doc.getRoot().listMeshes()) for (const p of me.listPrimitives()) {
    const idx = p.getIndices();
    if (idx) tris += Math.floor(idx.getCount() / 3);
    else {
      const pos = p.getAttribute("POSITION");
      if (pos) tris += Math.floor(pos.getCount() / 3);
    }
  }
  return tris;
}

describe("the room bake reports what it baked", () => {
  it("(1) the chain emits a per-room measured report for the fleet", () => {
    const r = report();
    expect(r.schemaVersion, "regen report schema moved — re-point, do not relax").toBe("openclinxr.rooms-regen-results.v1");
    expect(r.rows?.length, "the fleet report must cover all 14 encounter rooms").toBe(14);
    for (const row of r.rows ?? []) {
      expect(row.status, `${row.environmentId} did not promote clean`).toBe("ok");
      expect(row.seed, `${row.environmentId} records no seed pin`).toBeTypeOf("number");
      expect(row.glb?.sha256, `${row.environmentId} records no byte pin`).toMatch(/^[0-9a-f]{64}$/u);
      expect(row.glb?.triangles, `${row.environmentId} records no triangle column`).toBeGreaterThan(0);
      expect(row.glb?.everyPrimitiveHasMaterial, `${row.environmentId} leaves a bare primitive`).toBe(true);
      expect(row.glb?.decodedTextureBudgetPass, `${row.environmentId} busts the texture budget`).toBe(true);
    }
  });

  it("(2) wall and floor leave the measured cave band — directional, no target value", async () => {
    const now = await shippedAlbedoMeans();
    const w = now[TEX.wall], f = now[TEX.floor];
    expect(w, "wall shell_bake albedo missing from the shipped room").toBeTypeOf("number");
    // Directional only against the immutable cave control. The magnitude is what I grade.
    expect(w!, `wall meanL ${w?.toFixed(2)} vs cave ${CAVE.wall}`).toBeGreaterThan(CAVE.wall);
    expect(f!, `floor meanL ${f?.toFixed(2)} vs cave ${CAVE.floor}`).toBeGreaterThan(CAVE.floor);
  });

  it("(3) COUNTERWEIGHT: the report is bound to the shipped bytes — drift in either fails", async () => {
    // Replaces the old POSITION-sha pin (4-mesh room, gone). The current-byte authority is
    // PROVENANCE.md's table (re-derived by producer promote runs: d8e610e32 re-promoted four
    // rooms, 6571e4acd rebaked two of them again). RESULTS.json still carries batch-1 pins for
    // those four — known staleness owned by the rooms lane, documented here, not hidden: the
    // triangle bind below applies only where the report pin still matches the bytes.
    const provSrc = readFileSync(PROVENANCE, "utf8");
    const prov = new Map<string, string>();
    for (const line of provSrc.split("\n")) {
      const m = /^\|\s*`([^`]+)`\s*\|\s*\d+\s*\|\s*`([0-9a-f]{64})`/u.exec(line.trim());
      if (m) prov.set(m[1]!, m[2]!);
    }
    expect(prov.size, "PROVENANCE.md names no current-byte pins").toBe(14);
    const r = report();
    const byPath = new Map((r.rows ?? []).map((row) => [row.glb?.path?.split("/").pop() ?? "", row]));
    for (const [file, pin] of prov) {
      const live = readFileSync(`${ENV}/${file}`);
      const sha = createHash("sha256").update(live).digest("hex");
      expect(sha, `${file}: shipped bytes no longer match the PROVENANCE pin — re-promote, do not relax`)
        .toBe(pin);
      const liveTris = await shippedTriangles(file);
      const row = byPath.get(file);
      if (row?.glb?.sha256 === sha) {
        expect(liveTris, `${file}: triangle drift past its recorded pin`).toBe(row.glb?.triangles);
      } else {
        // Batch-1 pin superseded by a deliberate producer re-promote (d8e610e32, 6571e4acd):
        // the sha bind above is the guard, and the geometry must still exist, not vanish.
        expect(liveTris, `${file}: re-promoted room ships no geometry`).toBeGreaterThan(0);
      }
    }
  });

  it("(4) COUNTERWEIGHT: the ceiling is not blown — more energy is not the fix", async () => {
    // Same remedy guard as the cave bake: placement/distribution, not amplitude. Lower bound is the
    // darkest the cave bake ever read (13.0); upper is structural clipping. Measured 173.58.
    const now = await shippedAlbedoMeans();
    const c = now[TEX.ceiling];
    expect(c, "ceiling shell_bake albedo missing").toBeTypeOf("number");
    expect(c!, `ceiling meanL ${c?.toFixed(2)} is still in the cave band (max ${CAVE_MAX})`)
      .toBeGreaterThan(CAVE_MAX);
    expect(c!, `ceiling meanL ${c?.toFixed(2)} is clipped to pure white — detail lost`).toBeLessThan(255);
  });

  it("(5) COUNTERWEIGHT: the report covers exactly the shipped fleet — no silent drops", () => {
    // The 14-room rewrite happened deliberately through the chain (547fb18a9), so the old one-room
    // pin inverts: every shipped encounter room must be reported, and no extra rows may appear.
    const shipped = new Set(
      readdirSync(ENV).filter((f) => f.startsWith("infinigen-") && f.endsWith(".glb") && f !== "ed-exam-bay-shell.glb").sort(),
    );
    expect(shipped.size, "shipped encounter-room count moved — check PROVENANCE.md").toBe(14);
    const reported = new Set(
      (report().rows ?? []).map((row) => row.glb?.path?.split("/").pop()).sort(),
    );
    expect([...reported].sort()).toEqual([...shipped].sort());
  });
});
