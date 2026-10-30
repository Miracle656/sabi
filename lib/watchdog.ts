// The watchdog's I/O: personal memory on Walrus, balances through Tatum.
// What it concludes lives in lib/watch.ts; this file only reads and appends.

import { getEnv } from "./env";
import { namespacesWithPrefix, recallLines, searchFindings, storeFinding } from "./memwal";
import { isAddress, mistToSui, type TxReport } from "./onchain";
import { suiBalance, tatumEnabled } from "./tatum";
import { todayISO, type RecalledFinding } from "./findings";
import {
  activeRules,
  analyzeProject,
  formatFailure,
  formatRule,
  normalizeTarget,
  validRule,
  type Rule,
  type RuleAction,
  formatSnapshot,
  formatWatch,
  normalizeAddress,
  parsePersonal,
  personalNamespace,
  type PersonalLine,
  type ProjectReport,
  type Watch,
} from "./watch";

/** A balance older than this is re-read when someone looks. */
const SNAPSHOT_EVERY_MS = 6 * 3_600_000;
/** Personal writes do not block a page on the blob id; the relayer finishes in the background. */
const WRITE_WAIT_MS = 8_000;
const MAX_WATCHES = 5;
const PERSONAL_QUERY = "WATCH SNAPSHOT FAILURE address balance MIST transaction";
// Registrations and rules are the OLDEST lines a member has; they get their own lookup.
const STANDING_QUERY = "[WATCH] [RULE] address label SINCE escalate mute set clear REASON";

export function memberNamespace(handle: string): string {
  return personalNamespace(getEnv().namespace, handle);
}

async function readLines(ns: string): Promise<PersonalLine[]> {
  // Newest-first returns the latest 100 lines, and registrations and rules are
  // the OLDEST lines - so they get their own lookup and cannot age out of view.
  const [recent, watches] = await Promise.all([
    recallLines(ns, PERSONAL_QUERY, 100),
    recallLines(ns, STANDING_QUERY, 60),
  ]);
  const seen = new Set<string>();
  const out: PersonalLine[] = [];
  for (const r of [...recent, ...watches]) {
    if (seen.has(r.memory_id)) continue;
    seen.add(r.memory_id);
    const line = parsePersonal(r.text);
    if (line) out.push(line);
  }
  return out;
}

function watchesOf(lines: PersonalLine[]): Watch[] {
  // Latest label wins if an address was registered twice.
  const byAddress = new Map<string, Watch>();
  for (const l of lines) if (l.kind === "watch" && !byAddress.has(l.address)) byAddress.set(l.address, l);
  return [...byAddress.values()];
}

async function append(ns: string, text: string): Promise<void> {
  await storeFinding(text, { namespace: ns, timeoutMs: WRITE_WAIT_MS });
}

export type WatchResult = { status: "ok"; watch: Watch } | { status: "error"; error: string };

export async function addWatch(handle: string, rawAddress: string, label: string): Promise<WatchResult> {
  if (!tatumEnabled()) return { status: "error", error: "Watching needs on-chain reads (TATUM_API_KEY)." };
  const address = normalizeAddress(rawAddress);
  if (!isAddress(address)) return { status: "error", error: "That is not a Sui address (0x followed by hex)." };
  const ns = memberNamespace(handle);
  const lines = await readLines(ns);
  const existing = watchesOf(lines);
  if (existing.some((w) => w.address === address)) {
    return { status: "ok", watch: existing.find((w) => w.address === address)! };
  }
  if (existing.length >= MAX_WATCHES) {
    return { status: "error", error: `You are already watching ${MAX_WATCHES} addresses.` };
  }
  // Reading the balance first proves the address is readable on mainnet.
  const mist = await suiBalance(address);
  const watch: Watch = { kind: "watch", address, label: label.trim() || "project", since: todayISO() };
  await append(ns, formatWatch(watch));
  await append(ns, formatSnapshot({ address, mist, at: new Date().toISOString() }));
  return { status: "ok", watch };
}

/** Read and remember a fresh balance for every watch whose last one is stale. */
async function snapshotDue(ns: string, lines: PersonalLine[], now: Date): Promise<PersonalLine[]> {
  const added: PersonalLine[] = [];
  for (const w of watchesOf(lines)) {
    const last = lines
      .filter((l) => l.kind === "snapshot" && l.address === w.address)
      .reduce((max, l) => Math.max(max, Date.parse((l as { at: string }).at)), 0);
    if (now.getTime() - last < SNAPSHOT_EVERY_MS) continue;
    const mist = await suiBalance(w.address);
    const snap = { kind: "snapshot" as const, address: w.address, mist, at: now.toISOString() };
    await append(ns, formatSnapshot(snap));
    added.push(snap);
  }
  return added;
}

/**
 * Remember a failed transaction against the member's watched address. Chain
 * facts read by Sabi itself, so no human verification is needed - unlike a
 * community finding, this asserts only "this tx failed with this signature".
 */
export async function recordFailure(handle: string, tx: TxReport): Promise<boolean> {
  if (tx.ok || !tx.sender) return false;
  const ns = memberNamespace(handle);
  const lines = await readLines(ns);
  const sender = normalizeAddress(tx.sender);
  if (!watchesOf(lines).some((w) => w.address === sender)) return false;
  if (lines.some((l) => l.kind === "failure" && l.digest === tx.digest)) return true;
  await append(ns, formatFailure({ address: sender, signature: tx.signature, digest: tx.digest, at: new Date().toISOString() }));
  return true;
}

export interface ProjectStatus {
  namespace: string;
  projects: (ProjectReport & { fixes: Record<string, RecalledFinding[]> })[];
  memories: number;
  rules: Rule[];
  /** Recent community findings matching the member's escalate text rules. */
  communityWatch: { target: string; findings: RecalledFinding[] }[];
}

/** Community findings this recent count as news for an escalate rule. */
const NEWS_DAYS = 30;

export type RuleResult = { status: "ok"; rule: Rule; replaced?: Rule } | { status: "error"; error: string };

/**
 * Remember an escalation preference. The newest rule for a target wins, so a
 * correction ("actually, do tell me about that") is just another rule.
 */
export async function addRule(
  handle: string,
  action: RuleAction,
  rawTarget: string,
  reason: string,
): Promise<RuleResult> {
  const target = normalizeTarget(rawTarget);
  if (!validRule(action, target)) {
    return {
      status: "error",
      error:
        action === "set"
          ? "A threshold rule is spike_ratio=<number> or runway_days=<days>."
          : "A rule matches kind:<burn_spike|low_runway|new_failure|repeat_failure>, text:<words> or address:<0x..>.",
    };
  }
  const ns = memberNamespace(handle);
  const before = activeRules(await readLines(ns));
  const replaced = before.find(
    (r) => r.target === target || (action === "set" && r.target.split("=")[0] === target.split("=")[0]),
  );
  const rule: Rule = { kind: "rule", action, target, reason: reason.trim(), at: new Date().toISOString() };
  await append(ns, formatRule(rule));
  return { status: "ok", rule, ...(replaced ? { replaced } : {}) };
}

/** Everything the "Your project" page and the project_status tool show. */
export async function projectStatus(handle: string, opts: { refresh?: boolean } = {}): Promise<ProjectStatus> {
  const ns = memberNamespace(handle);
  const now = new Date();
  let lines = await readLines(ns);
  if (opts.refresh !== false && tatumEnabled()) {
    try {
      lines = [...(await snapshotDue(ns, lines, now)), ...lines];
    } catch {
      /* a failed balance read must not hide what is already known */
    }
  }
  const today = todayISO(now);
  const rules = activeRules(lines);
  const projects = await Promise.all(
    watchesOf(lines).map(async (w) => {
      const report = analyzeProject(w, lines, now, rules);
      // The community's verified fix for each failure this project hit.
      const fixes: Record<string, RecalledFinding[]> = {};
      for (const f of report.failures.slice(0, 4)) {
        try {
          fixes[f.signature] = (await searchFindings(f.signature, { limit: 2, today })).active;
        } catch {
          fixes[f.signature] = [];
        }
      }
      return { ...report, fixes };
    }),
  );
  // "Always flag enoki" also means: tell me when the community verifies
  // something new about enoki.
  const communityWatch = await Promise.all(
    rules
      .filter((r) => r.action === "escalate" && r.target.startsWith("text:"))
      .slice(0, 5)
      .map(async (r) => {
        try {
          const { active } = await searchFindings(r.target.slice(5), { limit: 4, today });
          const fresh = active.filter((h) => {
            const d = h.last_verified ?? h.finding?.verifiedOn;
            return d && Date.parse(today) - Date.parse(d) <= NEWS_DAYS * 86_400_000;
          });
          return { target: r.target, findings: fresh.slice(0, 3) };
        } catch {
          return { target: r.target, findings: [] };
        }
      }),
  );
  return { namespace: ns, projects, memories: lines.length, rules, communityWatch };
}

/** The daily cron: refresh every member's watched balances. */
export async function snapshotEveryone(): Promise<{ members: number; snapshots: number }> {
  const prefix = `${getEnv().namespace}--u-`;
  const namespaces = await namespacesWithPrefix(prefix);
  let snapshots = 0;
  const now = new Date();
  for (const ns of namespaces) {
    try {
      snapshots += (await snapshotDue(ns, await readLines(ns), now)).length;
    } catch {
      /* one member's failure must not stop the rest */
    }
  }
  return { members: namespaces.length, snapshots };
}

/** project_status for a model: SUI not MIST, fixes reduced to what an answer cites. */
export function statusForModel(s: ProjectStatus) {
  const sui = (v: bigint | null) => (v === null ? null : mistToSui(v));
  return {
    memories: s.memories,
    rules: s.rules.map((r) => ({ action: r.action, target: r.target, reason: r.reason, since: r.at })),
    community_watch: s.communityWatch.map((w) => ({
      rule: w.target,
      new_findings: w.findings.map((h) => ({
        memory_id: h.memory_id,
        subject: h.finding?.subject,
        fix: h.finding?.fix,
        by: h.finding?.reportedBy,
      })),
    })),
    projects: s.projects.map((p) => ({
      label: p.label,
      address: p.address,
      watching_since: p.since,
      balance_sui: sui(p.balanceMist),
      last_read: p.lastSnapshotAt,
      snapshots: p.snapshots,
      burn_sui_per_day_latest: sui(p.latestPerDay),
      burn_sui_per_day_baseline: sui(p.baselinePerDay),
      runway_days: p.runwayDays,
      thresholds: p.thresholds,
      alerts: p.alerts,
      muted_alerts: p.muted.length,
      failures: p.failures.map((f) => ({
        ...f,
        community_fixes: (p.fixes[f.signature] ?? []).map((h) => ({
          memory_id: h.memory_id,
          subject: h.finding?.subject,
          fix: h.finding?.fix,
          by: h.finding?.reportedBy,
        })),
      })),
    })),
    note:
      s.projects.length === 0
        ? "Nothing watched yet. Offer to watch the user's project address with watch_address."
        : undefined,
  };
}
