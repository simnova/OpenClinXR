import { describe, expect, it } from "vitest";
import {
  authenticateAuthorizationHeader,
  DEFAULT_DEV_ADMIN_IDENTITY,
  loginForToken,
} from "./authenticate.js";
import type { AuthTokenPayload } from "./identity.js";
import { signToken } from "./jwt.js";
import { InMemoryUserStore } from "./user-store.js";

const SECRET = "auth-test-secret";

describe("authenticateAuthorizationHeader", () => {
  it("enabled: no header -> 401", () => {
    const result = authenticateAuthorizationHeader(undefined, { enabled: true, secret: SECRET });
    expect(result.status).toBe(401);
    expect(result.identity).toBeNull();
  });

  it("enabled: valid token -> identity 200", () => {
    const payload: AuthTokenPayload = {
      sub: "learner_a",
      role: "learner",
      name: "Learner A",
      iat: 0,
      exp: 0,
    };
    const token = signToken(payload, SECRET, 3600);
    const result = authenticateAuthorizationHeader(`Bearer ${token}`, {
      enabled: true,
      secret: SECRET,
    });
    expect(result.status).toBe(200);
    expect(result.identity).toEqual({
      userId: "learner_a",
      role: "learner",
      displayName: "Learner A",
    });
  });

  it("enabled: invalid token -> 401", () => {
    const result = authenticateAuthorizationHeader("Bearer not-valid", {
      enabled: true,
      secret: SECRET,
    });
    expect(result.status).toBe(401);
    expect(result.identity).toBeNull();
  });

  it("disabled: returns dev admin identity", () => {
    const result = authenticateAuthorizationHeader(undefined, {
      enabled: false,
      secret: SECRET,
    });
    expect(result.status).toBe(200);
    expect(result.identity).toEqual(DEFAULT_DEV_ADMIN_IDENTITY);
  });

  it("disabled: respects custom devDefaultIdentity", () => {
    const custom = { userId: "dev_faculty", role: "faculty" as const, displayName: "Dev Faculty" };
    const result = authenticateAuthorizationHeader(null, {
      enabled: false,
      secret: SECRET,
      devDefaultIdentity: custom,
    });
    expect(result.identity).toEqual(custom);
  });
});

describe("loginForToken", () => {
  it("issues token for valid credentials", async () => {
    const store = new InMemoryUserStore([
      { username: "alice", password: "alice-pass", role: "learner", userId: "user_alice" },
    ]);
    const result = await loginForToken(store, "alice", "alice-pass", SECRET);
    expect(result).not.toBeNull();
    expect(result!.identity.userId).toBe("user_alice");
    expect(result!.token.split(".")).toHaveLength(3);
  });

  it("returns null for bad password", async () => {
    const store = new InMemoryUserStore([
      { username: "alice", password: "alice-pass", role: "learner" },
    ]);
    expect(await loginForToken(store, "alice", "wrong", SECRET)).toBeNull();
  });
});
