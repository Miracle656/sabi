// Register a member's delegate public key on the SHARED Walrus Memory account.
// Only the account OWNER wallet can do this (MemWal contract: add_delegate_key).
//
//   pnpm add-member --pubkey <hex public key from pnpm keygen> --label "@handle"
//   pnpm add-member --pubkey ... --label ... --remove      # revoke instead
//
// Needs in .env:
//   MEMWAL_OWNER_SUI_KEY   bech32 suiprivkey1... of the wallet that created the account
//   MEMWAL_ACCOUNT_ID      the shared account
//   MEMWAL_RELAYER_URL     (package id + network are discovered from its /config)
// Optional overrides: MEMWAL_PACKAGE_ID, MEMWAL_REGISTRY_ID, SUI_NETWORK.
//
// NOTE: we pass our own SuiGrpcClient. With @mysten/sui >= 2.6 the SDK's
// fallback `new SuiClient()` no longer exists (the same break that took down
// Cortex's backend), so the client must be supplied explicitly.

import { arg, fail, flag, loadEnv } from "./_env";
import { discoverContract } from "./_contract";

loadEnv();

const pubkey = arg("pubkey") ?? fail("--pubkey <hex> is required (from `pnpm keygen`)");
const label = arg("label") ?? fail('--label "@handle" is required');
const ownerKey = process.env.MEMWAL_OWNER_SUI_KEY ?? fail("MEMWAL_OWNER_SUI_KEY is not set");
const accountId = process.env.MEMWAL_ACCOUNT_ID ?? fail("MEMWAL_ACCOUNT_ID is not set");

const { packageId, registryId, network } = await discoverContract();
const { SuiGrpcClient } = await import("@mysten/sui/grpc");
const { addDelegateKey, removeDelegateKey } = await import("@mysten-incubation/memwal/account");

const suiClient = new SuiGrpcClient({
  network,
  baseUrl: `https://fullnode.${network}.sui.io:443`,
});

console.log(`\n${flag("remove") ? "Removing" : "Adding"} delegate on ${network}`);
console.log(`  account : ${accountId}`);
console.log(`  package : ${packageId}`);
console.log(`  registry: ${registryId}`);
console.log(`  pubkey  : ${pubkey}`);
console.log(`  label   : ${label}\n`);

if (flag("remove")) {
  const res = await removeDelegateKey({
    packageId,
    registryId,
    accountId,
    publicKey: pubkey,
    suiPrivateKey: ownerKey,
    suiClient,
    suiNetwork: network,
  });
  console.log(`✓ removed. tx ${res.digest}\n`);
} else {
  const res = await addDelegateKey({
    packageId,
    registryId,
    accountId,
    publicKey: pubkey,
    label,
    suiPrivateKey: ownerKey,
    suiClient,
    suiNetwork: network,
  });
  console.log(`✓ added. tx ${res.digest}`);
  console.log(`  delegate sui address: ${res.suiAddress}\n`);
  console.log("The member can now run Sabi with their own MEMWAL_DELEGATE_KEY and this MEMWAL_ACCOUNT_ID.\n");
}
