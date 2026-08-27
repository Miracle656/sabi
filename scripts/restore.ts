// Rebuild the relayer's vector index for the namespace from the durable Walrus
// blobs. Use after a relayer restart, or when a memory written from another
// member's delegate key is not showing up in recall.
//
//   pnpm restore                 # default namespace, inspect up to 50 blobs
//   pnpm restore --limit 200
//   pnpm restore --namespace sabi-smoke

import { arg, loadEnv } from "./_env";

loadEnv();

const { restoreNamespace, defaultNamespace, mode } = await import("../lib/memwal");

const ns = arg("namespace") ?? defaultNamespace();
const limit = Number(arg("limit") ?? 50);

if (mode() === "mock") {
  console.log("MEMWAL_MODE=mock: nothing to restore (the mock has no Walrus).");
  process.exit(0);
}

console.log(`restore ns=${ns} limit=${limit} …`);
const t0 = Date.now();
const res = await restoreNamespace(ns, limit);
console.log(JSON.stringify(res, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
