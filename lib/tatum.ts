// THE ONLY FILE THAT TALKS TO TATUM.
//
// Sui reads go through Tatum's Sui gateway over native gRPC (Sui JSON-RPC is
// deprecated, and Tatum's JSON-RPC endpoint for Sui answers 404 as of
// 2026-10-30). The gateway speaks HTTP/2 gRPC, not gRPC-web, so the SDK's
// SuiGrpcClient gets a @grpc/grpc-js transport instead of its default.
//
// Verified against the gateway on 2026-10-30:
//   ledgerService.getServiceInfo        -> chain "mainnet", checkpoint height
//   getTransaction({ digest, include })  -> protoJson with sender, PTB commands,
//                                          effects.status (abort code + location), gasUsed
//   getBalance({ owner })                -> SUI balance in MIST
//   listOwnedObjects({ owner, type })    -> e.g. 0x2::package::UpgradeCap = packages published
// Tatum's Data API (transaction history by address) does NOT list Sui.

import { getEnv } from "./env";
import { parseTransaction, type TxReport } from "./onchain";

type SuiGrpc = import("@mysten/sui/grpc").SuiGrpcClient;

const g = globalThis as unknown as { __sabiTatum?: Promise<SuiGrpc> };

export function tatumEnabled(): boolean {
  return Boolean(getEnv().tatumKey);
}

async function client(): Promise<SuiGrpc> {
  if (!g.__sabiTatum) {
    g.__sabiTatum = (async () => {
      const env = getEnv();
      if (!env.tatumKey) throw new Error("On-chain reads are off: set TATUM_API_KEY.");
      const [{ ChannelCredentials }, { GrpcTransport }, { SuiGrpcClient }] = await Promise.all([
        import("@grpc/grpc-js"),
        import("@protobuf-ts/grpc-transport"),
        import("@mysten/sui/grpc"),
      ]);
      const transport = new GrpcTransport({
        host: env.tatumSuiGrpc,
        channelCredentials: ChannelCredentials.createSsl(),
        meta: { "x-api-key": env.tatumKey },
        timeout: 15_000,
      });
      return new SuiGrpcClient({ network: "mainnet", transport });
    })();
    g.__sabiTatum.catch(() => {
      g.__sabiTatum = undefined;
    });
  }
  return g.__sabiTatum;
}

/**
 * Tatum's free plan answers bursts with HTTP 429 (surfaced as gRPC UNAVAILABLE).
 * All calls here are reads, so retrying is always safe.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [600, 1_500, 3_500];
  for (const wait of waits) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code !== "UNAVAILABLE" && !/429|unavailable|ECONNRESET/i.test(String(e.message))) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return fn();
}

/** gRPC status for "no such transaction/object". */
function notFound(err: unknown): boolean {
  const e = err as { code?: string | number; message?: string };
  return e.code === "NOT_FOUND" || e.code === 5 || /not ?found/i.test(String(e.message));
}

/** Read one transaction from mainnet and interpret it. Null when it does not exist. */
export async function inspectTransaction(digest: string): Promise<TxReport | null> {
  const c = await client();
  try {
    const res = (await withRetry(() =>
      c.getTransaction({ digest, include: { effects: true, transaction: true, protoJson: true } }),
    )) as unknown as { protoJson?: unknown };
    return parseTransaction(res.protoJson, digest);
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
}

/** SUI balance of an address, in MIST. */
export async function suiBalance(address: string): Promise<bigint> {
  const c = await client();
  const res = await withRetry(() => c.getBalance({ owner: address }));
  return BigInt(res.balance.balance);
}

export interface BuilderSignal {
  address: string;
  /** UpgradeCaps held = Move packages this address published (and still controls). Capped at 50. */
  packages: number;
}

/** How much this address has actually shipped on Sui, as far as the chain can say. */
export async function builderSignal(address: string): Promise<BuilderSignal> {
  const c = await client();
  const res = await withRetry(() =>
    c.listOwnedObjects({ owner: address, type: "0x2::package::UpgradeCap", limit: 50 }),
  );
  return { address, packages: res.objects.length };
}
