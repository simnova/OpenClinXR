import { describe, expect, it } from "vitest";
import { hasRole, identityFromPayload, type AuthIdentity, type AuthTokenPayload } from "./identity.js";

describe("identity helpers", () => {
  it("identityFromPayload maps sub/role/name", () => {
    const payload: AuthTokenPayload = {
      sub: "u1",
      role: "faculty",
      name: "Dr. X",
      iat: 1,
      exp: 2,
    };
    expect(identityFromPayload(payload)).toEqual({
      userId: "u1",
      role: "faculty",
      displayName: "Dr. X",
    });
  });

  it("hasRole: admin passes any allowed list", () => {
    const admin: AuthIdentity = { userId: "a", role: "admin" };
    expect(hasRole(admin, ["learner"])).toBe(true);
    expect(hasRole(admin, ["faculty", "admin"])).toBe(true);
    expect(hasRole(admin, [])).toBe(true);
  });

  it("hasRole: learner only its own membership", () => {
    const learner: AuthIdentity = { userId: "l", role: "learner" };
    expect(hasRole(learner, ["learner"])).toBe(true);
    expect(hasRole(learner, ["faculty", "admin"])).toBe(false);
    expect(hasRole(learner, ["faculty"])).toBe(false);
  });

  it("hasRole: faculty membership", () => {
    const faculty: AuthIdentity = { userId: "f", role: "faculty" };
    expect(hasRole(faculty, ["faculty", "admin"])).toBe(true);
    expect(hasRole(faculty, ["learner"])).toBe(false);
    expect(hasRole(faculty, ["faculty"])).toBe(true);
  });
});
