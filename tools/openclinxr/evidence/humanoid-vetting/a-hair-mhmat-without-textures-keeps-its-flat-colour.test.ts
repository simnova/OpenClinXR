import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A hair .mhmat WITHOUT texture lines keeps its flat colour (counterweight).
 *
 * The (1) RED contract in a-rebaked-nurse-carries-its-authored-hair-and-scrub-textures
 * requires the fitted hair material to carry the textures its .mhmat declares. The cheap
 * cheat it must not invite is wiring image nodes unconditionally: a textureless .mhmat
 * must still bake to a flat Principled Base Color, not to empty image slots. This runs the
 * EXISTING embed_library_hair.create_material() in headless Blender on a tracked textureless
 * fixture plus the real toigo_blunt_bob (known-good column: declares diffuse + normal).
 *
 * NOT TESTED: fitted placement on a scalp; any GLB bytes; clinical hairstyle realism.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const FIXTURE_DIR = join(HERE, "fixtures/hair-mhmat-no-texture");
const FIXTURE_MHCLO = join(FIXTURE_DIR, "notex_hair.mhclo");
const PROBE = join(FIXTURE_DIR, "probe_hair_material.py");
const BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender";
const HAIR_DIR = join(REPO_ROOT, ".openclinxr-local/provider-cache/hair/sources/makehuman-hair01/extracted/hair/toigo_blunt_bob");

function realBobMhclo(): string {
  expect(existsSync(HAIR_DIR), `hair provider-cache directory missing: ${HAIR_DIR}`).toBe(true);
  const names = readdirSync(HAIR_DIR);
  const mhclo = names.find((n: string) => n.endsWith(".mhclo"));
  expect(mhclo, `no .mhclo in ${HAIR_DIR} (saw: ${names.join(", ")})`).toBeDefined();
  const preferred = join(HAIR_DIR, "toigo_blunt_bob.mhclo");
  return existsSync(preferred) ? preferred : join(HAIR_DIR, mhclo!);
}

type ProbeRow = {
  mhclo: string;
  textures: Record<string, string>;
  imageNodeCount: number;
  baseColorLinked: boolean;
  baseColorDefault: number[];
  wiredMaps: string;
};

function runProbe(): ProbeRow[] {
  const real = realBobMhclo();
  expect(existsSync(FIXTURE_MHCLO), `fixture mhclo missing: ${FIXTURE_MHCLO}`).toBe(true);
  const r = spawnSync(
    BLENDER,
    ["--background", "--factory-startup", "--python-exit-code", "1", "--python", PROBE, "--", FIXTURE_MHCLO, real],
    { encoding: "utf8", timeout: 180_000 },
  );
  expect(r.error, `Blender spawn failed: ${String(r.error)}`).toBeUndefined();
  expect(r.status, `Blender exited ${r.status}: ${r.stderr?.slice(-2000)}`).toBe(0);
  const rows: ProbeRow[] = [];
  for (const line of String(r.stdout).split("\n")) {
    const m = /PROBE_JSON (\{.*\})\s*$/.exec(line);
    if (m) rows.push(JSON.parse(m[1]!) as ProbeRow);
  }
  expect(rows.length, `expected 2 PROBE_JSON lines, got ${rows.length}: ${String(r.stdout).slice(-2000)}`).toBe(2);
  return rows;
}

const blenderMissing = !existsSync(BLENDER);

describe.skipIf(blenderMissing)(
  `a hair .mhmat without textures keeps its flat colour [skipped: Blender missing at ${BLENDER}]`,
  () => {
    it("textureless fixture stays flat: no image nodes, Base Color unlinked at the fallback", () => {
      const rows = runProbe();
      const row = rows.find((x) => x.mhclo === FIXTURE_MHCLO)!;
      expect(row, `no probe row for ${FIXTURE_MHCLO}`).toBeDefined();
      expect(row.textures, "textureless fixture must declare no textures").toEqual({});
      expect(row.imageNodeCount, "textureless fixture must create no image nodes").toBe(0);
      expect(row.baseColorLinked, "textureless fixture Base Color must stay unlinked").toBe(false);
      for (let c = 0; c < 3; c += 1) {
        expect(row.baseColorDefault[c]!, `fixture Base Color channel ${c}`).toBeCloseTo([0.18, 0.13, 0.1][c]!, 4);
      }
    });

    it("known-good: toigo_blunt_bob wires diffuse + normal and links Base Color", () => {
      const rows = runProbe();
      const row = rows.find((x) => x.mhclo !== FIXTURE_MHCLO)!;
      expect(row, "no probe row for the real cache mhclo").toBeDefined();
      // bob_blunt.mhmat also declares specularmapTexture, which create_material() does not
      // wire — so textures CONTAINS diffuse+normal rather than equaling them.
      expect(row.textures["diffuse"], `real mhclo textures: ${JSON.stringify(row.textures)}`).toBeDefined();
      expect(row.textures["normal"], `real mhclo textures: ${JSON.stringify(row.textures)}`).toBeDefined();
      expect(row.imageNodeCount, "real mhclo must create 2 image nodes").toBe(2);
      expect(row.baseColorLinked, "real mhclo Base Color must be linked").toBe(true);
      expect(row.wiredMaps, "real mhclo wired maps").toBe("diffuse,normal");
    });
  },
);
