// Verify a Google ID token (RS256 JWT) against Google's published JWKS using
// only node:crypto - no jose dependency. This runs once per sign-in, not per
// request, so the JWKS fetch cost is irrelevant; keys are cached anyway.

import { createPublicKey, verify as cryptoVerify, type JsonWebKey as NodeJwk } from "node:crypto";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function jwks(opts: { refresh?: boolean } = {}): Promise<Jwk[]> {
  const age = jwksCache ? Date.now() - jwksCache.fetchedAt : Infinity;
  // An unknown kid forces a refetch (key rotation) - but never more than once
  // per 5 minutes, or unauthenticated requests carrying random kids become a
  // request amplifier toward Google and a cache-eviction lever.
  const refetch = age > 60 * 60 * 1000 || (opts.refresh === true && age > 5 * 60 * 1000);
  if (jwksCache && !refetch) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

export interface GoogleIdentity {
  email: string;
  name?: string;
  sub: string;
}

function b64json(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * Verifies signature, issuer, audience, expiry and email_verified.
 * Throws with a human-readable reason on any failure.
 */
export async function verifyGoogleIdToken(token: string, audience: string): Promise<GoogleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const header = b64json(parts[0]) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`);
  if (!header.kid) throw new Error("JWT has no kid");

  let key = (await jwks()).find((k) => k.kid === header.kid);
  if (!key) {
    key = (await jwks({ refresh: true })).find((k) => k.kid === header.kid);
  }
  if (!key) throw new Error("signing key not in Google JWKS");

  const pub = createPublicKey({ key: key as unknown as NodeJwk, format: "jwk" });
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
    pub,
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new Error("signature verification failed");

  const claims = b64json(parts[1]) as {
    iss?: string;
    aud?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    sub?: string;
  };
  if (!claims.iss || !ISSUERS.has(claims.iss)) throw new Error(`bad issuer ${claims.iss}`);
  if (claims.aud !== audience) throw new Error("audience mismatch");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error("token expired");
  if (!claims.email || claims.email_verified !== true) throw new Error("email not verified");
  if (!claims.sub) throw new Error("no subject");
  return { email: claims.email, name: claims.name, sub: claims.sub };
}
