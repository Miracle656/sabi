// "My transaction failed": read it from Sui through Tatum, name the failure
// exactly, and look that exact failure up in community memory. Shared by the
// chat route and the MCP tools.

import { z } from "zod";
import { searchFindings } from "./memwal";
import { findDigest, mistToSui, suiscanTx, type TxReport } from "./onchain";
import { inspectTransaction, tatumEnabled } from "./tatum";
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
      /** Community findings recalled for the failure signature. */
      active: RecalledFinding[];
      superseded: RecalledFinding[];
      note?: string;
    }
  | { status: "error"; error: string };

const SHOWN_CALLS = 6;

export async function inspectAction(input: InspectInput, today: string): Promise<InspectResult> {
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
    const recalled = await searchFindings(query, { limit: 5, today });
    return {
      status: "ok",
      tx: {
        ...tx,
        calls: tx.calls.slice(0, SHOWN_CALLS),
        moreCalls: Math.max(0, tx.calls.length - SHOWN_CALLS),
      },
      gas_sui: tx.gas ? mistToSui(tx.gas.net) : undefined,
      explorer: suiscanTx(tx.digest),
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
