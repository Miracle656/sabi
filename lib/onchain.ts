// What Sabi reads off Sui, as plain data. Pure: no SDK, no I/O - lib/tatum.ts
// fetches, this file interprets, so the interpretation is unit-testable.
//
// The point of reading a transaction is to turn "my tx failed" into a precise
// error signature (abort code + package::module::function) that community
// memory can be searched for, instead of a vague description of the symptom.

/** Sui transaction digests are base58, 32 bytes -> 43 or 44 characters. */
const DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

export function isDigest(s: string): boolean {
  return DIGEST.test(s.trim());
}

export function isAddress(s: string): boolean {
  return ADDRESS.test(s.trim());
}

/** Pull the first transaction digest out of free text (a pasted explorer URL, an error log). */
export function findDigest(text: string): string | null {
  const m = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{43,44})(?![1-9A-HJ-NP-Za-km-z])/.exec(text);
  return m ? m[1] : null;
}

export interface TxFailure {
  /** MOVE_ABORT, INSUFFICIENT_GAS, ... as the node reports it. */
  kind: string;
  abortCode?: string;
  package?: string;
  module?: string;
  function?: string;
  /** Index of the PTB command that failed. */
  command?: number;
  description?: string;
}

export interface TxReport {
  digest: string;
  ok: boolean;
  sender?: string;
  /** Gas in MIST. `net` = computation + storage - rebate (what the sender actually paid). */
  gas?: { computation: string; storage: string; rebate: string; net: string };
  /** Every Move call in the transaction, `0xpkg::module::function`. */
  calls: string[];
  failure?: TxFailure;
  /** One line that names the failure precisely; also the query for community memory. */
  signature: string;
}

/** Shorten a 0x id for display: 0x1234…abcd. Framework packages stay whole. */
export function shortId(id: string): string {
  const hex = id.replace(/^0x/, "").replace(/^0+(?=.)/, "");
  if (hex.length <= 4) return `0x${hex}`;
  return `0x${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

interface ProtoJsonTx {
  digest?: string;
  transaction?: {
    sender?: string;
    kind?: {
      programmableTransaction?: {
        commands?: { moveCall?: { package?: string; module?: string; function?: string } }[];
      };
    };
  };
  effects?: {
    status?: {
      success?: boolean;
      error?: {
        kind?: string;
        command?: string | number;
        description?: string;
        abort?: {
          abortCode?: string | number;
          location?: { package?: string; module?: string; functionName?: string };
        };
      };
    };
    gasUsed?: { computationCost?: string; storageCost?: string; storageRebate?: string };
  };
}

/** Interpret the protobuf-JSON form of an executed transaction (Sui gRPC v2). */
export function parseTransaction(raw: unknown, digest: string): TxReport {
  const pj = (raw ?? {}) as ProtoJsonTx;
  const status = pj.effects?.status;
  const calls = (pj.transaction?.kind?.programmableTransaction?.commands ?? [])
    .map((c) => c.moveCall)
    .filter((m): m is { package: string; module: string; function: string } =>
      Boolean(m?.package && m.module && m.function),
    )
    .map((m) => `${m.package}::${m.module}::${m.function}`);

  const g = pj.effects?.gasUsed;
  const gas = g
    ? {
        computation: big(g.computationCost).toString(),
        storage: big(g.storageCost).toString(),
        rebate: big(g.storageRebate).toString(),
        net: (big(g.computationCost) + big(g.storageCost) - big(g.storageRebate)).toString(),
      }
    : undefined;

  const report: TxReport = {
    digest: pj.digest ?? digest,
    ok: status?.success !== false,
    sender: pj.transaction?.sender,
    gas,
    calls,
    signature: "",
  };

  const err = status?.success === false ? status.error : undefined;
  if (err) {
    const loc = err.abort?.location;
    report.failure = {
      kind: err.kind ?? "UNKNOWN",
      ...(err.abort?.abortCode !== undefined ? { abortCode: String(err.abort.abortCode) } : {}),
      ...(loc?.package ? { package: loc.package } : {}),
      ...(loc?.module ? { module: loc.module } : {}),
      ...(loc?.functionName ? { function: loc.functionName } : {}),
      ...(err.command !== undefined && !Number.isNaN(Number(err.command))
        ? { command: Number(err.command) }
        : {}),
      ...(err.description ? { description: err.description } : {}),
    };
  }
  report.signature = signatureOf(report);
  return report;
}

/**
 * "MoveAbort 101 in 0xfa55…9ae1::m::z" - the exact words a finding about this
 * failure would contain, so semantic recall lands on it.
 */
export function signatureOf(r: Pick<TxReport, "ok" | "failure" | "calls">): string {
  const f = r.failure;
  if (r.ok || !f) {
    return r.calls.length ? `successful transaction calling ${r.calls.map(callName).join(", ")}` : "successful transaction";
  }
  if (f.kind === "MOVE_ABORT" && f.abortCode !== undefined) {
    const where = [f.package ? shortId(f.package) : null, f.module, f.function].filter(Boolean).join("::");
    return `MoveAbort ${f.abortCode}${where ? ` in ${where}` : ""}`;
  }
  return f.kind.toLowerCase().replace(/_/g, " ") + (f.description ? `: ${f.description.slice(0, 120)}` : "");
}

function callName(full: string): string {
  const [pkg, mod, fn] = full.split("::");
  return `${shortId(pkg)}::${mod}::${fn}`;
}

/** MIST -> SUI with up to 4 decimals, for people. */
export function mistToSui(mist: string | bigint): string {
  const v = typeof mist === "bigint" ? mist : big(mist);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function suiscanTx(digest: string): string {
  return `https://suiscan.xyz/mainnet/tx/${encodeURIComponent(digest)}`;
}

export function suiscanAccount(address: string): string {
  return `https://suiscan.xyz/mainnet/account/${encodeURIComponent(address)}`;
}
