import { test } from "node:test";
import assert from "node:assert/strict";

import {
  confirmers,
  enrich,
  formatFinding,
  parseFinding,
  resolveHits,
  toConfirmation,
  type Finding,
} from "./findings";
import { buildContributors, buildTopics, findContributor } from "./reputation";

const TODAY = "2026-10-25";

const base: Finding = {
  category: "CARRIER",
  subject: "WalletConnect relay on a mobile carrier",
  finding: "Relay websocket never opens on mobile data",
  fix: "custom relay URL",
  verifiedOn: "2026-07-01",
  provider: "Carrier X",
  version: "walletconnect v2",
  volatile: true,
  reportedBy: "@ada",
};

const row = (id: string, f: Finding) => enrich(id, formatFinding(f), 0.2, TODAY);
const confirm = (id: string, target: string, by: string, on: string) =>
  row(id, toConfirmation(base, target, { reporter: by, today: on }));

test("a confirmation round-trips through the canonical line", () => {
  const c = toConfirmation(base, "blob_original1", { reporter: "tunde", today: TODAY });
  const line = formatFinding(c);
  assert.match(line, /\| by:@tunde \| CONFIRMS:blob_original1$/);
  const back = parseFinding(line)!;
  assert.equal(back.confirms, "blob_original1");
  assert.equal(back.supersedes, undefined);
  assert.equal(back.subject, base.subject);
});

test("CONFIRMS wins over SUPERSEDES and ignores non-ids", () => {
  const both = `${formatFinding(base)} | SUPERSEDES:blob_aaaaaaaa | CONFIRMS:blob_bbbbbbbb`;
  const f = parseFinding(both)!;
  assert.equal(f.confirms, "blob_bbbbbbbb");
  assert.equal(f.supersedes, undefined);
  assert.equal(parseFinding(`${formatFinding(base)} | CONFIRMS:null`)!.confirms, undefined);
});

test("confirmations fold into the original and restart its staleness clock", () => {
  const original = row("blob_original1", base); // 116 days old: stale on its own
  assert.equal(original.stale, true);
  const { active } = resolveHits(
    [original, confirm("blob_confirm01", "blob_original1", "@tunde", "2026-10-20")],
    TODAY,
  );
  assert.equal(active.length, 1);
  assert.equal(active[0].memory_id, "blob_original1");
  assert.equal(active[0].last_verified, "2026-10-20");
  assert.equal(active[0].stale, false);
  assert.equal(active[0].age_days, 5);
  assert.deepEqual(confirmers(active[0]), ["@tunde"]);
});

test("a self-confirmation refreshes the date but is not a confirmer", () => {
  const { active } = resolveHits(
    [row("blob_original1", base), confirm("blob_confirm01", "blob_original1", "@Ada", "2026-10-20")],
    TODAY,
  );
  assert.equal(active[0].last_verified, "2026-10-20");
  assert.equal(active[0].confirmations![0].self, true);
  assert.deepEqual(confirmers(active[0]), []);
});

test("a confirmation whose original was not recalled stands on its own", () => {
  const { active } = resolveHits([confirm("blob_confirm01", "blob_missing01", "@tunde", TODAY)], TODAY);
  assert.equal(active.length, 1);
  assert.equal(active[0].finding!.confirms, "blob_missing01");
});

test("reputation rewards being confirmed by distinct members, never self-confirmation", () => {
  const hits = [
    row("blob_original1", base),
    confirm("blob_confirm01", "blob_original1", "@tunde", "2026-10-20"),
    confirm("blob_confirm02", "blob_original1", "@tunde", "2026-10-21"), // same member again
    confirm("blob_confirm03", "blob_original1", "@kemi", "2026-10-22"),
    confirm("blob_confirm04", "blob_original1", "@ada", "2026-10-23"), // self
    row("blob_seedrow01", { ...base, subject: "seed", reportedBy: "@seed" }),
  ];
  const people = buildContributors(hits);
  const ada = findContributor(people, "ada")!;
  assert.equal(ada.findings, 1);
  assert.equal(ada.confirmationsReceived, 2);
  assert.equal(ada.confirmedBy, 2);
  assert.equal(ada.points, 10 + 2 * 5);
  assert.equal(ada.level.id, "verifier");
  const tunde = findContributor(people, "@tunde")!;
  assert.equal(tunde.findings, 0);
  assert.equal(tunde.confirmationsGiven, 1);
  assert.equal(tunde.points, 2);
  assert.equal(tunde.level.id, "newcomer");
  assert.equal(findContributor(people, "@seed"), undefined);
  assert.equal(people[0].handle, "@ada");
});

test("three confirmed findings make a member Trusted", () => {
  const hits = ["1", "2", "3"].flatMap((n) => [
    row(`blob_find000${n}`, { ...base, subject: `finding ${n}` }),
    confirm(`blob_conf000${n}`, `blob_find000${n}`, n === "1" ? "@kemi" : "@tunde", TODAY),
  ]);
  assert.equal(findContributor(buildContributors(hits), "@ada")!.level.id, "trusted");
});

test("topics count active findings and stale ones", () => {
  const { active } = resolveHits(
    [row("blob_original1", base), row("blob_wallet001", { ...base, category: "WALLET", verifiedOn: TODAY })],
    TODAY,
  );
  const topics = buildTopics(active);
  assert.deepEqual(
    topics.find((t) => t.category === "CARRIER"),
    { category: "CARRIER", active: 1, stale: 1, latest: "2026-07-01" },
  );
  assert.equal(topics.find((t) => t.category === "WALLET")!.active, 1);
  assert.equal(topics.find((t) => t.category === "RPC")!.active, 0);
});
