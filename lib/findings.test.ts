import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FindingInputSchema,
  daysBetween,
  enrich,
  formatFinding,
  isStale,
  looksLikeSecret,
  parseFinding,
  resolveSupersession,
  toFinding,
  todayISO,
  type Finding,
} from "./findings";

const minimal = {
  category: "RPC",
  subject: "fullnode 429s",
  finding: "public fullnode returns 429 above ~20 rps from Lagos",
  fix: "none known",
  network_or_provider: "Sui mainnet",
  version_or_app: "fullnode.mainnet.sui.io",
};

const base: Finding = {
  category: "CARRIER",
  subject: "WalletConnect v2 relay on MTN NG",
  finding: "wss://relay.walletconnect.com handshake never completes on MTN 4G; error 1006",
  fix: "custom relay URL via reown appkit config",
  verifiedOn: "2026-08-01",
  provider: "MTN NG",
  version: "walletconnect v2 / appkit 1.7",
  volatile: true,
  reportedBy: "@ada",
};

test("format → parse round-trips every field", () => {
  const line = formatFinding(base);
  assert.equal(
    line,
    "[CARRIER] WalletConnect v2 relay on MTN NG → wss://relay.walletconnect.com handshake never completes on MTN 4G; error 1006 → FIX: custom relay URL via reown appkit config → VERIFIED: 2026-08-01 | MTN NG | walletconnect v2 / appkit 1.7 | volatile:yes | by:@ada",
  );
  assert.deepEqual(parseFinding(line), base);
});

test("supersedes pointer survives the round trip", () => {
  const f: Finding = { ...base, supersedes: "abc123" };
  const parsed = parseFinding(formatFinding(f));
  assert.equal(parsed?.supersedes, "abc123");
  assert.equal(parsed?.reportedBy, "@ada");
});

test("free-text memories parse to null, not garbage", () => {
  assert.equal(parseFinding("remember that the meetup is on Friday"), null);
  assert.equal(parseFinding("[NOPE] x → y → FIX: z → VERIFIED: 2026-01-01 | a | b | volatile:no"), null);
  assert.equal(parseFinding("[CARRIER] missing tail"), null);
});

test("toFinding applies defaults: today, category volatility, reporter, cleaning", () => {
  const input = FindingInputSchema.parse({
    category: "TOOLING",
    subject: "  sui client 1.40 | flag  ",
    finding: "a finding with a → arrow and\nnewline inside it",
    network_or_provider: "sui cli",
    version_or_app: "1.40",
  });
  const f = toFinding(input, { today: "2026-08-22", defaultReporter: "bayo" });
  assert.equal(f.verifiedOn, "2026-08-22");
  assert.equal(f.volatile, false); // TOOLING is not volatile by default
  assert.equal(f.reportedBy, "@bayo");
  assert.equal(f.fix, "none known");
  assert.equal(f.subject, "sui client 1.40 / flag");
  assert.ok(!f.finding.includes("→") && !f.finding.includes("\n"));
  assert.deepEqual(parseFinding(formatFinding(f)), f);
});

test("staleness: volatile > 60 days is stale, non-volatile never is", () => {
  assert.equal(isStale(base, "2026-09-30"), false); // 60 days exactly
  assert.equal(isStale(base, "2026-10-01"), true); // 61 days
  assert.equal(isStale({ ...base, volatile: false }, "2027-01-01"), false);
});

test("resolveSupersession hides the old finding and names its replacement", () => {
  const oldLine = formatFinding(base);
  const newLine = formatFinding({
    ...base,
    fix: "carrier unblocked it; default relay works again",
    verifiedOn: "2026-08-20",
    supersedes: "blob_old",
  });
  const hits = [
    enrich("blob_old", oldLine, 0.2, "2026-08-22"),
    enrich("blob_new", newLine, 0.25, "2026-08-22"),
    enrich("blob_other", "free text", 0.5, "2026-08-22"),
  ];
  const { active, superseded } = resolveSupersession(hits);
  assert.deepEqual(
    active.map((h) => h.memory_id),
    ["blob_new", "blob_other"],
  );
  assert.equal(superseded.length, 1);
  assert.equal(superseded[0].memory_id, "blob_old");
  assert.equal(superseded[0].superseded_by, "blob_new");
  assert.equal(active[0].score, 0.75);
  assert.equal(active[0].age_days, 2);
});

test("a finding whose text starts with FIX:/VERIFIED: still round-trips (parse from the end)", () => {
  const f: Finding = {
    ...base,
    finding: "FIX: endpoint returns 200 with an empty body - VERIFIED: nothing, it just lies",
    fix: "VERIFIED: retry with idempotency header",
  };
  assert.deepEqual(parseFinding(formatFinding(f)), f);
});

test("looksLikeSecret catches key shapes but not Sui object ids", () => {
  assert.equal(looksLikeSecret("set ANTHROPIC key sk-ant-api03-abcdefghijklmnopqrstuvwxyz"), "API key");
  assert.equal(looksLikeSecret("owner suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqq"), "Sui private key");
  assert.equal(looksLikeSecret("call me on 08031234567"), "Nigerian phone number");
  assert.equal(looksLikeSecret("password: hunter22"), "credential assignment");
  assert.equal(
    looksLikeSecret("package 0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6 aborts with code 0"),
    null,
  );
});

test("verified_on must be a real, non-future date; supersedes must be a memory id", () => {
  const ok = FindingInputSchema.safeParse({ ...minimal, verified_on: "2026-02-28" });
  assert.equal(ok.success, true);
  assert.equal(FindingInputSchema.safeParse({ ...minimal, verified_on: "2026-02-30" }).success, false);
  assert.equal(FindingInputSchema.safeParse({ ...minimal, verified_on: "2099-01-01" }).success, false);
  assert.equal(FindingInputSchema.safeParse({ ...minimal, supersedes_memory_id: "a | b" }).success, false);
  assert.equal(FindingInputSchema.safeParse({ ...minimal, supersedes_memory_id: "Qm_abc-123" }).success, true);
});

test("todayISO is the local calendar date", () => {
  const d = new Date(2026, 7, 23, 0, 30); // 00:30 local on Aug 23
  assert.equal(todayISO(d), "2026-08-23");
});

test("a calendar-invalid but ISO-shaped date is rejected, not read as today", () => {
  const line = formatFinding(base).replace("2026-08-01", "2026-02-30");
  // Shape matches, the date does not exist -> not a finding at all.
  assert.equal(parseFinding(line), null);
});

test("daysBetween returns NaN for unparseable dates, never 0", () => {
  assert.ok(Number.isNaN(daysBetween("not-a-date", "2026-08-23")));
  assert.ok(Number.isNaN(daysBetween("2026-02-30", "2026-08-23")));
  assert.equal(daysBetween("2026-08-01", "2026-08-23"), 22);
});

test("enrich reports age_days null rather than a fabricated 0", () => {
  const hit = enrich("blob_x", "just some free text", 0.3, "2026-08-23");
  assert.equal(hit.finding, null);
  assert.equal(hit.age_days, null);
  assert.equal(hit.stale, false);
});

test("secretInFinding catches secrets in every user-writable field", async () => {
  const { secretInFinding } = await import("./findings");
  const clean = {
    subject: "OPay payouts throttling",
    finding: "Payout API returns 429 above 10 req/s sustained.",
    fix: "Queue with a 100ms gap.",
    version_or_app: "OPay API v3",
    network_or_provider: "OPay",
  };
  assert.equal(secretInFinding(clean), null);
  // The field the first implementation skipped:
  assert.ok(secretInFinding({ ...clean, network_or_provider: "OPay key sk-live-aaaabbbbccccdddd" }));
  assert.ok(secretInFinding({ ...clean, subject: "call +2348012345678 for access" }));
  // A Sui object id and a Walrus blob id must never false-positive.
  assert.equal(
    secretInFinding({
      ...clean,
      finding:
        "Object 0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6 rejects the call; see blob auiylw9W6GV9k4NvZizI4aGRC1dK7HSlPxA7uzQ_hss.",
    }),
    null,
  );
});
