import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeProject,
  burnIntervals,
  formatFailure,
  formatSnapshot,
  formatWatch,
  jsonSafe,
  parsePersonal,
  personalNamespace,
  type PersonalLine,
  type Watch,
} from "./watch";

const ADDR = "0xd09783e7fe926e738c17522fed72866ef53b85d764bf10c0448854ba041a23ee";
const DIGEST = "Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS";
const SUI = 1_000_000_000n;
const watch: Watch = { kind: "watch", address: ADDR, label: "my dex", since: "2026-10-20" };
const snap = (day: number, sui: number): PersonalLine => ({
  kind: "snapshot",
  address: ADDR,
  mist: BigInt(Math.round(sui * 1e9)),
  at: `2026-10-${String(day).padStart(2, "0")}T06:00:00.000Z`,
});

test("personal lines round-trip through their canonical text", () => {
  const w = parsePersonal(formatWatch({ address: ADDR.toUpperCase().replace("0X", "0x"), label: "my → dex", since: "2026-10-20" }));
  assert.deepEqual(w, { kind: "watch", address: ADDR, label: "my -> dex", since: "2026-10-20" });
  const s = parsePersonal(formatSnapshot({ address: ADDR, mist: 94n * SUI, at: "2026-10-30T06:00:00.000Z" }));
  assert.deepEqual(s, { kind: "snapshot", address: ADDR, mist: 94n * SUI, at: "2026-10-30T06:00:00.000Z" });
  const f = parsePersonal(formatFailure({ address: ADDR, signature: "MoveAbort 101 in 0xfa55…9ae1::m::z", digest: DIGEST, at: "2026-10-30T06:00:00.000Z" }));
  assert.equal(f?.kind, "failure");
  assert.equal(parsePersonal("[WALLET] a finding → not personal"), null);
  assert.equal(parsePersonal("[SNAPSHOT] 0xzz → 5 MIST → AT: 2026-10-30T06:00:00Z"), null);
});

test("one namespace per member, safe characters only", () => {
  assert.equal(personalNamespace("sabi-v2", "@Ada.Lovelace"), "sabi-v2--u-ada-lovelace");
});

test("burn is spend per day between snapshots; deposits are not burn", () => {
  const i = burnIntervals([snap(1, 100), snap(2, 99), snap(4, 97), snap(5, 150)] as never);
  assert.equal(i.length, 3);
  assert.equal(i[0].perDay, 1n * SUI);
  assert.equal(i[1].perDay, 1n * SUI); // 2 SUI over 2 days
  assert.equal(i[2].deposit, true);
  assert.equal(i[2].perDay, 0n);
});

test("a spend spike against the baseline raises an alert, with runway", () => {
  const lines = [snap(20, 100), snap(21, 99), snap(22, 98), snap(23, 97), snap(24, 92)];
  const r = analyzeProject(watch, lines, new Date("2026-10-24T12:00:00Z"));
  assert.equal(r.baselinePerDay, 1n * SUI);
  assert.equal(r.latestPerDay, 5n * SUI);
  assert.equal(r.runwayDays, 92);
  const spike = r.alerts.find((a) => a.kind === "burn_spike")!;
  assert.equal(spike.severity, "bad");
  assert.match(spike.title, /5\.0× your baseline/);
});

test("steady spend raises nothing; low runway does", () => {
  const steady = analyzeProject(watch, [snap(20, 100), snap(21, 99), snap(22, 98), snap(23, 97)], new Date("2026-10-23T12:00:00Z"));
  assert.deepEqual(steady.alerts, []);
  const low = analyzeProject(watch, [snap(20, 12), snap(21, 11), snap(22, 10), snap(23, 9)], new Date("2026-10-23T12:00:00Z"));
  assert.equal(low.alerts[0].kind, "low_runway");
  assert.match(low.alerts[0].title, /About 9 days/);
});

test("failures group by signature; new ones and repeats are flagged", () => {
  const fail = (day: number, digestTail: string, sig = "MoveAbort 101 in 0xfa55…9ae1::m::z"): PersonalLine => ({
    kind: "failure",
    address: ADDR,
    signature: sig,
    digest: DIGEST.slice(0, -2) + digestTail,
    at: `2026-10-${day}T06:00:00.000Z`,
  });
  const now = new Date("2026-10-30T12:00:00Z");
  const fresh = analyzeProject(watch, [fail(29, "aa")], now);
  assert.equal(fresh.alerts[0].kind, "new_failure");
  const old = [fail(10, "bb"), fail(28, "cc"), fail(29, "dd"), fail(30, "ee")];
  const repeat = analyzeProject(watch, old, now);
  assert.equal(repeat.failures[0].count, 4);
  assert.equal(repeat.failures[0].recent, 3);
  assert.equal(repeat.alerts[0].kind, "repeat_failure");
});

test("reports serialize despite BigInt balances", () => {
  const r = analyzeProject(watch, [snap(20, 100), snap(21, 99)], new Date("2026-10-21T12:00:00Z"));
  const safe = jsonSafe(r) as { balanceMist: string };
  assert.equal(safe.balanceMist, "99000000000");
});
