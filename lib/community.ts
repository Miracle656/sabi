// The community index: topics, contributors and levels, built on demand from
// Walrus Memory itself. No database - the sweep IS the index, cached per
// server instance for a few minutes. Walrus stays the only source of truth,
// and a cold instance rebuilds it in one sweep.
//
// This holds while a namespace fits in what the sweep can recall (8 topic
// queries x 100 rows). `coverage` reports indexed vs listed, so the UI can
// say when it no longer does.

import { todayISO, resolveHits, type RecalledFinding } from "./findings";
import { defaultNamespace, sweepNamespace } from "./memwal";
import { ensureBuilders, packagesOf } from "./builders";
import {
  buildContributors,
  buildTopics,
  byRecency,
  findContributor,
  type Contributor,
  type Topic,
} from "./reputation";
import { trustOf } from "./trust";

export interface CommunityIndex {
  namespace: string;
  builtAt: string;
  /** Current findings, newest first, confirmations folded in. */
  active: RecalledFinding[];
  superseded: number;
  contributors: Contributor[];
  topics: Topic[];
  coverage: { indexed: number; total: number | null };
}

const TTL_MS = 3 * 60_000;

interface Slot {
  at: number;
  promise: Promise<CommunityIndex>;
}
const g = globalThis as unknown as { __sabiIndex?: Map<string, Slot> };
const slots: Map<string, Slot> = (g.__sabiIndex ??= new Map());

async function build(namespace: string): Promise<CommunityIndex> {
  const today = todayISO();
  const { hits, total } = await sweepNamespace({ namespace, today });
  const { active, superseded } = resolveHits(hits, today);
  // Each member's latest known address; then who among them has shipped.
  const addressOf = new Map<string, string>();
  for (const h of [...hits].sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1))) {
    const f = h.finding;
    if (f?.reportedBy && f.address) addressOf.set(f.reportedBy.toLowerCase(), f.address);
  }
  try {
    await ensureBuilders(addressOf.values());
  } catch {
    /* builder history is a bonus; the index stands without it */
  }
  const contributors = buildContributors(hits).map((c) => {
    const address = addressOf.get(c.handle.toLowerCase());
    return address ? { ...c, address, packages: packagesOf(address) } : c;
  });
  const ctx = trustContext(contributors);
  return {
    namespace,
    builtAt: new Date().toISOString(),
    active: active
      .filter((h) => h.finding)
      .map((h) => ({ ...h, trust: trustOf(h, ctx) }))
      .sort(byRecency),
    superseded: superseded.length,
    contributors,
    topics: buildTopics(active),
    coverage: { indexed: hits.length, total },
  };
}

function trustContext(contributors: Contributor[]) {
  return {
    levelOf: (handle: string) => findContributor(contributors, handle)?.level.id,
    packagesOf,
  };
}

/**
 * Trust scores for freshly recalled hits (chat, MCP, diagnosis). Uses the
 * cached index for levels if there is one and never waits for a cold sweep:
 * a recall must not get 5 seconds slower for a bonus.
 */
export function withTrust<T extends { active: RecalledFinding[]; superseded: RecalledFinding[] }>(
  res: T,
  namespace = defaultNamespace(),
): T {
  // Levels come from the last index that finished; a stale or missing one is
  // rebuilt in the background for the next recall.
  communityIndex(namespace).catch(() => {});
  const ctx = trustContext(settledIndex.get(namespace)?.contributors ?? []);
  const add = (h: RecalledFinding) => (h.finding ? { ...h, trust: trustOf(h, ctx) } : h);
  // Fill builder history in the background for the next recall.
  const addrs = [...res.active, ...res.superseded].flatMap((h) => [
    h.finding?.address,
    ...(h.confirmations ?? []).map((c) => c.address),
  ]);
  ensureBuilders(addrs.filter((a): a is string => Boolean(a))).catch(() => {});
  return { ...res, active: res.active.map(add), superseded: res.superseded.map(add) };
}

/** The last index that finished building, per namespace, for synchronous reads. */
const gs = globalThis as unknown as { __sabiSettled?: Map<string, CommunityIndex> };
const settledIndex: Map<string, CommunityIndex> = (gs.__sabiSettled ??= new Map());

export function communityIndex(namespace = defaultNamespace()): Promise<CommunityIndex> {
  const slot = slots.get(namespace);
  if (slot && Date.now() - slot.at < TTL_MS) return slot.promise;
  const promise = build(namespace);
  slots.set(namespace, { at: Date.now(), promise });
  promise.then((i) => settledIndex.set(namespace, i)).catch(() => {});
  // A failed sweep must not be served for the next three minutes.
  promise.catch(() => {
    if (slots.get(namespace)?.promise === promise) slots.delete(namespace);
  });
  return promise;
}

/** After a write on this instance, the next read rebuilds instead of serving stale counts. */
export function invalidateCommunity(namespace = defaultNamespace()): void {
  slots.delete(namespace);
}
