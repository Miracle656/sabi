// Who has shipped on Sui: Move packages published per address (UpgradeCaps
// held), read through Tatum and cached per server instance. Trust scores read
// it synchronously; anything not cached yet simply earns no builder bonus
// until a later read fills it in.

import { builderSignal, tatumEnabled } from "./tatum";

const TTL_MS = 6 * 3_600_000;

const g = globalThis as unknown as { __sabiBuilders?: Map<string, { packages: number; at: number }> };
const cache: Map<string, { packages: number; at: number }> = (g.__sabiBuilders ??= new Map());

/** Packages published by `address`, if known; undefined when not read yet. */
export function packagesOf(address: string): number | undefined {
  const hit = cache.get(address.toLowerCase());
  return hit && Date.now() - hit.at < TTL_MS ? hit.packages : undefined;
}

/**
 * Read builder history for addresses not cached yet, one at a time (Tatum's
 * free plan rate-limits bursts). Failures leave the address unknown.
 */
export async function ensureBuilders(addresses: Iterable<string>, max = 25): Promise<void> {
  if (!tatumEnabled()) return;
  const todo = [...new Set([...addresses].map((a) => a.toLowerCase()))]
    .filter((a) => packagesOf(a) === undefined)
    .slice(0, max);
  for (const address of todo) {
    try {
      const { packages } = await builderSignal(address);
      cache.set(address, { packages, at: Date.now() });
    } catch {
      /* unknown stays unknown; no bonus rather than a wrong one */
    }
  }
}
