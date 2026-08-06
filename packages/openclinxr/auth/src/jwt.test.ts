import { describe, expect, it } from "vitest";
import type { AuthTokenPayload } from "./identity.js";
import { signToken, verifyToken } from "./jwt.js";

const SECRET = "test-secret-jwt";

function samplePayload(overrides: Partial<AuthTokenPayload> = {}): AuthTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user_1",
    role: "learner",
    name: "Test Learner",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

describe("jwt HS256", () => {
  it("roundtrips sign/verify", () => {
    const token = signToken(samplePayload(), SECRET, 3600);
    const verified = verifyToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe("user_1");
    expect(verified?.role).toBe("learner");
    expect(verified?.name).toBe("Test Learner");
    expect(typeof verified?.iat).toBe("number");
    expect(typeof verified?.exp).toBe("number");
    expect(verified!.exp).toBeGreaterThan(verified!.iat);
  });

  it("returns null for tampered signature", () => {
    const token = signToken(samplePayload(), SECRET);
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -4)}aaaa`;
    expect(verifyToken(tampered, SECRET)).toBeNull();
  });

  it("returns null for wrong secret", () => {
    const token = signToken(samplePayload(), SECRET);
    expect(verifyToken(token, "other-secret")).toBeNull();
  });

  it("returns null for expired token", () => {
    const token = signToken(samplePayload(), SECRET, 60);
    const verified = verifyToken(token, SECRET);
    expect(verified).not.toBeNull();
    // Force expiry by checking far in the future
    expect(verifyToken(token, SECRET, verified!.exp + 1)).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyToken("not.a.jwt", SECRET)).toBeNull();
    expect(verifyToken("only-one-part", SECRET)).toBeNull();
    expect(verifyToken("", SECRET)).toBeNull();
  });
});
