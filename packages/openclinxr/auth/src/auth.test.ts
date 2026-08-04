import { describe, expect, it } from "vitest";
import {
  AUTH_CLAIM_BOUNDARY,
  AUTH_NOT_EVIDENCE_FOR,
  canReadStationRun,
  DEFAULT_DEV_AUTH_IDENTITY,
  DEFAULT_DEV_AUTH_SECRET,
  hasFacultyAccess,
  parseBearerAuthorization,
  resolveSessionLearnerId,
  signAuthToken,
  verifyAuthToken,
} from "./index.js";

describe("@openclinxr/auth HMAC-JWT", () => {
  it("signs and verifies learner identity claims", () => {
    const token = signAuthToken({
      secret: DEFAULT_DEV_AUTH_SECRET,
      identity: { subject: "learner_a", role: "learner", learnerId: "learner_a" },
    });

    const result = verifyAuthToken({ token, secret: DEFAULT_DEV_AUTH_SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity).toEqual({
      subject: "learner_a",
      role: "learner",
      learnerId: "learner_a",
    });
  });

  it("rejects tampered tokens and wrong secrets", () => {
    const token = signAuthToken({
      secret: DEFAULT_DEV_AUTH_SECRET,
      identity: { subject: "faculty_1", role: "faculty" },
    });

    expect(verifyAuthToken({ token: `${token}x`, secret: DEFAULT_DEV_AUTH_SECRET }).ok).toBe(false);
    expect(verifyAuthToken({ token, secret: "other-secret" }).ok).toBe(false);
    expect(verifyAuthToken({ token: "not.a.jwt", secret: DEFAULT_DEV_AUTH_SECRET })).toEqual({
      ok: false,
      error: "invalid_token",
    });
  });

  it("rejects expired tokens", () => {
    const token = signAuthToken({
      secret: DEFAULT_DEV_AUTH_SECRET,
      identity: { subject: "learner_a", role: "learner", learnerId: "learner_a" },
      issuedAt: 1_700_000_000,
      expiresInSeconds: 60,
    });

    expect(
      verifyAuthToken({
        token,
        secret: DEFAULT_DEV_AUTH_SECRET,
        now: 1_700_000_000 + 120,
        clockToleranceSeconds: 0,
      }),
    ).toEqual({ ok: false, error: "token_expired" });
  });

  it("parses bearer headers and enforces role/ownership helpers", () => {
    expect(parseBearerAuthorization("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(parseBearerAuthorization("Basic nope")).toBeUndefined();
    expect(hasFacultyAccess({ subject: "f1", role: "faculty" })).toBe(true);
    expect(hasFacultyAccess({ subject: "a1", role: "admin" })).toBe(true);
    expect(hasFacultyAccess({ subject: "l1", role: "learner", learnerId: "l1" })).toBe(false);

    expect(canReadStationRun({ subject: "l1", role: "learner", learnerId: "l1" }, "l1")).toBe(true);
    expect(canReadStationRun({ subject: "l1", role: "learner", learnerId: "l1" }, "l2")).toBe(false);
    expect(canReadStationRun({ subject: "f1", role: "faculty" }, "l2")).toBe(true);

    expect(resolveSessionLearnerId({ subject: "l1", role: "learner", learnerId: "l1" }, "other")).toBe("l1");
    expect(resolveSessionLearnerId({ subject: "f1", role: "faculty" }, "learner_from_body")).toBe("learner_from_body");
    expect(resolveSessionLearnerId({ subject: "f1", role: "faculty" }, "   ")).toBe("   ");
    expect(resolveSessionLearnerId(DEFAULT_DEV_AUTH_IDENTITY)).toBe("learner_001");
  });

  it("keeps claim boundary conservative", () => {
    expect(AUTH_CLAIM_BOUNDARY).toBe("local_hmac_jwt_not_production_identity_provider");
    expect(AUTH_NOT_EVIDENCE_FOR).toContain("production_identity_provider");
    expect(DEFAULT_DEV_AUTH_IDENTITY.role).toBe("admin");
  });
});
