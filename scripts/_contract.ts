// Resolve the MemWal contract ids for whichever network the configured relayer
// is on. The relayer publishes its package id and network at GET /config; the
// registry id is not in /config, so it comes from env or the documented public
// deployments (docs.wal.app/walrus-memory/contract/overview).

export type Net = "mainnet" | "testnet";

const PUBLIC_REGISTRY: Record<Net, string> = {
  mainnet: "0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd",
  testnet: "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437",
};
const PUBLIC_PACKAGE: Record<Net, string> = {
  mainnet: "0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6",
  testnet: "0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6",
};

export async function discoverContract(): Promise<{
  packageId: string;
  registryId: string;
  network: Net;
  suiRpcUrl: string;
}> {
  // Same alias as lib/env.ts. Reading only MEMWAL_RELAYER_URL here silently
  // pointed testnet credentials at the MAINNET relayer, which then reported a
  // mainnet package id and a mainnet network.
  const relayer = (
    process.env.MEMWAL_SERVER_URL ??
    process.env.MEMWAL_RELAYER_URL ??
    "https://relayer.memory.walrus.xyz"
  ).replace(/\/$/, "");
  let network: Net = process.env.SUI_NETWORK === "testnet" ? "testnet" : "mainnet";
  let relayerPackage: string | undefined;
  let relayerRpc: string | undefined;
  try {
    const res = await fetch(`${relayer}/config`, { signal: AbortSignal.timeout(10_000) });
    const cfg = (await res.json()) as {
      packageId?: string;
      network?: string;
      suiRpcUrl?: string;
    };
    if (cfg.network === "testnet" || cfg.network === "mainnet") network = cfg.network;
    if (typeof cfg.packageId === "string") relayerPackage = cfg.packageId;
    if (typeof cfg.suiRpcUrl === "string") relayerRpc = cfg.suiRpcUrl;
  } catch {
    console.warn(`(could not read ${relayer}/config; falling back to env / documented ids)`);
  }
  // The relayer is the authority on the deployment it actually talks to, so its
  // packageId beats the documented table. An explicit env override still wins.
  const packageId = process.env.MEMWAL_PACKAGE_ID ?? relayerPackage ?? PUBLIC_PACKAGE[network];
  const registryId = process.env.MEMWAL_REGISTRY_ID ?? PUBLIC_REGISTRY[network];
  // Public `fullnode.<net>.sui.io` JSON-RPC is deprecated and now answers
  // "Method not found", so prefer the RPC url the relayer advertises.
  const suiRpcUrl =
    process.env.SUI_RPC_URL ?? relayerRpc ?? `https://fullnode.${network}.sui.io:443`;
  return { packageId, registryId, network, suiRpcUrl };
}
