// THE ONLY FILE THAT TALKS TO THE MEMWAL SDK.
//
// Verified against @mysten-incubation/memwal 0.1.3 (see docs-notes.md):
//   MemWal.create({ key, accountId, serverUrl, namespace })
//   remember(text, ns?)            -> { job_id, status }          (202, async)
//   waitForRememberJob(job_id, o)  -> { id, job_id?, blob_id, owner, namespace }
//   rememberAndWait(text, ns?, o)  -> same as above
//   recall({ query, limit, namespace, maxDistance }) -> { results: [{ blob_id, text, distance }], total }
//   restore(ns, limit?)            -> { restored, skipped, total, ... }
//   health()                       -> { status, ... }
//   MemWalMock.create({ namespace }) implements the same surface, in memory.
//
// The relayer does embedding + Seal encryption + Walrus upload + vector search.
// We only sign requests with the delegate key. There is NO delete - storage is
// append-only, so the supersession / staleness rules live in findings.ts.

import { getEnv, type MemwalMode } from "./env";
import type { Network } from "./links";
import {
  enrich,
  resolveSupersession,
  todayISO,
  type RecalledFinding,
} from "./findings";

type MemwalModule = typeof import("@mysten-incubation/memwal");
import type {
  HealthResult,
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
  remember(text: string, namespace?: string): Promise<RememberAcceptedResult>;
  waitForRememberJob(
    jobId: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<RememberResult>;
  getRememberStatus(jobId: string): Promise<RememberJobStatus>;
  recall(params: RecallParams): Promise<RecallResult>;
  restore(namespace: string, limit?: number): Promise<RestoreResult>;
  health(): Promise<HealthResult>;
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

/** Writes: retry ONLY the cold-client 401 (rejected before acceptance). */
const withAuthRetry = <T,>(fn: () => Promise<T>) => retrying(fn, isColdAuth);
/** Reads: also retry timeouts and dropped connections - idempotent. */
const withReadRetry = <T,>(fn: () => Promise<T>) =>
  retrying(fn, (e) => isColdAuth(e) || isTransientRead(e));

export interface StoreResult {
  status: "done" | "pending";
  memory_id?: string; // Walrus blob id - the stable id recall returns
  job_id?: string;
  namespace: string;
}

/** Store one canonical finding line. Waits up to `timeoutMs` for the Walrus blob id. */
export async function storeFinding(
  text: string,
  opts: { namespace?: string; timeoutMs?: number } = {},
): Promise<StoreResult> {
  const c = await client();
  const ns = opts.namespace ?? defaultNamespace();
  const accepted = await withAuthRetry(() => c.remember(text, ns));
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
  return withReadRetry(() => c.getRememberStatus(jobId));
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
  const res = await withReadRetry(() =>
    c.recall({
      query,
      limit: Math.min(Math.max(want * 3, RECALL_OVERFETCH_MIN), RECALL_OVERFETCH_MAX),
      namespace: ns,
      maxDistance: getEnv().mode === "mock" ? MOCK_MAX_DISTANCE : MAX_DISTANCE,
    }),
  );
  const today = opts.today ?? todayISO();
  const hits = res.results.map((r) => enrich(r.blob_id, r.text, r.distance, today));
  const { active, superseded } = resolveSupersession(hits);
  return { active: active.slice(0, want), superseded, total: res.total };
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
