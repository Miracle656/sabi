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
import {
  buildContributors,
  buildTopics,
  byRecency,
  type Contributor,
  type Topic,
} from "./reputation";

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
  return {
    namespace,
    builtAt: new Date().toISOString(),
    active: active.filter((h) => h.finding).sort(byRecency),
    superseded: superseded.length,
    contributors: buildContributors(hits),
    topics: buildTopics(active),
    coverage: { indexed: hits.length, total },
  };
}

export function communityIndex(namespace = defaultNamespace()): Promise<CommunityIndex> {
  const slot = slots.get(namespace);
  if (slot && Date.now() - slot.at < TTL_MS) return slot.promise;
  const promise = build(namespace);
  slots.set(namespace, { at: Date.now(), promise });
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
