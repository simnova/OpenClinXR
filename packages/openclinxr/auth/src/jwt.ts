import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthRole, AuthTokenPayload } from "./identity.js";

const JWT_HEADER = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function base64urlDecodeToString(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function hmacSha256(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === "learner" || value === "faculty" || value === "admin";
}

function parsePayload(json: string): AuthTokenPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["sub"] !== "string" || !isAuthRole(record["role"])) {
    return null;
  }
  if (typeof record["iat"] !== "number" || typeof record["exp"] !== "number") {
    return null;
  }
  const payload: AuthTokenPayload = {
    sub: record["sub"],
    role: record["role"],
    iat: record["iat"],
    exp: record["exp"],
  };
  if (typeof record["name"] === "string") {
    payload.name = record["name"];
  }
  return payload;
}

/**
 * Sign an HS256 JWT using only node:crypto (base64url header.payload.signature).
 * Overwrites `iat`/`exp` from current time and `expiresInSeconds` (default 3600).
 */
export function signToken(
  payload: AuthTokenPayload,
  secret: string,
  expiresInSeconds = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const body: AuthTokenPayload = {
    sub: payload.sub,
    role: payload.role,
    iat: now,
    exp: now + expiresInSeconds,
  };
  if (payload.name !== undefined) {
    body.name = payload.name;
  }
  const encodedPayload = base64urlEncode(JSON.stringify(body));
  const signingInput = `${JWT_HEADER}.${encodedPayload}`;
  const signature = base64urlEncode(hmacSha256(secret, signingInput));
  return `${signingInput}.${signature}`;
}

/**
 * Verify HS256 JWT. Returns null on bad signature, malformed token, or expiry.
 */
export function verifyToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }

  let headerJson: string;
  try {
    headerJson = base64urlDecodeToString(headerPart);
  } catch {
    return null;
  }
  let header: unknown;
  try {
    header = JSON.parse(headerJson) as unknown;
  } catch {
    return null;
  }
  if (
    typeof header !== "object"
    || header === null
    || (header as Record<string, unknown>)["alg"] !== "HS256"
  ) {
    return null;
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSig = hmacSha256(secret, signingInput);
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(signaturePart, "base64url");
  } catch {
    return null;
  }
  if (!safeEqualBuffers(expectedSig, providedSig)) {
    return null;
  }

  let payloadJson: string;
  try {
    payloadJson = base64urlDecodeToString(payloadPart);
  } catch {
    return null;
  }
  const payload = parsePayload(payloadJson);
  if (!payload) {
    return null;
  }
  if (payload.exp <= nowSeconds) {
    return null;
  }
  return payload;
}
