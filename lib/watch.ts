// The watchdog's memory, and what it concludes from it. Pure: no SDK, no I/O.
//
// Each member gets a PERSONAL namespace next to the community one. It holds
// three kinds of single-line memory, all appended, none ever edited:
//
//   [WATCH] <address> → <label> → SINCE: YYYY-MM-DD
//   [SNAPSHOT] <address> → <balance> MIST → AT: <ISO time>
//   [FAILURE] <address> → <failure signature> → TX: <digest> → AT: <ISO time>
//   [RULE] <escalate|mute|set|clear> → <target> → REASON: <why> → AT: <ISO time>
//
// Rules are the member's escalation preferences, learned from what they say
// and click. The newest rule for a target wins; `clear` removes it.
//
// Snapshots are SUI balances read through Tatum. Burn is computed between
// consecutive snapshots in code; the model never does this arithmetic.

import { isAddress, isDigest, mistToSui } from "./onchain";

const SEP = " → ";

export interface Watch {
  kind: "watch";
  address: string;
  label: string;
  since: string;
}
export interface Snapshot {
  kind: "snapshot";
  address: string;
  mist: bigint;
  at: string;
}
export interface FailureSeen {
  kind: "failure";
  address: string;
  signature: string;
  digest: string;
  at: string;
}
export type RuleAction = "escalate" | "mute" | "set" | "clear";
export interface Rule {
  kind: "rule";
  action: RuleAction;
  /** kind:<alert kind> | text:<words> | address:<0x..> | spike_ratio=<n> | runway_days=<n> */
  target: string;
  reason: string;
  at: string;
}
export type PersonalLine = Watch | Snapshot | FailureSeen | Rule;

export const ALERT_KINDS = ["burn_spike", "low_runway", "new_failure", "repeat_failure"] as const;
const MATCH_TARGET = /^(kind:(burn_spike|low_runway|new_failure|repeat_failure)|text:[^\n→|]{2,60}|address:0x[0-9a-f]{1,64})$/;
const SET_TARGET = /^(spike_ratio=\d+(\.\d+)?|runway_days=\d{1,3})$/;

/** Is `target` valid for `action`? Matching rules name what they match; `set` names a threshold. */
export function validRule(action: RuleAction, target: string): boolean {
  if (action === "set") return SET_TARGET.test(target);
  if (action === "clear") return MATCH_TARGET.test(target) || SET_TARGET.test(target);
  return MATCH_TARGET.test(target);
}

/** Lower-case the parts of a target that are case-insensitive. */
export function normalizeTarget(target: string): string {
  const t = target.trim();
  if (t.startsWith("text:")) return `text:${t.slice(5).trim().toLowerCase()}`;
  return t.toLowerCase();
}

/** One namespace per member: `<community>--u-<handle>`, in characters any namespace accepts. */
export function personalNamespace(community: string, handle: string): string {
  const h = handle.replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  return `${community}--u-${h}`;
}

export function normalizeAddress(a: string): string {
  return a.trim().toLowerCase();
}

const clean = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/→/g, "->").trim();

export function formatWatch(w: Omit<Watch, "kind">): string {
  return [`[WATCH] ${normalizeAddress(w.address)}`, clean(w.label).slice(0, 60) || "project", `SINCE: ${w.since}`].join(SEP);
}

export function formatSnapshot(s: Omit<Snapshot, "kind">): string {
  return [`[SNAPSHOT] ${normalizeAddress(s.address)}`, `${s.mist.toString()} MIST`, `AT: ${s.at}`].join(SEP);
}

export function formatFailure(f: Omit<FailureSeen, "kind">): string {
  return [
    `[FAILURE] ${normalizeAddress(f.address)}`,
    clean(f.signature).slice(0, 200),
    `TX: ${f.digest}`,
    `AT: ${f.at}`,
  ].join(SEP);
}

export function formatRule(r: Omit<Rule, "kind">): string {
  return [`[RULE] ${r.action}`, normalizeTarget(r.target), `REASON: ${clean(r.reason).slice(0, 160) || "-"}`, `AT: ${r.at}`].join(SEP);
}

function parseRule(parts: string[]): Rule | null {
  const action = /^\[RULE\]\s+(escalate|mute|set|clear)$/.exec(parts[0])?.[1] as RuleAction | undefined;
  if (!action || parts.length !== 4) return null;
  const target = normalizeTarget(parts[1]);
  const reason = parts[2].startsWith("REASON:") ? parts[2].slice(7).trim() : null;
  const at = parts[3].startsWith("AT:") ? parts[3].slice(3).trim() : null;
  if (!validRule(action, target) || reason === null || !at || Number.isNaN(Date.parse(at))) return null;
  return { kind: "rule", action, target, reason, at };
}

export function parsePersonal(text: string): PersonalLine | null {
  if (text.startsWith("[RULE]")) return parseRule(text.split(SEP).map((p) => p.trim()));
  const head = /^\[(WATCH|SNAPSHOT|FAILURE)\]\s+(\S+)$/.exec(text.split(SEP)[0]?.trim() ?? "");
  if (!head) return null;
  const parts = text.split(SEP).map((p) => p.trim());
  const address = head[2].toLowerCase();
  if (!isAddress(address)) return null;
  const field = (p: string | undefined, key: string) =>
    p?.startsWith(`${key}:`) ? p.slice(key.length + 1).trim() : null;

  if (head[1] === "WATCH" && parts.length === 3) {
    const since = field(parts[2], "SINCE");
    return since ? { kind: "watch", address, label: parts[1], since } : null;
  }
  if (head[1] === "SNAPSHOT" && parts.length === 3) {
    const m = /^(\d+) MIST$/.exec(parts[1]);
    const at = field(parts[2], "AT");
    return m && at && !Number.isNaN(Date.parse(at))
      ? { kind: "snapshot", address, mist: BigInt(m[1]), at }
      : null;
  }
  if (head[1] === "FAILURE" && parts.length === 4) {
    const digest = field(parts[2], "TX");
    const at = field(parts[3], "AT");
    return digest && isDigest(digest) && at
      ? { kind: "failure", address, signature: parts[1], digest, at }
      : null;
  }
  return null;
}

/** BigInt-safe JSON for tool outputs and API responses (MIST amounts exceed 2^53). */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

// ── analysis ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Intervals shorter than this say more about timing noise than about burn. */
const MIN_INTERVAL_MS = 2 * 3_600_000;
/** A day's burn this many times the baseline is an alert. */
export const SPIKE_RATIO = 2;
/** Fewer days of balance than this at the current burn is an alert. */
export const LOW_RUNWAY_DAYS = 14;
/** Burn below this (MIST/day) is noise, not a spike: 0.01 SUI. */
const MIN_ALERT_BURN = 10_000_000n;

export interface BurnInterval {
  from: string;
  to: string;
  days: number;
  /** MIST spent per day over the interval; 0 when the balance went up. */
  perDay: bigint;
  /** The balance rose: a deposit, so this interval says nothing about spend. */
  deposit: boolean;
}

export interface Alert {
  kind: "burn_spike" | "low_runway" | "new_failure" | "repeat_failure";
  severity: "warn" | "bad";
  title: string;
  detail: string;
  /** For failure alerts: the failure signature, which is also the recall query. */
  signature?: string;
  /** Set when one of the member's rules escalated this alert: that rule's target. */
  escalatedBy?: string;
  /** Set on a muted alert: the rule that muted it. */
  mutedBy?: string;
}

export interface ProjectReport {
  address: string;
  label: string;
  since: string;
  balanceMist: bigint | null;
  lastSnapshotAt: string | null;
  snapshots: number;
  /** Balance over time, oldest first - the chart. */
  points: { at: string; mist: bigint }[];
  intervals: BurnInterval[];
  /** Burn over the latest interval, MIST/day. */
  latestPerDay: bigint | null;
  /** Median burn of the intervals before the latest, MIST/day (needs 2+). */
  baselinePerDay: bigint | null;
  runwayDays: number | null;
  failures: { signature: string; count: number; lastAt: string; lastDigest: string; recent: number }[];
  /** Alerts after the member's rules: escalated first. */
  alerts: Alert[];
  /** Alerts the member's rules muted - counted, never silently dropped. */
  muted: Alert[];
  /** Thresholds in force, after any `set` rules. */
  thresholds: { spikeRatio: number; runwayDays: number };
}

// ── rules ───────────────────────────────────────────────────────────────────

/** The rules in force: newest per target, `clear` removing a target. */
export function activeRules(lines: PersonalLine[]): Rule[] {
  const ordered = lines
    .filter((l): l is Rule => l.kind === "rule")
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byTarget = new Map<string, Rule>();
  for (const r of ordered) {
    if (r.action === "clear") byTarget.delete(r.target);
    // A threshold has one slot per name, whatever its value.
    else if (r.action === "set") {
      const name = r.target.split("=")[0];
      for (const k of [...byTarget.keys()]) if (k.startsWith(`${name}=`)) byTarget.delete(k);
      byTarget.set(r.target, r);
    } else byTarget.set(r.target, r);
  }
  return [...byTarget.values()];
}

export function thresholdsFrom(rules: Rule[]): { spikeRatio: number; runwayDays: number } {
  const get = (name: string) => {
    const r = rules.find((x) => x.action === "set" && x.target.startsWith(`${name}=`));
    return r ? Number(r.target.split("=")[1]) : null;
  };
  const clamp = (v: number | null, lo: number, hi: number, d: number) =>
    v === null || Number.isNaN(v) ? d : Math.min(hi, Math.max(lo, v));
  return {
    spikeRatio: clamp(get("spike_ratio"), 1.2, 20, SPIKE_RATIO),
    runwayDays: clamp(get("runway_days"), 1, 365, LOW_RUNWAY_DAYS),
  };
}

function ruleMatches(r: Rule, a: Alert, address: string): boolean {
  if (r.target.startsWith("kind:")) return a.kind === r.target.slice(5);
  if (r.target.startsWith("address:")) return address === r.target.slice(8);
  if (r.target.startsWith("text:")) {
    const hay = `${a.title} ${a.detail} ${a.signature ?? ""}`.toLowerCase();
    return hay.includes(r.target.slice(5));
  }
  return false;
}

/** Escalate beats mute: a member who said "always tell me" is never silenced by a broader mute. */
export function applyRules(
  alerts: Alert[],
  address: string,
  rules: Rule[],
): { alerts: Alert[]; muted: Alert[] } {
  const shown: Alert[] = [];
  const muted: Alert[] = [];
  for (const a of alerts) {
    const up = rules.find((r) => r.action === "escalate" && ruleMatches(r, a, address));
    const down = rules.find((r) => r.action === "mute" && ruleMatches(r, a, address));
    if (up) shown.push({ ...a, severity: "bad", escalatedBy: up.target });
    else if (down) muted.push({ ...a, mutedBy: down.target });
    else shown.push(a);
  }
  shown.sort((x, y) => Number(Boolean(y.escalatedBy)) - Number(Boolean(x.escalatedBy)));
  return { alerts: shown, muted };
}

function median(xs: bigint[]): bigint | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n;
}

export function burnIntervals(snaps: Snapshot[]): BurnInterval[] {
  const ordered = [...snaps].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: BurnInterval[] = [];
  let prev: Snapshot | undefined;
  for (const s of ordered) {
    if (prev) {
      const ms = Date.parse(s.at) - Date.parse(prev.at);
      if (ms < MIN_INTERVAL_MS) continue;
      const spent = prev.mist - s.mist;
      const days = ms / DAY_MS;
      out.push({
        from: prev.at,
        to: s.at,
        days,
        perDay: spent > 0n ? (spent * BigInt(Math.round(1e6))) / BigInt(Math.round(days * 1e6)) : 0n,
        deposit: spent < 0n,
      });
    }
    prev = s;
  }
  return out;
}

/**
 * Everything the watchdog can say about one address from its memories.
 * `now` is injected so the analysis is reproducible in tests.
 */
export function analyzeProject(
  watch: Watch,
  lines: PersonalLine[],
  now: Date,
  rules: Rule[] = activeRules(lines),
): ProjectReport {
  const thresholds = thresholdsFrom(rules);
  const mine = lines.filter((l) => l.kind !== "rule" && l.address === watch.address);
  const snaps = mine.filter((l): l is Snapshot => l.kind === "snapshot");
  const fails = mine.filter((l): l is FailureSeen => l.kind === "failure");
  const latest = [...snaps].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const intervals = burnIntervals(snaps);
  const spend = intervals.filter((i) => !i.deposit);
  const latestInterval = intervals[intervals.length - 1];
  const latestPerDay = latestInterval && !latestInterval.deposit ? latestInterval.perDay : null;
  // Baseline = what was normal BEFORE the latest interval; two intervals minimum.
  const prior = (latestPerDay !== null ? spend.slice(0, -1) : spend).map((i) => i.perDay);
  const baselinePerDay = prior.length >= 2 ? median(prior) : null;
  const burnForRunway = baselinePerDay ?? latestPerDay;
  const runwayDays =
    latest && burnForRunway && burnForRunway > 0n
      ? Number((latest.mist * 100n) / burnForRunway) / 100
      : null;

  // Failures grouped by exact signature; "recent" = last 7 days.
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const groups = new Map<string, FailureSeen[]>();
  for (const f of fails) groups.set(f.signature, [...(groups.get(f.signature) ?? []), f]);
  const failures = [...groups.entries()]
    .map(([signature, list]) => {
      const sorted = [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return {
        signature,
        count: new Set(list.map((f) => f.digest)).size,
        lastAt: sorted[0].at,
        lastDigest: sorted[0].digest,
        recent: new Set(list.filter((f) => Date.parse(f.at) >= weekAgo).map((f) => f.digest)).size,
      };
    })
    .sort((a, b) => b.recent - a.recent || b.count - a.count);

  const alerts: Alert[] = [];
  if (latestPerDay !== null && baselinePerDay && baselinePerDay > 0n && latestPerDay >= MIN_ALERT_BURN) {
    const ratio = Number((latestPerDay * 100n) / baselinePerDay) / 100;
    if (ratio >= thresholds.spikeRatio) {
      alerts.push({
        kind: "burn_spike",
        severity: ratio >= 4 ? "bad" : "warn",
        title: `Spend is ${ratio.toFixed(1)}× your baseline`,
        detail: `${mistToSui(latestPerDay)} SUI/day since ${latestInterval.from.slice(0, 10)}, against a usual ${mistToSui(baselinePerDay)} SUI/day.`,
      });
    }
  }
  if (runwayDays !== null && runwayDays < thresholds.runwayDays) {
    alerts.push({
      kind: "low_runway",
      severity: runwayDays < 3 ? "bad" : "warn",
      title: `About ${runwayDays < 1 ? "less than a day" : `${Math.floor(runwayDays)} days`} of gas left`,
      detail: `${mistToSui(latest!.mist)} SUI at ${mistToSui(burnForRunway!)} SUI/day.`,
    });
  }
  for (const f of failures) {
    const firstSeen = groups.get(f.signature)!.reduce((min, x) => (x.at < min ? x.at : min), f.lastAt);
    if (Date.parse(firstSeen) >= weekAgo) {
      alerts.push({
        kind: "new_failure",
        severity: "warn",
        title: "New failure type",
        detail: `${f.signature}, first seen ${firstSeen.slice(0, 10)}.`,
        signature: f.signature,
      });
    } else if (f.recent >= 3) {
      alerts.push({
        kind: "repeat_failure",
        severity: "bad",
        title: `${f.recent} failures this week`,
        detail: `${f.signature} keeps happening.`,
        signature: f.signature,
      });
    }
  }

  return {
    address: watch.address,
    label: watch.label,
    since: watch.since,
    balanceMist: latest?.mist ?? null,
    lastSnapshotAt: latest?.at ?? null,
    snapshots: snaps.length,
    points: [...snaps]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((s) => ({ at: s.at, mist: s.mist })),
    intervals,
    latestPerDay,
    baselinePerDay,
    runwayDays,
    failures,
    ...applyRules(alerts, watch.address, rules),
    thresholds,
  };
}
