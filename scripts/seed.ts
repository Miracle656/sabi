// Seed the community brain from seed-findings.json.
//
//   pnpm seed                  # stores into MEMWAL_NAMESPACE
//   pnpm seed --dry            # print the canonical lines, store nothing
//   pnpm seed --file my.json   # a different findings file
//   pnpm seed --allow-placeholders   # only for mock/smoke namespaces - never the real brain
//
// Each entry is validated against the same schema the chat tool uses, then
// formatted to the canonical line and stored (sequentially, so every row prints
// its Walrus blob id as it lands). REPLACE the placeholders in
// seed-findings.json with YOUR real verified findings before the demo.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg, flag, loadEnv } from "./_env";

loadEnv();

const { FindingInputSchema, formatFinding, secretInFinding, toFinding, todayISO } =
  await import("../lib/findings");
const { normalizeHandle } = await import("../lib/env");
const { storeFinding, defaultNamespace, mode } = await import("../lib/memwal");

const file = resolve(process.cwd(), arg("file") ?? "seed-findings.json");
const raw = JSON.parse(readFileSync(file, "utf8")) as { findings?: unknown[] } | unknown[];
const items = Array.isArray(raw) ? raw : (raw.findings ?? []);
const ns = defaultNamespace();
// Same normalization the app applies, so `by:` never drifts between the seed
// path and the chat path for the same SABI_REPORTER value.
const reporter = normalizeHandle(process.env.SABI_REPORTER?.trim() || "seed");
const today = todayISO();

console.log(`\nSabi seed → ns=${ns} mode=${mode()} reporter=${reporter} (${items.length} findings)\n`);

// Memory is append-only: a PLACEHOLDER row written to the community namespace
// stays on Walrus forever. Refuse unless explicitly allowed (mock / scratch ns).
const placeholderRows = items.filter((it) => /PLACEHOLDER/i.test(JSON.stringify(it)));
if (placeholderRows.length && !flag("dry") && !flag("allow-placeholders")) {
  console.error(
    `✗ ${placeholderRows.length} of ${items.length} findings still say PLACEHOLDER. Replace them with real verified intel, or pass --allow-placeholders for a scratch namespace.
`,
  );
  process.exit(1);
}

let placeholders = 0;
const rows: { subject: string; memory_id: string; status: string }[] = [];
for (const [i, item] of items.entries()) {
  const parsed = FindingInputSchema.safeParse(item);
  if (!parsed.success) {
    console.error(`#${i + 1} invalid:`, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "));
    process.exitCode = 1;
    continue;
  }
  // The same gate the chat tool and the MCP server run: nothing secret-shaped
  // reaches append-only storage through ANY path.
  const secret = secretInFinding(parsed.data);
  if (secret) {
    console.error(`#${i + 1} refused: looks like it contains a secret (${secret}).`);
    process.exitCode = 1;
    continue;
  }
  const finding = toFinding(parsed.data, { today, defaultReporter: reporter });
  const line = formatFinding(finding);
  if (/PLACEHOLDER/i.test(line)) placeholders++;
  console.log(`#${i + 1} ${line}`);
  if (flag("dry")) continue;
  const t0 = Date.now();
  try {
    const res = await storeFinding(line);
    const id = res.memory_id ?? `(pending job ${res.job_id})`;
    rows.push({ subject: finding.subject, memory_id: id, status: res.status });
    console.log(`     → ${res.status} ${id} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  } catch (err) {
    rows.push({ subject: finding.subject, memory_id: "-", status: "error" });
    console.error(`     → error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

if (!flag("dry")) {
  console.log("\nsubject → memory_id");
  for (const r of rows) console.log(`  ${r.subject}  →  ${r.memory_id}  [${r.status}]`);
}
if (placeholders) {
  console.warn(
    `\n⚠️  ${placeholders} PLACEHOLDER finding(s) ${flag("dry") ? "would be" : "were"} stored. Replace them in seed-findings.json with real verified intel before the demo.`,
  );
}
console.log();
