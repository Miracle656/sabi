// THE ONLY FILE THAT TALKS TO THE MEMWAL SDK.
//
// Verified against @mysten-incubation/memwal 0.1.9 (see docs-notes.md):
//   MemWal.create({ key, accountId, serverUrl, namespace })
//   remember(text, ns?, { idempotencyKey }) -> { job_id, status }  (202, async)
//   waitForRememberJob(job_id, o)  -> { id, job_id?, blob_id, owner, namespace }
//   recall({ query, limit, namespace, maxDistance, sort })
//                                  -> { results: [{ blob_id, text, distance, created_at? }], total }
//   listMemories({ cursor, namespace }) -> metadata only (ids, dates), no text; live client only
//   restore(ns, limit?)            -> { restored, skipped, total, ... }
//   health()                       -> { status, ... }
//   MemWalMock.create({ namespace }) implements the same surface (minus listMemories), in memory.
//
// The relayer does embedding + Seal encryption + Walrus upload + vector search.
// We only sign requests with the delegate key. There is NO delete - storage is
// append-only, so the supersession / staleness rules live in findings.ts.

import { getEnv, type MemwalMode } from "./env";
import type { Network } from "./links";
import { createHash } from "node:crypto";
import {
  CATEGORIES,
  enrich,
  resolveHits,
  todayISO,
  type Category,
  type RecalledFinding,
} from "./findings";

type MemwalModule = typeof import("@mysten-incubation/memwal");
import type {
  HealthResult,
  ListMemoriesOptions,
  MemoriesResult,
  NamespacesResult,
  RecallParams,
  RecallResult,
  RememberAcceptedResult,
  RememberJobStatus,
  RememberResult,
  RestoreResult,
} from "@mysten-incubation/memwal";

// The slice of the SDK surface Sabi uses. Both MemWal and MemWalMock satisfy it;
// typing against this (instead of a union of the two classes) keeps the
// overloaded `recall` callable.
interface MemoryClient {
  remember(
    text: string,
    namespace?: string,
    options?: { idempotencyKey?: string },
  ): Promise<RememberAcceptedResult>;
  waitForRememberJob(
    jobId: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<RememberResult>;
  getRememberStatus(jobId: string): Promise<RememberJobStatus>;
  recall(params: RecallParams): Promise<RecallResult>;
  restore(namespace: string, limit?: number): Promise<RestoreResult>;
  health(): Promise<HealthResult>;
  /** Live client only: the mock has no inventory walk. */
  listMemories?(options?: ListMemoriesOptions): Promise<MemoriesResult>;
  listNamespaces?(options?: { cursor?: string; limit?: number }): Promise<NamespacesResult>;
}
type AnyClient = MemoryClient;

// Drop recalled rows at/above this cosine distance. The relayer returns top-K
// with no floor, so on a small namespace it will happily return unrelated rows.
const MAX_DISTANCE = 0.7;
// The mock ranks by token overlap (1 - matched/query tokens), so a natural
// language question rarely gets under 0.7. Loosen it there; it never ships.
const MOCK_MAX_DISTANCE = 0.95;
const DEFAULT_RECALL_LIMIT = 8;
const RECALL_OVERFETCH_MIN = 24;
const RECALL_OVERFETCH_MAX = 60;
const REMEMBER_TIMEOUT_MS = 60_000;

interface Cache {
  client?: Promise<AnyClient>;
  network?: Promise<Network>;
  restored?: Set<string>;
}
// Survive Next dev HMR so the mock keeps its memories between requests.
const g = globalThis as unknown as { __sabi?: Cache };
const cache: Cache = (g.__sabi ??= {});


async function load(): Promise<MemwalModule> {
  return import("@mysten-incubation/memwal");
}

async function client(): Promise<AnyClient> {
  if (!cache.client) {
    cache.client = (async () => {
      const env = getEnv();
      const mod = await load();
      if (env.mode === "mock") {
        // Seed the mock from seed-findings.json so MEMWAL_MODE=mock really does
        // "run the full UI" — recall returns cards, the first-run screen has
        // rows. Nothing here touches Walrus.
        return mod.MemWalMock.create({
          namespace: env.namespace,
          initialMemories: await mockSeed(env.namespace),
        }) as MemoryClient;
      }
      if (!env.delegateKey || !env.accountId) {
        throw new Error(
          "MemWal is not configured: set MEMWAL_DELEGATE_KEY and MEMWAL_ACCOUNT_ID (or MEMWAL_MODE=mock).",
        );
      }
      return mod.MemWal.create({
        key: env.delegateKey,
        accountId: env.accountId,
        serverUrl: env.relayerUrl,
        namespace: env.namespace,
      }) as MemoryClient;
    })();
    cache.client.catch(() => {
      cache.client = undefined;
    });
  }
  return cache.client;
}

/**
 * Mock-only: turn seed-findings.json into canonical lines the mock can recall.
 * Best-effort — a missing or malformed file just means an empty mock brain.
 */
async function mockSeed(namespace: string): Promise<{ text: string; namespace: string }[]> {
  try {
    const [{ readFile }, { resolve }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const raw = await readFile(resolve(process.cwd(), "seed-findings.json"), "utf8");
    const parsed = JSON.parse(raw) as { findings?: unknown[] } | unknown[];
    const items = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    const { FindingInputSchema, formatFinding, toFinding } = await import("./findings");
    const out: { text: string; namespace: string }[] = [];
    for (const item of items) {
      const ok = FindingInputSchema.safeParse(item);
      if (!ok.success) continue;
      out.push({
        // Attribute seeds to @seed, never to the operator: they are examples,
        // not findings this person verified.
        text: formatFinding(toFinding(ok.data, { defaultReporter: "@seed" })),
        namespace,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function mode(): MemwalMode {
  return getEnv().mode;
}

export function defaultNamespace(): string {
  return getEnv().namespace;
}

export type { Network };

/**
 * Which Sui network the relayer is on (it tells us via GET /config). Used only
 * to build explorer links; falls back to mainnet if the relayer is unreachable.
 */
export async function network(): Promise<Network> {
  if (!cache.network) {
    cache.network = (async () => {
      const env = getEnv();
      if (env.mode === "mock") return "mainnet";
      const res = await fetch(`${env.relayerUrl.replace(/\/$/, "")}/config`, {
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await res.json()) as { network?: string };
      return body.network === "testnet" ? "testnet" : "mainnet";
    })();
    // A failed probe must not pin the answer for the process lifetime.
    cache.network.catch(() => {
      cache.network = undefined;
    });
  }
  try {
    return await cache.network;
  } catch {
    // Probe failed: guess from the relayer URL rather than asserting mainnet -
    // a staging relayer with a dead /config would otherwise get mainnet
    // explorer links for testnet blobs.
    return /staging|testnet/i.test(getEnv().relayerUrl) ? "testnet" : "mainnet";
  }
}

/**
 * The relayer 401s the FIRST signed request it sees from a cold client while it
 * loads the account from chain into its cache (observed on both mainnet and
 * staging, 2026-08-27), then accepts the retry. On serverless every cold start
 * replays that. One retry, only on 401 - a second 401 is a real credential
 * problem and must surface.
 */
function isColdAuth(err: unknown): boolean {
  return (err as { status?: number }).status === 401;
}
// Under load the relayer also times out ("This operation was aborted") and
// drops connections. Those are safe to retry ONLY for reads: a timed-out
// remember() may have been accepted server-side, and retrying it is exactly
// how the namespace got a duplicate finding on 2026-08-27.
function isTransientRead(err: unknown): boolean {
  const msg = String((err as { message?: string }).message ?? err);
  return /aborted|abort|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(msg);
}

async function retrying<T>(
  fn: () => Promise<T>,
  retriable: (err: unknown) => boolean,
): Promise<T> {
  // Warm-up measured at ~5s in production; the extra 8s wait brackets the
  // slower blips seen under hackathon-evening load. A failure after all three
  // is real and must surface.
  const waits = [1_500, 3_500, 8_000];
  for (const wait of waits) {
    try {
      return await fn();
    } catch (err) {
      if (!retriable(err)) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return fn();
}

/**
 * Reads, and writes that carry an idempotency key: also retry timeouts and
 * dropped connections. Since 0.1.9 the relayer dedupes a repeated key, so a
 * retried write that had already landed collapses onto the original job
 * instead of storing the duplicate it stored on 2026-08-27.
 */
const withRetry = <T,>(fn: () => Promise<T>) =>
  retrying(fn, (e) => isColdAuth(e) || isTransientRead(e));

export interface StoreResult {
  status: "done" | "pending";
  memory_id?: string; // Walrus blob id - the stable id recall returns
  job_id?: string;
  namespace: string;
}

/**
 * Store one canonical finding line. Waits up to `timeoutMs` for the Walrus blob id.
 * The idempotency key defaults to a hash of the text, so the same line stored
 * twice - a retry, a double click, a second serverless instance - lands once.
 */
export async function storeFinding(
  text: string,
  opts: { namespace?: string; timeoutMs?: number; idempotencyKey?: string } = {},
): Promise<StoreResult> {
  const c = await client();
  const ns = opts.namespace ?? defaultNamespace();
  const idempotencyKey =
    opts.idempotencyKey ?? createHash("sha256").update(text).digest("hex").slice(0, 48);
  const accepted = await withRetry(() => c.remember(text, ns, { idempotencyKey }));
  try {
    const done = await c.waitForRememberJob(accepted.job_id, {
      timeoutMs: opts.timeoutMs ?? REMEMBER_TIMEOUT_MS,
      pollIntervalMs: 1_000,
    });
    return { status: "done", memory_id: done.blob_id, job_id: accepted.job_id, namespace: ns };
  } catch (err) {
    if (/time(d )?out/i.test(String(err))) {
      return { status: "pending", job_id: accepted.job_id, namespace: ns };
    }
    throw err;
  }
}

/** One-shot status of a remember job; served by GET /api/jobs/[id] so the UI can finish a "pending" store. */
export async function jobStatus(jobId: string) {
  const c = await client();
  // Read-only: a transient failure here would make a landed write look failed.
  return withRetry(() => c.getRememberStatus(jobId));
}

/**
 * Semantic search over the namespace, with supersession + staleness resolved.
 * The relayer only searches its LOCAL index; after a relayer restart or writes
 * from another delegate key the index can lag Walrus, so the first search in a
 * process triggers a one-shot restore() in the background.
 */
export async function searchFindings(
  query: string,
  opts: { limit?: number; namespace?: string; today?: string } = {},
): Promise<{ active: RecalledFinding[]; superseded: RecalledFinding[]; total: number }> {
  const c = await client();
  const ns = opts.namespace ?? defaultNamespace();
  warmIndex(c, ns);
  const want = opts.limit ?? DEFAULT_RECALL_LIMIT;
  // Supersession can only be resolved among rows we actually recalled: a new
  // finding that retracts an old one is worded differently and may rank below
  // the old row for the original-symptom query. Over-fetch, resolve, then trim
  // to what the caller asked for.
  const res = await withRetry(() =>
    c.recall({
      query,
      limit: Math.min(Math.max(want * 3, RECALL_OVERFETCH_MIN), RECALL_OVERFETCH_MAX),
      namespace: ns,
      maxDistance: getEnv().mode === "mock" ? MOCK_MAX_DISTANCE : MAX_DISTANCE,
    }),
  );
  const today = opts.today ?? todayISO();
  const hits = res.results.map((r) => enrich(r.blob_id, r.text, r.distance, today, r.created_at));
  const { active, superseded } = resolveHits(hits, today);
  return { active: active.slice(0, want), superseded, total: res.total };
}

/**
 * Look one memory up by id. There is no get-by-id API, so this recalls around
 * `hint` (the finding's subject or text) with no distance floor and picks the
 * id out. Returns the hit with its confirmations folded in, or null.
 */
export async function findMemory(
  id: string,
  hint: string,
  opts: { namespace?: string; today?: string } = {},
): Promise<RecalledFinding | null> {
  const c = await client();
  const ns = opts.namespace ?? defaultNamespace();
  const today = opts.today ?? todayISO();
  const res = await withRetry(() => c.recall({ query: hint, limit: 100, namespace: ns }));
  const hits = res.results.map((r) => enrich(r.blob_id, r.text, r.distance, today, r.created_at));
  const { active, superseded } = resolveHits(hits, today);
  return [...active, ...superseded].find((h) => h.memory_id === id) ?? null;
}

// One query per topic, worded like the findings that live there. Recall needs
// a query, so the sweep asks every topic for its newest matches and unions them.
const SWEEP_QUERIES: Record<Category, string> = {
  CARRIER: "mobile carrier network operator data connection blocked ISP",
  PAYMENTS: "payments API payout transfer checkout bank card webhook",
  WALLET: "wallet connect sign transaction WalletConnect zkLogin extension",
  RPC: "RPC node fullnode endpoint rate limit API key gas",
  TOOLING: "SDK CLI build tooling library package version compile error",
  REGULATORY: "regulation compliance KYC license policy requirement",
  EXCHANGE: "exchange on-ramp off-ramp deposit withdrawal liquidity",
  INFRA: "hosting server deploy cloud infrastructure DNS storage indexer",
};
const SWEEP_LIMIT = 100;
const SWEEP_CONCURRENCY = 8;

export interface Sweep {
  hits: RecalledFinding[];
  /** Memories the relayer lists for this namespace, when it can list (null = unknown). */
  total: number | null;
}

/**
 * Pull as much of the namespace as recall will give: one newest-first recall
 * per topic, unioned by memory id. listMemories (metadata only) counts what
 * exists, so callers can say how much of the namespace the sweep covered.
 */
export async function sweepNamespace(
  opts: { namespace?: string; today?: string } = {},
): Promise<Sweep> {
  const c = await client();
  const ns = opts.namespace ?? defaultNamespace();
  const today = opts.today ?? todayISO();
  warmIndex(c, ns);
  const seen = new Map<string, RecalledFinding>();
  // All topics at once: latency is per round-trip, not per row.
  const queries = CATEGORIES.map((cat) => SWEEP_QUERIES[cat]);
  for (let i = 0; i < queries.length; i += SWEEP_CONCURRENCY) {
    const batch = await Promise.all(
      queries
        .slice(i, i + SWEEP_CONCURRENCY)
        .map((query) =>
          withRetry(() => c.recall({ query, limit: SWEEP_LIMIT, namespace: ns, sort: "recent" })),
        ),
    );
    for (const res of batch) {
      for (const r of res.results) {
        if (!seen.has(r.blob_id)) {
          seen.set(r.blob_id, enrich(r.blob_id, r.text, r.distance, today, r.created_at));
        }
      }
    }
  }
  return { hits: [...seen.values()], total: await countMemories(c, ns) };
}

export interface RawMemory {
  memory_id: string;
  text: string;
  created_at?: string;
}

/**
 * Newest-first raw lines from any namespace, no distance floor and no finding
 * parsing. For small structured namespaces (a member's watchdog memory) where
 * the caller wants everything, not the best semantic match.
 */
export async function recallLines(
  namespace: string,
  query: string,
  limit = 100,
): Promise<RawMemory[]> {
  const c = await client();
  const res = await withRetry(() => c.recall({ query, limit, namespace, sort: "recent" }));
  return res.results.map((r) => ({
    memory_id: r.blob_id,
    text: r.text,
    ...(r.created_at ? { created_at: r.created_at } : {}),
  }));
}

/** Names of every namespace on the account starting with `prefix` (live client only). */
export async function namespacesWithPrefix(prefix: string): Promise<string[]> {
  const c = await client();
  if (!c.listNamespaces) return [];
  const out: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await withRetry(() => c.listNamespaces!({ cursor, limit: 500 }));
    for (const ns of res.namespaces) if (ns.name.startsWith(prefix)) out.push(ns.name);
    if (!res.has_more) break;
    cursor = res.next_cursor ?? undefined;
  }
  return out;
}

/** How many memories the namespace holds, or null when the client cannot list. */
async function countMemories(c: AnyClient, ns: string): Promise<number | null> {
  if (!c.listMemories) return null;
  try {
    let cursor: string | undefined;
    let count = 0;
    // The namespace filter is client-side, so walk until has_more says stop.
    for (let page = 0; page < 40; page++) {
      const res = await withRetry(() => c.listMemories!({ cursor, namespace: ns, limit: 500 }));
      count += res.memories.length;
      if (!res.has_more) return count;
      cursor = res.next_cursor ?? undefined;
    }
    return null;
  } catch {
    // A relayer without the list route: coverage is simply unknown.
    return null;
  }
}

function warmIndex(c: AnyClient, ns: string) {
  cache.restored ??= new Set();
  if (cache.restored.has(ns) || getEnv().mode === "mock") return;
  cache.restored.add(ns);
  c.restore(ns, 50).catch(() => {
    cache.restored?.delete(ns);
  });
}

/** Rebuild the relayer's index for a namespace from the durable Walrus blobs. */
export async function restoreNamespace(namespace?: string, limit = 50) {
  const c = await client();
  return c.restore(namespace ?? defaultNamespace(), limit);
}

export async function health() {
  const c = await client();
  return c.health();
}

/**
 * When a store fails, ask the relayer whether writes are even possible right
 * now. `health()` exposes `write_ready:false` during platform-side outages
 * (seen live 2026-08-27: "Memory encryption backend is unavailable") - an
 * honest "the platform is down, your finding is not lost" beats a scary
 * credentials error.
 */
export async function explainStoreFailure(err: unknown): Promise<string> {
  const base = err instanceof Error ? err.message : String(err);
  if (mode() === "mock") return base;
  try {
    const h = (await health()) as { write_ready?: boolean };
    if (h.write_ready === false) {
      return `The Walrus Memory relayer is temporarily not accepting writes (write_ready:false - platform-side outage, not your credentials). Nothing was stored; keep the finding and retry shortly. Underlying error: ${base}`;
    }
  } catch {
    /* health itself unreachable - the base error stands */
  }
  return base;
}
