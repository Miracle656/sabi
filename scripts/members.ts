// List the delegate keys registered on the shared Walrus Memory account - i.e.
// who can write to the community brain. Read-only; no wallet needed.
//
//   pnpm members

import { fail, loadEnv } from "./_env";
import { discoverContract } from "./_contract";

loadEnv();

const accountId = process.env.MEMWAL_ACCOUNT_ID ?? fail("MEMWAL_ACCOUNT_ID is not set");
const { network, suiRpcUrl } = await discoverContract();

// Public fullnode JSON-RPC is deprecated; discoverContract() hands back the
// RPC url the relayer itself uses.
const rpc = suiRpcUrl;
const res = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sui_getObject",
    params: [accountId, { showContent: true, showOwner: true }],
  }),
});
const json = (await res.json()) as {
  result?: { data?: { owner?: unknown; content?: { fields?: Record<string, unknown> } } };
  error?: { message: string };
};
if (json.error) fail(json.error.message);
const fields = json.result?.data?.content?.fields ?? {};
const owner = json.result?.data?.owner;

console.log(`\nShared account ${accountId} (${network})`);
console.log(`  owner : ${JSON.stringify(owner)}`);
const active = fields.is_active ?? fields.active;
if (active !== undefined) console.log(`  active: ${active}`);

// delegate_keys is a vector of structs; shapes differ between contract versions,
// so print whatever is there rather than guessing field names.
const raw = (fields.delegate_keys ?? fields.delegates) as unknown;
const list = Array.isArray(raw) ? raw : [];
console.log(`  delegates: ${list.length}\n`);
for (const d of list) {
  const f = (d as { fields?: Record<string, unknown> }).fields ?? d;
  console.log(`  - ${JSON.stringify(f)}`);
}
console.log();
