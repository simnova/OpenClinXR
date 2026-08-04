import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthIdentity, AuthRole, SignTokenInput, VerifyTokenInput, VerifyTokenResult } from "./types.js";

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;
const DEFAULT_EXPIRES_IN_SECONDS = 8 * 60 * 60;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

type JwtPayload = {
  sub: string;
  role: AuthRole;
  learnerId?: string;
  iat: number;
  exp: number;
};

/**
 * Sign a compact HMAC-SHA256 JWT (hand-rolled via node:crypto; no paid/AGPL deps).
 */
export function signAuthToken(input: SignTokenInput): string {
  const secret = requireNonEmptySecret(input.secret);
  const identity = normalizeIdentity(input.identity);
  const iat = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const exp = iat + (input.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS);

  const payload: JwtPayload = {
    sub: identity.subject,
    role: identity.role,
    iat,
    exp,
    ...(identity.learnerId ? { learnerId: identity.learnerId } : {}),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(JWT_HEADER));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = hmacSha256Base64Url(signingInput, secret);
  return `${signingInput}.${signature}`;
}

/**
 * Verify compact HMAC-SHA256 JWT and extract identity claims.
 */
export function verifyAuthToken(input: VerifyTokenInput): VerifyTokenResult {
  const secret = requireNonEmptySecret(input.secret);
  const parts = input.token.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "invalid_token" };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return { ok: false, error: "invalid_token" };
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = hmacSha256Base64Url(signingInput, secret);
  if (!safeEqualBase64Url(encodedSignature, expected)) {
    return { ok: false, error: "invalid_token" };
  }

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(base64UrlDecodeToString(encodedHeader));
    payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
  } catch {
    return { ok: false, error: "invalid_token" };
  }

  if (!isRecord(header) || header["alg"] !== "HS256" || header["typ"] !== "JWT") {
    return { ok: false, error: "invalid_token" };
  }
  if (!isRecord(payload)) {
    return { ok: false, error: "invalid_claims" };
  }

  const sub = payload["sub"];
  const role = payload["role"];
  const iat = payload["iat"];
  const exp = payload["exp"];
  const learnerId = payload["learnerId"];

  if (typeof sub !== "string" || sub.trim().length === 0) {
    return { ok: false, error: "invalid_claims" };
  }
  if (!isAuthRole(role)) {
    return { ok: false, error: "invalid_claims" };
  }
  if (typeof iat !== "number" || !Number.isFinite(iat)) {
    return { ok: false, error: "invalid_claims" };
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return { ok: false, error: "invalid_claims" };
  }
  if (learnerId !== undefined && (typeof learnerId !== "string" || learnerId.trim().length === 0)) {
    return { ok: false, error: "invalid_claims" };
  }
  if (role === "learner" && (typeof learnerId !== "string" || learnerId.trim().length === 0)) {
    return { ok: false, error: "invalid_claims" };
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const skew = input.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (now > exp + skew) {
    return { ok: false, error: "token_expired" };
  }

  const identity: AuthIdentity = {
    subject: sub,
    role,
    ...(typeof learnerId === "string" ? { learnerId } : role === "learner" ? { learnerId: sub } : {}),
  };

  return { ok: true, identity, expiresAt: exp };
}

export function parseBearerAuthorization(headerValue: string | undefined | null): string | undefined {
  if (typeof headerValue !== "string") {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(headerValue.trim());
  return match?.[1];
}

export function hasFacultyAccess(identity: AuthIdentity): boolean {
  return identity.role === "faculty" || identity.role === "admin";
}

export function resolveSessionLearnerId(identity: AuthIdentity, bodyLearnerId?: string): string {
  if (identity.role === "learner") {
    const fromIdentity = identity.learnerId?.trim() || identity.subject.trim();
    return fromIdentity;
  }
  // Faculty/admin: honor explicit body learnerId (including whitespace) so API can 400 on empty.
  if (bodyLearnerId !== undefined) {
    return bodyLearnerId;
  }
  const fromIdentity = identity.learnerId?.trim();
  if (fromIdentity && fromIdentity.length > 0) {
    return fromIdentity;
  }
  return "learner_001";
}

export function canReadStationRun(identity: AuthIdentity, ownerLearnerId: string): boolean {
  if (hasFacultyAccess(identity)) {
    return true;
  }
  const learnerId = identity.learnerId?.trim() || identity.subject.trim();
  return learnerId === ownerLearnerId;
}

function normalizeIdentity(identity: AuthIdentity): AuthIdentity {
  const subject = identity.subject.trim();
  if (subject.length === 0) {
    throw new Error("auth_identity_subject_required");
  }
  if (!isAuthRole(identity.role)) {
    throw new Error("auth_identity_role_invalid");
  }
  const learnerId = identity.learnerId?.trim();
  if (identity.role === "learner" && (!learnerId || learnerId.length === 0)) {
    throw new Error("auth_identity_learner_id_required");
  }
  return {
    subject,
    role: identity.role,
    ...(learnerId ? { learnerId } : {}),
  };
}

function requireNonEmptySecret(secret: string): string {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("auth_secret_required");
  }
  return secret;
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === "learner" || value === "faculty" || value === "admin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hmacSha256Base64Url(signingInput: string, secret: string): string {
  return createHmac("sha256", secret).update(signingInput, "utf8").digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecodeToString(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqualBase64Url(left: string, right: string): boolean {
  try {
    const leftBuf = Buffer.from(left, "base64url");
    const rightBuf = Buffer.from(right, "base64url");
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  } catch {
    return false;
  }
}

/** Internal helper namespace so tree-shakers keep timingSafeEqual path. */
const safe = { equalBase64Url: safeEqualBase64Url };
