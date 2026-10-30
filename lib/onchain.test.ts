import { test } from "node:test";
import assert from "node:assert/strict";

import { formatFinding, parseFinding, toFinding } from "./findings";
import { findDigest, mistToSui, parseTransaction, shortId } from "./onchain";

// Shape of a real mainnet failure read through Tatum on 2026-10-30
// (Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS), trimmed.
const DIGEST = "Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS";
const PKG = "0xfa555fe81f851f45d4aa9f1e7d825fa94ee564eeaf424fb941378991274c9ae1";
const failed = {
  digest: DIGEST,
  transaction: {
    sender: "0xd09783e7fe926e738c17522fed72866ef53b85d764bf10c0448854ba041a23ee",
    kind: {
      programmableTransaction: {
        commands: [
          { moveCall: { package: "0xdfd3", module: "m", function: "gb" } },
          { moveCall: { package: PKG, module: "m", function: "gd" } },
          { splitCoins: {} },
        ],
      },
    },
  },
  effects: {
    status: {
      success: false,
      error: {
        kind: "MOVE_ABORT",
        command: "1",
        description: "MoveAbort(...) in command 1",
        abort: { abortCode: "101", location: { package: PKG, module: "m", functionName: "z" } },
      },
    },
    gasUsed: { computationCost: "100000", storageCost: "12015600", storageRebate: "12014398" },
  },
};

test("a failed transaction becomes a precise, searchable signature", () => {
  const r = parseTransaction(failed, DIGEST);
  assert.equal(r.ok, false);
  assert.equal(r.signature, "MoveAbort 101 in 0xfa55…9ae1::m::z");
  assert.deepEqual(r.failure, {
    kind: "MOVE_ABORT",
    abortCode: "101",
    package: PKG,
    module: "m",
    function: "z",
    command: 1,
    description: "MoveAbort(...) in command 1",
  });
  assert.deepEqual(r.calls, ["0xdfd3::m::gb", `${PKG}::m::gd`]);
  assert.equal(r.gas!.net, "101202");
});

test("a successful transaction reads as success and lists its calls", () => {
  const ok = { ...failed, effects: { ...failed.effects, status: { success: true } } };
  const r = parseTransaction(ok, DIGEST);
  assert.equal(r.ok, true);
  assert.equal(r.failure, undefined);
  assert.match(r.signature, /^successful transaction calling 0xdfd3::m::gb/);
});

test("non-abort failures are named by kind", () => {
  const gas = { ...failed, effects: { status: { success: false, error: { kind: "INSUFFICIENT_GAS" } } } };
  assert.equal(parseTransaction(gas, DIGEST).signature, "insufficient gas");
});

test("digests are found inside explorer links and logs", () => {
  assert.equal(findDigest(`https://suiscan.xyz/mainnet/tx/${DIGEST}`), DIGEST);
  assert.equal(findDigest(`tx ${DIGEST} failed`), DIGEST);
  assert.equal(findDigest("no digest here 0xabc"), null);
});

test("ids and amounts print for people", () => {
  assert.equal(shortId("0x0000000000000000000000000000000000000000000000000000000000000002"), "0x2");
  assert.equal(shortId(PKG), "0xfa55…9ae1");
  assert.equal(mistToSui("101202"), "0.0001");
  assert.equal(mistToSui("94933800000"), "94.9338");
  assert.equal(mistToSui("1000000000"), "1");
});

test("EVIDENCE round-trips through the canonical line; junk is dropped", () => {
  const f = toFinding(
    {
      category: "TOOLING",
      subject: "MoveAbort 101 in m::z",
      finding: "Swap aborts with code 101 when the pool is paused",
      fix: "check pool status first",
      network_or_provider: "Sui mainnet",
      version_or_app: "Oct 2026",
      evidence_tx: DIGEST,
    },
    { today: "2026-10-30", defaultReporter: "@ada" },
  );
  const line = formatFinding(f);
  assert.match(line, new RegExp(`\\| EVIDENCE:${DIGEST}$`));
  assert.equal(parseFinding(line)!.evidence, DIGEST);
  assert.equal(parseFinding(line.replace(DIGEST, "not-a-digest"))!.evidence, undefined);
});
