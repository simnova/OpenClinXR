import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthRole } from "./identity.js";

export type UserRecord = {
  userId: string;
  username: string;
  role: AuthRole;
  passwordHash: string;
  salt: string;
};

export type CreateUserInput = {
  username: string;
  password: string;
  role: AuthRole;
  userId?: string;
};

export type SeedUserInput = {
  username: string;
  password: string;
  role: AuthRole;
  userId?: string;
};

export interface UserStore {
  findByUsername(username: string): Promise<UserRecord | undefined> | UserRecord | undefined;
  createUser(input: CreateUserInput): Promise<UserRecord> | UserRecord;
}

const SCRYPT_KEYLEN = 64;

/** Hash a password with scrypt (Node built-in). Salt defaults to 16 random bytes hex. */
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const resolvedSalt = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, resolvedSalt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt: resolvedSalt };
}

/** Timing-safe password verification against a stored user record. */
export function verifyPassword(password: string, record: UserRecord): boolean {
  const { hash } = hashPassword(password, record.salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(record.passwordHash, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Dev-only in-memory credential store. Not for production identity systems. */
export class InMemoryUserStore implements UserStore {
  private readonly byUsername = new Map<string, UserRecord>();

  constructor(seedUsers: SeedUserInput[] = []) {
    for (const seed of seedUsers) {
      this.createUser(seed);
    }
  }

  findByUsername(username: string): UserRecord | undefined {
    return this.byUsername.get(username);
  }

  createUser(input: CreateUserInput): UserRecord {
    const { hash, salt } = hashPassword(input.password);
    const record: UserRecord = {
      userId: input.userId ?? `user_${input.username}`,
      username: input.username,
      role: input.role,
      passwordHash: hash,
      salt,
    };
    this.byUsername.set(input.username, record);
    return record;
  }
}

/**
 * Create a seeded in-memory store for local/dev demos only.
 * Default users: learner_demo, faculty_demo, admin_demo (password from arg or "demo-pass").
 */
export function createSeededInMemoryUserStore(secretUsersEnv?: string): InMemoryUserStore {
  const password = secretUsersEnv && secretUsersEnv.length > 0 ? secretUsersEnv : "demo-pass";
  return new InMemoryUserStore([
    { username: "learner_demo", password, role: "learner", userId: "user_learner_demo" },
    { username: "faculty_demo", password, role: "faculty", userId: "user_faculty_demo" },
    { username: "admin_demo", password, role: "admin", userId: "user_admin_demo" },
  ]);
}
