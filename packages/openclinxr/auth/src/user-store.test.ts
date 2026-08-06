import { describe, expect, it } from "vitest";
import {
  createSeededInMemoryUserStore,
  hashPassword,
  InMemoryUserStore,
  verifyPassword,
} from "./user-store.js";

describe("user-store", () => {
  it("hashPassword + verifyPassword succeed for matching password", () => {
    const { hash, salt } = hashPassword("secret-pass");
    expect(hash.length).toBeGreaterThan(0);
    expect(salt.length).toBe(32);
    expect(verifyPassword("secret-pass", {
      userId: "u1",
      username: "alice",
      role: "learner",
      passwordHash: hash,
      salt,
    })).toBe(true);
  });

  it("verifyPassword fails for wrong password", () => {
    const { hash, salt } = hashPassword("secret-pass");
    expect(verifyPassword("wrong-pass", {
      userId: "u1",
      username: "alice",
      role: "learner",
      passwordHash: hash,
      salt,
    })).toBe(false);
  });

  it("InMemoryUserStore finds seeded users by username", () => {
    const store = new InMemoryUserStore([
      { username: "bob", password: "bob-pass", role: "faculty", userId: "user_bob" },
    ]);
    const found = store.findByUsername("bob");
    expect(found).toBeDefined();
    expect(found?.userId).toBe("user_bob");
    expect(found?.role).toBe("faculty");
    expect(verifyPassword("bob-pass", found!)).toBe(true);
    expect(store.findByUsername("missing")).toBeUndefined();
  });

  it("createSeededInMemoryUserStore provides demo accounts", () => {
    const store = createSeededInMemoryUserStore();
    expect(store.findByUsername("learner_demo")?.role).toBe("learner");
    expect(store.findByUsername("faculty_demo")?.role).toBe("faculty");
    expect(store.findByUsername("admin_demo")?.role).toBe("admin");
    expect(verifyPassword("demo-pass", store.findByUsername("learner_demo")!)).toBe(true);
  });
});
