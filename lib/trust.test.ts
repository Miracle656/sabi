import { test } from "node:test";
import assert from "node:assert/strict";

import { enrich, formatFinding, parseFinding, resolveHits, toConfirmation, type Finding } from "./findings";
import { trustOf, TRUST, type TrustContext } from "./trust";

const TODAY = "2026-10-30";
const ADA = "0x00000000000000000000000000000000000000000000000000000000000000aa";
const TUNDE = "0x00000000000000000000000000000000000000000000000000000000000000bb";
const base: Finding = {
  category: "TOOLING",
  subject: "MoveAbort 101 in m::z",
  finding: "Swap aborts with code 101 when the pool is paused",
  fix: "check pool status first",
  verifiedOn: "2026-10-28",
  provider: "Sui mainnet",
  version: "Oct 2026",
  volatile: false,
  reportedBy: "@ada",
  address: ADA,
};
const row = (id: string, f: Finding) => enrich(id, formatFinding(f), 0.2, TODAY);
const ctx = (over: Partial<TrustContext> = {}): TrustContext => ({
  levelOf: () => undefined,
  packagesOf: () => undefined,
  ...over,
});

test("the writer's address round-trips through the line", () => {
  const line = formatFinding(base);
  assert.match(line, new RegExp(`\\| by:@ada \\| addr:${ADA}$`));
  assert.equal(parseFinding(line)!.address, ADA);
  assert.equal(parseFinding(line.replace(ADA, "0xNOTHEX"))!.address, undefined);
});

test("an unconfirmed finding is Low and says why", () => {
  const t = trustOf(row("blob_original1", base), ctx())!;
  assert.equal(t.score, TRUST.verified);
  assert.equal(t.label, "Low");
  assert.deepEqual(t.parts.map((p) => p.label), ["verified by its author"]);
});

test("confirmations, builders, evidence and level add up", () => {
  const confirm = (id: string, by: string, address?: string) =>
    row(id, toConfirmation(base, "blob_original1", { reporter: by, today: TODAY, address }));
  const { active } = resolveHits(
    [
      row("blob_original1", { ...base, evidence: "Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS" }),
      confirm("blob_confirm01", "@tunde", TUNDE),
      confirm("blob_confirm02", "@kemi"),
      confirm("blob_confirm03", "@ada", ADA), // self: not a confirmer
    ],
    TODAY,
  );
  const t = trustOf(
    active[0],
    ctx({
      levelOf: (h) => (h === "@ada" ? "trusted" : undefined),
      packagesOf: (a) => (a === TUNDE ? 3 : a === ADA ? 1 : undefined),
    }),
  )!;
  // 30 verified + 2x15 confirmers + 5 builder confirmer + 5 builder author + 15 evidence + 5 trusted
  assert.equal(t.score, 90);
  assert.equal(t.label, "High");
  assert.ok(t.parts.some((p) => p.label === "1 confirmer has published Sui packages"));
});

test("staleness and age take points away; the score never goes below 0", () => {
  const old = row("blob_original1", { ...base, volatile: true, verifiedOn: "2026-07-01" });
  const t = trustOf(old, ctx())!;
  assert.equal(t.score, TRUST.verified + TRUST.stale);
  const aging = row("blob_original2", { ...base, volatile: true, verifiedOn: "2026-09-20" });
  assert.equal(trustOf(aging, ctx())!.score, TRUST.verified + TRUST.aging);
});
