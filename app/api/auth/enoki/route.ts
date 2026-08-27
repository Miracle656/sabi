// Enoki sign-in. The client obtains a Google ID token (Google Identity
// Services); we verify it server-side against Google's JWKS, ask Enoki for the
// zkLogin Sui address it derives from that JWT, and set an HMAC-signed session
// cookie. From then on, findings this visitor stores are attributed to THEIR
// handle - not the instance operator's.
//
// What this is and is not: the chain still records that the server's delegate
// key wrote the memory. Enoki gives each finding a Google-verified identity
// label (and a Sui address), not a per-user on-chain signature.

import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { normalizeHandle } from "@/lib/env";
import { verifyGoogleIdToken } from "@/lib/google-jwt";
import { SESSION_COOKIE, sealSession, type SabiSession } from "@/lib/session";

const ENOKI_API = "https://api.enoki.mystenlabs.com/v1/zklogin";

/**
 * Handles must be globally unique or attribution is spoofable: ada@gmail.com
 * and ada@attacker.tld would both become "@ada". Gmail local parts are unique
 * within gmail.com, so they keep the short form; every other domain keeps its
 * domain in the handle. Emails are unique, so the result is too.
 */
function deriveHandle(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  return normalizeHandle(gmail ? local : `${local}.${domain}`);
}

async function enokiAddress(jwt: string, apiKey: string): Promise<string | undefined> {
  try {
    const res = await fetch(ENOKI_API, {
      headers: { Authorization: `Bearer ${apiKey}`, "zklogin-jwt": jwt },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: { address?: string } };
    return body.data?.address;
  } catch {
    return undefined;
  }
}

export async function POST(req: Request) {
  const env = getEnv();
  if (!env.googleClientId) {
    return Response.json({ error: "Sign-in is not configured on this instance." }, { status: 503 });
  }
  // Login CSRF: a cross-site form (enctype text/plain) can POST valid JSON and
  // log the victim into the ATTACKER's session, so their findings get the
  // attacker's name. Cross-origin requests and non-JSON bodies are refused.
  const origin = req.headers.get("origin");
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* malformed Origin falls through to the mismatch rejection */
    }
    if (host !== req.headers.get("host")) {
      return Response.json({ error: "cross-origin sign-in refused" }, { status: 403 });
    }
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "content-type must be application/json" }, { status: 415 });
  }

  let credential: string;
  try {
    const body = (await req.json()) as { credential?: string };
    if (!body.credential || typeof body.credential !== "string") throw new Error("no credential");
    credential = body.credential;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(credential, env.googleClientId);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `sign-in rejected: ${why}` }, { status: 401 });
  }

  const address = env.enokiKey ? await enokiAddress(credential, env.enokiKey) : undefined;
  const session: SabiSession = {
    handle: deriveHandle(identity.email),
    email: identity.email,
    address,
    iat: Math.floor(Date.now() / 1000),
  };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(session), {
    httpOnly: true,
    sameSite: "lax",
    // Behind a proxy that drops x-forwarded-proto, req.url reads http: even on
    // an HTTPS site - so key off the build, not the request. Browsers accept
    // Secure cookies on http://localhost, so local `next start` still works.
    secure: process.env.NODE_ENV === "production" || new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return Response.json({ handle: session.handle, email: session.email, address });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
