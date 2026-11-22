/**
 * Geometric lip-rounding gate (lip-rounding-geometric-gate card, aisha-parity).
 *
 * Headless replacement for the pixel fissure instrument: lateral-10 mouth
 * narrowing O/U vs E, driver on vs off, on all 4 GLBs. Known-good is the
 * s1/rig probe (store lip-rounding/s1/rig/rig-probe.json).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIP_ROUNDING_TABLE } from "@openclinxr/xr-dialogue/package-viseme";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHeadlessScene, type HeadlessScene } from "./headless-scene.js";
import {
  assertPositiveSpan,
  narrowPct,
  pickLateral10,
  roundingGatePasses,
  widthMm,
  type Lateral10,
} from "./lip-rounding-extent.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const ASSETS = [
  "mpfb-peds-parent-aisha",
  "mpfb-ob-patient-aisha",
  "mpfb-peds-nurse-kevin",
  "mpfb-clinical-physician-adult",
] as const;

const scenes = new Map<string, HeadlessScene>();
const laterals = new Map<string, Lateral10>();

beforeAll(async () => {
  for (const asset of ASSETS) {
    const scene = await loadHeadlessScene(
      join(REPO_ROOT, `apps/ui-xr/public/generated-humanoids/${asset}.glb`),
    );
    scenes.set(asset, scene);
    laterals.set(asset, pickLateral10(scene));
  }
}, 120_000);

function setup(asset: string): { scene: HeadlessScene; lateral: Lateral10 } {
  const scene = scenes.get(asset);
  const lateral = laterals.get(asset);
  expect(scene, `no scene for ${asset}`).toBeDefined();
  expect(lateral, `no lateral10 for ${asset}`).toBeDefined();
  return { scene: scene!, lateral: lateral! };
}

describe("lip rounding geometric gate", () => {
  it("GATE narrowPct O and U >= 15 driver ON, all 4", () => {
    // source: 15% = lip-rounding gate of tsk_9a976f35c41a0f94 (cap54); known-good O 22.8-25.2 U 20.7-24.2 (store s1/rig/rig-probe.json sha 226a7df3)
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      const o = narrowPct(scene, lateral, "O", "on");
      const u = narrowPct(scene, lateral, "U", "on");
      expect(roundingGatePasses(o, u), `${asset} O ${o.toFixed(2)} U ${u.toFixed(2)}`).toBe(true);
    }
  }, 120_000);

  it("CW-OFF narrowPct O and U < 15 driver OFF, all 4", () => {
    // source: same 15%; today 9.8-13.4 (rig-probe.json); proves the driver carries the narrowing. A BUILD that rounds the base morph amends this with the coordinator; never delete.
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      expect(narrowPct(scene, lateral, "O", "off"), `${asset} O narrowPct off`).toBeLessThan(15);
      expect(narrowPct(scene, lateral, "U", "off"), `${asset} U narrowPct off`).toBeLessThan(15);
    }
  }, 120_000);

  it("CW-E |width(E,on) - width(E,off)| <= 0.01 mm, all 4", () => {
    // source: driver adds 0 at E (old card CW-b); measured 0.00 mm.
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      const on = widthMm(scene, lateral, "E", "on");
      const off = widthMm(scene, lateral, "E", "off");
      expect(Math.abs(on - off), `${asset} E width on vs off`).toBeLessThanOrEqual(0.01);
    }
  }, 120_000);

  it("CW-Z with a zeroed table, the GATE predicate is false on all 4", () => {
    const zeroed = LIP_ROUNDING_TABLE.map((row) => ({ ...row, fullMm: 0 }));
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      const o = narrowPct(scene, lateral, "O", "on", zeroed);
      const u = narrowPct(scene, lateral, "U", "on", zeroed);
      expect(Number.isFinite(o) && Number.isFinite(u), `${asset} zeroed narrowPct finite`).toBe(true);
      const gate = roundingGatePasses(o, u);
      if (asset === "mpfb-peds-nurse-kevin") {
        const on = narrowPct(scene, lateral, "U", "on");
        // eslint-disable-next-line no-console
        console.log(`CW-Z kevin U narrowPct on=${on.toFixed(2)} zeroed=${u.toFixed(2)}`);
      }
      expect(gate, `${asset} GATE predicate with zeroed table (O ${o.toFixed(2)}, U ${u.toFixed(2)})`).toBe(
        false,
      );
    }
  }, 120_000);
  it("CW-X widthMm refuses a non-positive span", () => {
    // source: C1 crossed-corner probe (kevin U -21.69 mm -> 152.82%); assertPositiveSpan is the F1 bar.
    expect(() => assertPositiveSpan(-21.69)).toThrow("not a positive finite width");
    expect(() => assertPositiveSpan(0)).toThrow("not a positive finite width");
    expect(assertPositiveSpan(46.6)).toBe(46.6);
  });
});
