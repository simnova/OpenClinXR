import { identityFromPayload, type AuthIdentity, type AuthRole, type AuthTokenPayload } from "./identity.js";
import { signToken, verifyToken } from "./jwt.js";
import type { UserStore } from "./user-store.js";
import { verifyPassword } from "./user-store.js";

export type AuthConfig = {
  enabled: boolean;
  secret: string;
  devDefaultIdentity?: AuthIdentity | null;
};

export const DEFAULT_DEV_ADMIN_IDENTITY: AuthIdentity = {
  userId: "dev_admin",
  role: "admin",
  displayName: "Dev Admin",
};

/**
 * Authenticate an HTTP Authorization header against local JWT identity.
 * When auth is disabled, returns the configured (or default) dev identity so
 * existing single-user / deterministic flows keep working.
 */
export function authenticateAuthorizationHeader(
  authHeader: string | null | undefined,
  config: AuthConfig,
  nowSeconds?: number,
): { identity: AuthIdentity | null; status: 200 | 401 } {
  if (!config.enabled) {
    const identity = config.devDefaultIdentity === undefined
      ? DEFAULT_DEV_ADMIN_IDENTITY
      : config.devDefaultIdentity;
    return { identity, status: 200 };
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { identity: null, status: 401 };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (token.length === 0) {
    return { identity: null, status: 401 };
  }

  const payload = verifyToken(token, config.secret, nowSeconds);
  if (!payload) {
    return { identity: null, status: 401 };
  }
  return { identity: identityFromPayload(payload), status: 200 };
}

/**
 * Verify credentials against a UserStore and issue a signed JWT on success.
 */
export async function loginForToken(
  store: UserStore,
  username: string,
  password: string,
  secret: string,
  expiresInSeconds?: number,
): Promise<{ token: string; identity: AuthIdentity } | null> {
  const record = await Promise.resolve(store.findByUsername(username));
  if (!record || !verifyPassword(password, record)) {
    return null;
  }

  const payload: AuthTokenPayload = {
    sub: record.userId,
    role: record.role as AuthRole,
    iat: 0,
    exp: 0,
  };
  const token = signToken(payload, secret, expiresInSeconds);
  const identity: AuthIdentity = {
    userId: record.userId,
    role: record.role,
    displayName: record.username,
  };
  return { token, identity };
}
