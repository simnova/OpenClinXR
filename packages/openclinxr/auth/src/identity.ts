export type AuthRole = "learner" | "faculty" | "admin";

export type AuthIdentity = {
  userId: string;
  role: AuthRole;
  displayName?: string;
};

export type AuthTokenPayload = {
  sub: string;
  role: AuthRole;
  name?: string;
  iat: number;
  exp: number;
};

export function identityFromPayload(payload: AuthTokenPayload): AuthIdentity {
  return {
    userId: payload.sub,
    role: payload.role,
    ...(payload.name !== undefined ? { displayName: payload.name } : {}),
  };
}

/** Admin always satisfies; otherwise membership in `allowed`. */
export function hasRole(identity: AuthIdentity, allowed: AuthRole[]): boolean {
  if (identity.role === "admin") {
    return true;
  }
  return allowed.includes(identity.role);
}
