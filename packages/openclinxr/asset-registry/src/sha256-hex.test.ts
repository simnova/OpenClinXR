/**
 * `sha256Hex` is a hand-written FIPS 180-4 implementation claimed byte-identical to
 * `createHash("sha256").update(bytes).digest("hex")`. `verifyCommittedScenePlanAgainstDisk`
 * and the scene-plan freeze compare these digests: a wrong pad, length word, or endianness
 * agrees with itself and silently disagrees with every digest recorded before today.
 *
 * The existing `Client entry reaches no node: builtin` step passed while the page threw
 * because that check walks the asset-registry "." entry and does not walk the
 * `./encounter-bundle-admission` subpath the client actually imports.
 *
 * `node:crypto` here is a Node-side test oracle; the served-client-graph ban does not apply.
 *
 * Route (measured 2026-09-12): `pnpm architecture` with a direct import of the sha256-hex
 * module failed — `test internal imports rose to 2 > ceiling 1`. Proof therefore goes through
 * the public admission function `verifyCommittedScenePlanAgainstDisk` (the
 * `./encounter-bundle-admission` subpath): instance bytes are bound to a digest, and `ok`
 * holds only when `sha256Hex` of those bytes equals that digest. NIST vectors and node:crypto
 * comparisons use that path.
 */
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyCommittedScenePlanAgainstDisk } from "./encounter-bundle-admission.js";

const NIST = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
] as const;

type AdmissionInput = Parameters<typeof verifyCommittedScenePlanAgainstDisk>[0];

const GEOMETRY = {
  floorFrame: null,
  supportInstanceId: "support",
  supportBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
  obstacles: [],
  monitorBounds: null,
  monitorInstanceId: null,
  roomCentre: { x: 0, y: 0, z: 0 },
} as AdmissionInput["geometry"];

const EMPTY = Buffer.alloc(0);

function nodeSha256Hex(input: Uint8Array | string): string {
  return typeof input === "string"
    ? createHash("sha256").update(input, "utf8").digest("hex")
    : createHash("sha256").update(input).digest("hex");
}

function bytesFor(input: Uint8Array | string): Buffer {
  return typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
}

function checkBytesAgainstBoundDigest(bytes: Buffer, boundSha256: string) {
  const record: AdmissionInput["record"] = {
    schemaVersion: "accepted-scene-plan/v1",
    planId: "plan",
    planRevision: "rev",
    durableStore: "database_source_of_truth",
    run: { stationRunId: "run", sessionId: "session", acceptedAtIso: "2026-01-01T00:00:00.000Z" },
    case: {
      caseId: "case",
      caseVersion: 1,
      caseSourceVersion: "v1",
      caseContentSha256: NIST[0][1],
      stationId: "station",
      environmentId: "env",
    },
    bundle: { bundleId: "bundle", bundleSha256: nodeSha256Hex("null") },
    instances: [
      {
        instanceId: "probe",
        kind: "equipment",
        contentId: "probe",
        assetPath: "probe.bin",
        assetSha256: boundSha256,
        byteCount: bytes.length,
      },
    ],
    revisions: {
      solverVersion: "s",
      rigRevision: "r",
      clipRevision: "c",
      geometryRevision: "g",
      rubricVersion: "u",
    },
    variation: { seed: "not-a-digest", variationIndex: 0 },
    resolvedLayout: {
      approachSide: "patient_left",
      standoffMeters: 0.7,
      targetPosition: { x: 0, y: 0, z: 0 },
      targetHeadingRadians: 0,
      floorFrameId: "floor",
      observedObstacleIds: [],
      waypointCount: 0,
      routeLengthMeters: 0,
    },
    arrival: {
      arrivalErrorMeters: 0,
      settledHeadingErrorDegrees: 0,
      stoppedSeconds: 0,
      stoppedRootTravelMeters: 0,
    },
    acknowledgment: {
      acknowledgedBy: "test",
      acknowledgedAtIso: "2026-01-01T00:00:00.000Z",
      acknowledgedPlanRevision: "rev",
    },
    eventOrder: [],
    dialogueTurnIds: [],
  };
  return verifyCommittedScenePlanAgainstDisk({
    record,
    caseSourcePath: "empty.case",
    bundleContent: null,
    geometry: GEOMETRY,
    patientWorldPosition: { x: 0, y: 0, z: 0 },
    start: { x: 0, y: 0, z: 0 },
    readBytes: (path) => {
      if (path === "probe.bin") return bytes;
      if (path === "empty.case") return EMPTY;
      throw new Error(path);
    },
  });
}

describe("sha256Hex matches FIPS 180-4 and node:crypto", () => {
  it("matches the published NIST SHA-256 vectors", () => {
    const mismatches: string[] = [];
    for (const [message, expected] of NIST) {
      const check = checkBytesAgainstBoundDigest(bytesFor(message), expected);
      if (!check.ok) {
        mismatches.push(
          JSON.stringify(message).length > 80
            ? `448-bit message: ${check.problems.join("; ")}`
            : `${JSON.stringify(message)}: ${check.problems.join("; ")}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("hashes a Uint8Array the same as the equivalent string", () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    expect(checkBytesAgainstBoundDigest(Buffer.from(bytes), NIST[1][1]).ok).toBe(true);
    expect(checkBytesAgainstBoundDigest(bytesFor("abc"), NIST[1][1]).ok).toBe(true);
  });

  it("hashes an input longer than one 64-byte block", () => {
    const message = "a".repeat(65);
    expect(message.length).toBeGreaterThan(64);
    expect(checkBytesAgainstBoundDigest(bytesFor(message), nodeSha256Hex(message)).ok).toBe(true);
  });

  it("equals node:crypto createHash('sha256') for several inputs including a random one", () => {
    const random = randomBytes(97);
    const cases: Array<Uint8Array | string> = [
      "",
      "abc",
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "a".repeat(65),
      new Uint8Array([0x00, 0xff, 0x10, 0x80]),
      random,
    ];
    const mismatches: string[] = [];
    for (const input of cases) {
      const check = checkBytesAgainstBoundDigest(bytesFor(input), nodeSha256Hex(input));
      if (!check.ok) {
        const label = typeof input === "string" ? JSON.stringify(input).slice(0, 48) : `Uint8Array(${input.length})`;
        mismatches.push(`${label}: ${check.problems.join("; ")}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
