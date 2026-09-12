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
 */
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./encounter-bundle-admission.js";

const NIST = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
] as const;

function nodeSha256Hex(input: Uint8Array | string): string {
  return typeof input === "string"
    ? createHash("sha256").update(input, "utf8").digest("hex")
    : createHash("sha256").update(input).digest("hex");
}

describe("sha256Hex matches FIPS 180-4 and node:crypto", () => {
  it("matches the published NIST SHA-256 vectors", () => {
    const mismatches: string[] = [];
    for (const [message, expected] of NIST) {
      const got = sha256Hex(message);
      if (got !== expected) {
        mismatches.push(
          JSON.stringify(message).length > 80
            ? `448-bit message: got ${got} expected ${expected}`
            : `${JSON.stringify(message)}: got ${got} expected ${expected}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("hashes a Uint8Array the same as the equivalent string", () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    expect(sha256Hex(bytes)).toBe(NIST[1][1]);
    expect(sha256Hex(bytes)).toBe(sha256Hex("abc"));
  });

  it("hashes an input longer than one 64-byte block", () => {
    const message = "a".repeat(65);
    expect(message.length).toBeGreaterThan(64);
    expect(sha256Hex(message)).toBe(nodeSha256Hex(message));
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
      const ours = sha256Hex(input);
      const theirs = nodeSha256Hex(input);
      if (ours !== theirs) {
        const label = typeof input === "string" ? JSON.stringify(input).slice(0, 48) : `Uint8Array(${input.length})`;
        mismatches.push(`${label}: sha256Hex=${ours} node:crypto=${theirs}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
