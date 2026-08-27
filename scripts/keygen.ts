// Mint a delegate keypair for a NEW Sabi writer (a community member).
//
//   pnpm keygen
//
// The member keeps the private key (MEMWAL_DELEGATE_KEY in their own .env) and
// sends ONLY the public key to the account owner, who registers it with
// `pnpm add-member --pubkey <hex> --label "@handle"`. Up to 20 delegate keys
// per account (MemWal contract limit).

import { loadEnv } from "./_env";

loadEnv();

const { generateDelegateKey } = await import("@mysten-incubation/memwal/account");

const k = await generateDelegateKey();
console.log("\nNew Sabi member delegate key\n");
console.log("  MEMWAL_DELEGATE_KEY (keep secret, put in YOUR .env):");
console.log(`    ${k.privateKey}`);
console.log("\n  public key (send this to the account owner):");
console.log(`    ${Buffer.from(k.publicKey).toString("hex")}`);
console.log("\n  derived Sui address (what the relayer sees on-chain):");
console.log(`    ${k.suiAddress}\n`);
