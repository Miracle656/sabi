// HMAC-signed session cookie for Enoki/Google sign-in. Deliberately minimal:
// no accounts table, no refresh tokens - the cookie IS the session, and losing
// it just means signing in again.
//
// Server-only (imports node:crypto). The signature stops a visitor from editing
// their handle inside the cookie - which matters because the handle becomes the
// by:@handle attribution on findings written to append-only storage.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SabiSession {
  /** Normalized `@handle`, derived from the verified Google email. */
  handle: string;
  email: string;
  /** zkLogin Sui address from Enoki, when ENOKI_API_KEY is configured. */
  address?: string;
  /** Unix seconds when the session was created. */
  iat: number;
}

export const SESSION_COOKIE = "sabi_session";
const SESSION_TTL_S = 60 * 60 * 24 * 7; // 7 days

// A fixed secret keeps sessions across restarts; without one, sessions simply
// die with the process (fine in dev, honest in prod: set SABI_SESSION_SECRET).
const secret: Buffer = process.env.SABI_SESSION_SECRET?.trim()
  ? Buffer.from(process.env.SABI_SESSION_SECRET.trim(), "utf8")
  : randomBytes(32);

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function sealSession(s: SabiSession): string {
  const payload = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function openSession(cookie: string | undefined): SabiSession | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SabiSession;
    if (typeof s.handle !== "string" || typeof s.email !== "string" || typeof s.iat !== "number")
      return null;
    if (Date.now() / 1000 - s.iat > SESSION_TTL_S) return null;
    return s;
  } catch {
    return null;
  }
}
