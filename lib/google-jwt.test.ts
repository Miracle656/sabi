// Only the offline rejection paths: structure and algorithm checks run before
// any JWKS fetch, so these tests never touch the network. The signature path
// is exercised by real sign-ins.

import { strict as assert } from "node:assert";
import test from "node:test";
import { verifyGoogleIdToken } from "./google-jwt";

const AUD = "client-id.apps.googleusercontent.com";
const b64 = (o: object) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

test("not a JWT", async () => {
  await assert.rejects(() => verifyGoogleIdToken("nope", AUD), /not a JWT/);
  await assert.rejects(() => verifyGoogleIdToken("a.b", AUD), /not a JWT/);
});

test("alg none / HS256 are refused before any key lookup", async () => {
  for (const alg of ["none", "HS256", "RS384"]) {
    const tok = `${b64({ alg, kid: "k" })}.${b64({})}.sig`;
    await assert.rejects(() => verifyGoogleIdToken(tok, AUD), /unexpected alg/);
  }
});

test("RS256 without kid is refused", async () => {
  const tok = `${b64({ alg: "RS256" })}.${b64({})}.sig`;
  await assert.rejects(() => verifyGoogleIdToken(tok, AUD), /no kid/);
});
