import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStationEnvironment } from "../../../packages/openclinxr/xr-station/src/station-environment";
import { searchClinicalLayouts } from "./layout-search";
import { sitContact } from "./contact-solvers";
import type { CachedSceneSnapshot } from "./staging-types";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const pedsPath = resolve(root, ".openclinxr/staging-solver/peds_fever_v1/scene-snapshot.json");

function loadSnapshot(path: string): CachedSceneSnapshot {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as unknown as CachedSceneSnapshot;
}

type Vec3 = { x: number; y: number; z: number };
type Box3 = { min: Vec3; max: Vec3 };
type SeatLike = { name: string; box: Box3; slotId: string };

function vec(record: unknown): Vec3 {
  const r = record as Record<string, unknown>;
  return {
    x: Number(r["x"]),
    y: Number(r["y"]),
    z: Number(r["z"]),
  };
}

function boxOf(record: unknown): Box3 {
  const r = record as Record<string, unknown>;
  return { min: vec(r["min"]), max: vec(r["max"]) };
}

function centerOf(box: Box3): Vec3 {
  return {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
}

function supportBoxes(snapshot: CachedSceneSnapshot): Box3[] {
  const rootRecord = snapshot as unknown as Record<string, unknown>;
  const out: Box3[] = [];
  const pushValue = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const entry of value) pushValue(entry);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ("box" in record && "slotId" in record) {
        out.push(boxOf(record["box"]));
      }
      for (const key of Object.keys(record)) pushValue(record[key]);
    }
  };
  pushValue(rootRecord);
  return out;
}

function frameForSnapshot(snapshot: CachedSceneSnapshot): {
  frame: unknown;
  anchor: Vec3;
  seatCenter: Vec3;
} {
  const boxes = supportBoxes(snapshot);
  let largest = boxes[0];
  let largestArea = -1;
  for (const box of boxes) {
    const area = Math.abs(box.max.x - box.min.x) * Math.abs(box.max.z - box.min.z);
    if (area > largestArea) {
      largestArea = area;
      largest = box;
    }
  }
  const head: Vec3 = { x: largest.min.x, y: largest.max.y, z: largest.min.z };
  const foot: Vec3 = { x: largest.max.x, y: largest.max.y, z: largest.max.z };
  const long = { x: foot.x - head.x, y: 0, z: foot.z - head.z };
  const len = Math.hypot(long.x, long.z) || 1;
  const longN = { x: long.x / len, y: 0, z: long.z / len };
  const side = { x: -longN.z, y: 0, z: longN.x };
  // Nurse anchor uses head + long * -0.35 + side * -0.62 from the largest patient support.
  const anchor: Vec3 = {
    x: head.x + longN.x * -0.35 + side.x * -0.62,
    y: head.y,
    z: head.z + longN.z * -0.35 + side.z * -0.62,
  };
  const seatCenter: Vec3 = { x: -0.55, y: 0.425, z: -0.75 };
  const frame = {
    nurseAnchor: anchor,
    head,
    foot,
    long: longN,
    side,
  };
  return { frame, anchor, seatCenter };
}

function collectDescendants(group: unknown, out: Record<string, unknown>[]): void {
  if (group === null || group === undefined) return;
  if (Array.isArray(group)) {
    for (const entry of group) collectDescendants(entry, out);
    return;
  }
  if (typeof group === "object") {
    const record = group as Record<string, unknown>;
    out.push(record);
    const children = record["children"];
    if (Array.isArray(children)) {
      for (const child of children) collectDescendants(child, out);
    }
  }
}

describe("fever family chair", () => {
  it("built shell exposes family_chair with seatHeightMeters", () => {
    const env = buildStationEnvironment({
      descriptorId: "pediatric_fever_urgent_care_bay_v1",
    } as unknown as Parameters<typeof buildStationEnvironment>[0]);
    const group = (env as unknown as Record<string, unknown>)["group"] ?? env;
    const nodes: Record<string, unknown>[] = [];
    collectDescendants(group, nodes);
    const chairs = nodes.filter((n) => {
      const userData = n["userData"] as Record<string, unknown> | undefined;
      return userData !== undefined && userData["fixtureSlotId"] === "family_chair";
    });
    expect(chairs.length).toBeGreaterThan(0);
    const chair = chairs[0];
    const userData = chair["userData"] as Record<string, unknown>;
    expect(typeof userData["seatHeightMeters"]).toBe("number");
    const position = chair["position"] as Record<string, unknown>;
    expect(Number(position["x"])).toBeCloseTo(-0.55, 2);
    expect(Number(position["z"])).toBeCloseTo(-0.75, 2);
  });

  it("cached fever stays red while copy plus seat resolves sitContact", () => {
    const snapshot = loadSnapshot(pedsPath);
    const result = searchClinicalLayouts(snapshot);
    const resultRecord = result as unknown as Record<string, unknown>;
    const layouts = resultRecord["layouts"] as unknown[];
    expect(layouts).toHaveLength(0);
    const binding = String(resultRecord["bindingConstraint"] ?? resultRecord["binding"] ?? "");
    expect(binding).toContain("parent_mei_chen_v1");
    expect(binding).toContain("companion_chair");

    const baseContacts = sitContact(
      "parent_mei_chen_v1",
      snapshot,
      frameForSnapshot(snapshot).frame as never,
    );
    expect(baseContacts).toHaveLength(0);

    const built = buildStationEnvironment({
      descriptorId: "pediatric_fever_urgent_care_bay_v1",
    } as unknown as Parameters<typeof buildStationEnvironment>[0]);
    const group = (built as unknown as Record<string, unknown>)["group"] ?? built;
    const nodes: Record<string, unknown>[] = [];
    collectDescendants(group, nodes);
    const chairNode = nodes.find((n) => {
      const userData = n["userData"] as Record<string, unknown> | undefined;
      return userData !== undefined && userData["fixtureSlotId"] === "family_chair";
    }) as Record<string, unknown>;
    const chairPos = chairNode["position"] as Record<string, unknown>;
    const cx = Number(chairPos["x"]);
    const cz = Number(chairPos["z"]);

    const seat: SeatLike = {
      name: "openclinxr.station-environment.fixture-slot.family_chair.seat",
      slotId: "companion_chair",
      box: {
        min: { x: cx - 0.24, y: 0.4, z: cz - 0.24 },
        max: { x: cx + 0.24, y: 0.45, z: cz + 0.24 },
      },
    };

    const snapshotCopy = JSON.parse(JSON.stringify(snapshot)) as unknown as Record<
      string,
      unknown
    >;
    const seats: unknown[] = [];
    const gatherSeats = (value: unknown): void => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (const entry of value) gatherSeats(entry);
        return;
      }
      if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (Array.isArray(record["companionSeats"])) {
          for (const entry of record["companionSeats"] as unknown[]) seats.push(entry);
        }
        if (Array.isArray(record["seats"])) {
          for (const entry of record["seats"] as unknown[]) seats.push(entry);
        }
        for (const key of Object.keys(record)) gatherSeats(record[key]);
      }
    };
    gatherSeats(snapshotCopy);
    seats.push(seat);

    const merged = snapshotCopy as unknown as CachedSceneSnapshot;
    const mergedRecord = merged as unknown as Record<string, unknown>;
    mergedRecord["companionSeats"] = seats;

    const { frame, anchor, seatCenter } = frameForSnapshot(snapshot);
    void seatCenter;
    const contacts = sitContact("parent_mei_chen_v1", merged, frame as never);
    const list = contacts as unknown as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(String(first["slotId"])).toContain("companion_chair");
    const plant = first["plant"] as Record<string, unknown>;
    expect(Number(plant["y"])).toBeCloseTo(0, 5);

    const seatBox = seat.box;
    const center: Vec3 = {
      x: (seatBox.min.x + seatBox.max.x) / 2,
      y: (seatBox.min.y + seatBox.max.y) / 2,
      z: (seatBox.min.z + seatBox.max.z) / 2,
    };
    void anchor;
    const probe = frameForSnapshot(snapshot);
    const gap = Math.hypot(center.x - probe.anchor.x, center.z - probe.anchor.z);
    expect(gap).toBeGreaterThanOrEqual(1.2);
    expect(centerOf(seatBox).x).toBeCloseTo(cx, 5);
  });

  it("adult layout keeps physician_bedside at eye height", () => {
    const adultPath = resolve(
      root,
      ".openclinxr/staging-solver/adult_abdominal_pain_v1/scene-snapshot.json",
    );
    const snapshot = loadSnapshot(adultPath);
    const result = searchClinicalLayouts(snapshot);
    const resultRecord = result as unknown as Record<string, unknown>;
    const layouts = resultRecord["layouts"] as unknown[];
    expect(layouts.length).toBeGreaterThan(0);
    const dumped = JSON.stringify(result);
    expect(dumped).toContain("physician_bedside");
    const eyeValues: number[] = [];
    const scan = (value: unknown): void => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (const entry of value) scan(entry);
        return;
      }
      if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (record["slotId"] === "physician_bedside" || record["id"] === "physician_bedside") {
          const plant = record["plant"] as Record<string, unknown> | undefined;
          if (plant !== undefined && plant["y"] !== undefined) eyeValues.push(Number(plant["y"]));
          const position = record["position"] as Record<string, unknown> | undefined;
          if (position !== undefined && position["y"] !== undefined)
            eyeValues.push(Number(position["y"]));
        }
        for (const key of Object.keys(record)) scan(record[key]);
      }
    };
    scan(result);
    expect(eyeValues.length).toBeGreaterThan(0);
    for (const y of eyeValues) expect(y).toBeCloseTo(1.7, 2);
  });
});
