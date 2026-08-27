// The session cookie is what stands between a visitor and writing findings
// under someone else's name, so its failure modes get tests: tampering,
// truncation, expiry, and garbage must all read as "not signed in" - never as
// a throw, and never as a session.

import { strict as assert } from "node:assert";
import test from "node:test";

process.env.SABI_SESSION_SECRET = "test-secret-for-deterministic-hmac";
const { sealSession, openSession } = await import("./session");

const base = { handle: "@ada", email: "ada@example.com", iat: Math.floor(Date.now() / 1000) };

test("seal → open round-trips a session", () => {
  const s = openSession(sealSession({ ...base, address: "0xabc" }));
  assert.ok(s);
  assert.equal(s.handle, "@ada");
  assert.equal(s.email, "ada@example.com");
  assert.equal(s.address, "0xabc");
});

test("a tampered payload is rejected", () => {
  const cookie = sealSession(base);
  const [payload, mac] = [cookie.slice(0, cookie.lastIndexOf(".")), cookie.slice(cookie.lastIndexOf(".") + 1)];
  // Forge a different handle but keep the original MAC.
  const forged = Buffer.from(JSON.stringify({ ...base, handle: "@judge" }), "utf8").toString("base64url");
  assert.equal(openSession(`${forged}.${mac}`), null);
  // And a MAC of the wrong length.
  assert.equal(openSession(`${payload}.${mac.slice(0, -2)}`), null);
});

test("expired sessions read as signed out", () => {
  const old = sealSession({ ...base, iat: Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60 });
  assert.equal(openSession(old), null);
});

test("garbage never throws", () => {
  for (const junk of [undefined, "", ".", "a.b", "!!!.???", "e30.", `${"x".repeat(5000)}.y`]) {
    assert.equal(openSession(junk as string | undefined), null);
  }
});

test("a payload missing required fields is rejected even when correctly signed", () => {
  const cookie = sealSession({ handle: "@x", email: "x@y.z", iat: base.iat });
  // Re-sign is impossible from outside; simulate an internal bug instead:
  // sealSession of a malformed object should still be refused by openSession.
  const bad = sealSession({ handle: 123 as unknown as string, email: "x@y.z", iat: base.iat });
  assert.equal(openSession(bad), null);
  assert.ok(openSession(cookie));
});
