// End-to-end proof that the Walrus round-trip works from THIS machine:
//   store a nonce-tagged finding → wait for the Walrus blob id → recall it →
//   assert the nonce comes back. Runs against namespace `sabi-smoke`, never the
//   community namespace. Exit code 0 = PASS.
//
//   pnpm smoke

import { randomUUID } from "node:crypto";
import { loadEnv } from "./_env";

loadEnv();

const { formatFinding, todayISO } = await import("../lib/findings");
const { storeFinding, searchFindings, health, mode } = await import("../lib/memwal");

const NS = "sabi-smoke";
const nonce = randomUUID().slice(0, 8);

// A mock cannot prove a Walrus round-trip; a PASS here in mock mode would be a
// lie with an exit code. Refuse outright.
if (mode() === "mock") {
  console.error(
    "\nFAIL: MEMWAL_MODE=mock - smoke proves a real Walrus round-trip. Run it with live credentials.\n",
  );
  process.exit(1);
}

const today = todayISO();

console.log(`\nSabi smoke · mode=${mode()} ns=${NS} nonce=${nonce}\n`);

try {
  const h = await health();
  console.log(`health: ${JSON.stringify(h).slice(0, 160)}`);
} catch (err) {
  console.log(`health: (unavailable) ${err instanceof Error ? err.message : String(err)}`);
}

const line = formatFinding({
  category: "TOOLING",
  subject: `Smoke test ${nonce}`,
  finding: `Synthetic smoke-test finding with nonce ${nonce}; safe to ignore`,
  fix: "none known",
  verifiedOn: today,
  provider: "sabi-smoke",
  version: "smoke",
  volatile: false,
  reportedBy: "@smoke",
});

const t0 = Date.now();
console.log("store …");
const stored = await storeFinding(line, { namespace: NS, timeoutMs: 90_000 });
const tStore = Date.now() - t0;
console.log(`  ${stored.status} memory_id=${stored.memory_id ?? "-"} job=${stored.job_id} (${(tStore / 1000).toFixed(1)}s)`);
if (stored.status !== "done") {
  console.log("\nFAIL: relayer accepted the job but did not finish within the timeout.");
  process.exit(1);
}

// The relayer indexes right after the job is done, but give it a beat and retry.
let found = false;
let tRecall = 0;
for (let attempt = 1; attempt <= 5 && !found; attempt++) {
  const t1 = Date.now();
  const res = await searchFindings(`smoke test ${nonce}`, { namespace: NS, limit: 10, today });
  tRecall = Date.now() - t1;
  const hits = [...res.active, ...res.superseded];
  found = hits.some((h) => h.text.includes(nonce));
  console.log(`recall attempt ${attempt}: ${hits.length} hit(s) in ${(tRecall / 1000).toFixed(1)}s ${found ? "✓ nonce found" : ""}`);
  if (!found) await new Promise((r) => setTimeout(r, 2_000));
}

console.log(
  `\n${found ? "PASS" : "FAIL"} · store ${(tStore / 1000).toFixed(1)}s · recall ${(tRecall / 1000).toFixed(1)}s · memory_id ${stored.memory_id}\n`,
);
process.exit(found ? 0 : 1);
