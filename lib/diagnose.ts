// "My transaction failed": read it from Sui through Tatum, name the failure
// exactly, and look that exact failure up in community memory. Shared by the
// chat route and the MCP tools.

import { z } from "zod";
import { searchFindings } from "./memwal";
import { withTrust } from "./community";
import { findDigest, mistToSui, suiscanTx, type TxReport } from "./onchain";
import { inspectTransaction, tatumEnabled } from "./tatum";
import { recordFailure } from "./watchdog";
import type { RecalledFinding } from "./findings";

export const InspectInputSchema = z.object({
  digest: z
    .string()
    .trim()
    .min(43)
    .max(300)
    .describe("The Sui transaction digest, or an explorer URL / log line that contains it."),
});
export type InspectInput = z.infer<typeof InspectInputSchema>;

export type InspectResult =
  | {
      status: "ok";
      tx: Omit<TxReport, "calls"> & { calls: string[]; moreCalls: number };
      gas_sui?: string;
      explorer: string;
      /** True when the failure was remembered against one of the member's watched addresses. */
      recorded: boolean;
      /** Community findings recalled for the failure signature. */
      active: RecalledFinding[];
      superseded: RecalledFinding[];
      note?: string;
    }
  | { status: "error"; error: string };

const SHOWN_CALLS = 6;

export const WatchInputSchema = z.object({
  address: z.string().trim().describe("The Sui address to watch (0x...), e.g. the project's deployer or treasury."),
  label: z.string().trim().max(60).optional().describe("A short name for it, e.g. 'mainnet deployer'."),
});

export const RuleInputSchema = z.object({
  action: z
    .enum(["escalate", "mute", "set", "clear"])
    .describe("escalate = always flag; mute = stop flagging; set = change a threshold; clear = remove the rule on that target."),
  target: z
    .string()
    .trim()
    .describe(
      "What the rule matches: kind:burn_spike | kind:low_runway | kind:new_failure | kind:repeat_failure | text:<words, e.g. enoki or MoveAbort 101> | address:<0x..>. For set: spike_ratio=<n> or runway_days=<days>.",
    ),
  reason: z
    .string()
    .trim()
    .max(160)
    .describe("The user's own words for why, e.g. 'rate limits are expected on our free RPC'."),
});

/**
 * `member`: the signed-in handle. When the transaction failed from one of
 * their watched addresses, the failure is remembered for their watchdog.
 */
export async function inspectAction(
  input: InspectInput,
  today: string,
  member?: string,
): Promise<InspectResult> {
  if (!tatumEnabled()) {
    return { status: "error", error: "On-chain reads are not configured on this instance (TATUM_API_KEY)." };
  }
  const digest = findDigest(input.digest);
  if (!digest) {
    return { status: "error", error: "That does not contain a Sui transaction digest (43-44 base58 characters)." };
  }
  try {
    const tx = await inspectTransaction(digest);
    if (!tx) {
      return { status: "error", error: `No transaction ${digest} on Sui mainnet. Check the digest, or whether it ran on testnet.` };
    }
    // Recall on the exact failure, plus the modules involved: a finding about
    // this abort will name the code and the function.
    const modules = [...new Set(tx.calls.map((c) => c.split("::").slice(1).join("::")))].slice(0, 4);
    const query = [tx.signature, ...modules].join(" ");
    const recalled = withTrust(await searchFindings(query, { limit: 5, today }));
    let recorded = false;
    if (member) {
      try {
        recorded = await recordFailure(member, tx);
      } catch {
        /* the diagnosis stands even if the watchdog write fails */
      }
    }
    return {
      status: "ok",
      tx: {
        ...tx,
        calls: tx.calls.slice(0, SHOWN_CALLS),
        moreCalls: Math.max(0, tx.calls.length - SHOWN_CALLS),
      },
      gas_sui: tx.gas ? mistToSui(tx.gas.net) : undefined,
      explorer: suiscanTx(tx.digest),
      recorded,
      active: recalled.active,
      superseded: recalled.superseded,
      note: tx.ok
        ? "This transaction succeeded on-chain; if something still looks wrong, the problem is off-chain (indexer, UI, wallet)."
        : recalled.active.length === 0
          ? `No community finding for ${tx.signature} yet. Explain the failure from the abort location; if the user fixes it, offer to store the fix with evidence_tx set to ${tx.digest}.`
          : undefined,
    };
  } catch (err) {
    return { status: "error", error: `Couldn't read the transaction through Tatum: ${err instanceof Error ? err.message : String(err)}` };
  }
}
