# docs-notes — what was verified before writing Sabi

Sabi was built against real artefacts, not memory of the SDK. Everything below was
checked on 2026-08-22 by unpacking the npm tarballs and reading the type
declarations, plus `curl` against the public relayer and the Walrus docs.

## `@mysten-incubation/memwal` — pinned **0.1.3**

Latest stable on npm at build time (`0.1.4-dev.0` was the only newer tag). The
API is a strict superset of `0.0.7`, which the Cortex app in this monorepo runs
in production; 0.1.3 adds idempotency keys, `countTokens`, and `MemWalMock`.

Relayer-mode client (`@mysten-incubation/memwal`):

| Call | Signature (from `dist/memwal.d.ts`) | Returns |
| --- | --- | --- |
| `MemWal.create(cfg)` | `{ key: string\|Uint8Array; accountId: string; serverUrl?: string; namespace?: string }` | `MemWal` |
| `remember(text, ns?)` | 202-style accept | `{ job_id, status }` |
| `waitForRememberJob(jobId, { pollIntervalMs?, timeoutMs? })` | poll to terminal state; throws `remember job timed out after Nms (job_id=…)` with `status: 504` | `{ id, job_id?, blob_id, owner, namespace }` |
| `rememberAndWait(text, ns?, opts?)` | the two above combined | same |
| `recall({ query, limit?, topK?, namespace?, maxDistance?, maxTokens? })` | object form preferred; positional `recall(q, limit, ns)` is deprecated | `{ results: [{ blob_id, text, distance }], total }` |
| `restore(ns, limit?)` | rebuild the relayer's local index from Walrus, newest-first, single-shot | `{ restored, skipped, total, … }` |
| `health()` | public, unsigned | `{ status, version, … }` |
| `getRememberStatus(jobId)` | one-shot | `{ job_id, status: pending\|running\|uploaded\|done\|failed\|not_found, blob_id? }` |

**There is no delete / forget on the production client.** `forget(blobId)` exists on
`MemWalMock` only. Memory is append-only → Sabi's supersession is a recall-time rule.

**The memory id is the Walrus `blob_id`.** `RecallMemory` carries only
`{ blob_id, text, distance }` — no timestamps, no tags, no author. Everything
Sabi needs per finding (date, provider, version, volatility, who verified it,
what it supersedes) therefore lives *inside the text* in the canonical format.

**Trust boundary.** On relayer-mode routes the SDK signs with the delegate key and
attaches an ephemeral 5-minute Seal session header; the relayer decrypts server-side,
embeds, and returns plaintext. So: Walrus holds ciphertext, the relayer sees plaintext
on every remember/recall. Sabi's README says this plainly.

Account helpers (`@mysten-incubation/memwal/account`):

- `generateDelegateKey()` → `{ privateKey (hex), publicKey (Uint8Array), suiAddress }`
- `addDelegateKey({ packageId, registryId, accountId, publicKey, label, suiPrivateKey | walletSigner, suiClient?, suiNetwork? })`
- `removeDelegateKey({ … same … })`
- `createAccount({ packageId, registryId, … })` — one account per owner address
- Contract limit: **20 delegate keys per account**; duplicates abort with code 0.

⚠️ With `@mysten/sui ≥ 2.6` the helpers' fallback `new SuiClient()` **throws** (the
export was removed). Pass `suiClient` explicitly — Sabi passes a `SuiGrpcClient`
from `@mysten/sui/grpc`, the same client the Cortex frontend uses.

## Relayer

- Public mainnet relayer: `https://relayer.memory.walrus.xyz` (testnet/staging:
  `https://relayer-staging.memory.walrus.xyz`).
- `GET /config` → `{ packageId, network, suiRpcUrl, suiGrpcUrl, … }`. Verified live:
  `network: "mainnet"`, so the playground-issued accounts are mainnet accounts.
- `GET /health` → `{ status: "ok", relayerVersion, apiVersion, minSupportedSdk: { typescript: "0.0.4" }, … }`.

## Contract ids (docs.wal.app/walrus-memory/contract/overview)

| Network | `MEMWAL_PACKAGE_ID` | `MEMWAL_REGISTRY_ID` |
| --- | --- | --- |
| mainnet | `0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6` | `0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd` |
| testnet | `0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6` | `0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437` |

The live relayer's `/config` reports a *different* `packageId`
(`0xe7c16f…`) than the docs' mainnet id — most likely original-vs-upgraded package
addresses. `scripts/_contract.ts` uses the docs id and warns about the mismatch; set
`MEMWAL_PACKAGE_ID` if an account transaction aborts.

## Walrus links

- Aggregator HTTP API (documented): `GET https://aggregator.walrus-{mainnet|testnet}.walrus.space/v1/blobs/{blob_id}` — returns the raw (Seal-encrypted) bytes.
- Walruscan explorer: `https://walruscan.com/{network}/blob/{blob_id}`.

## Vercel AI SDK — `ai@6.0.264`, `@ai-sdk/anthropic@3.0.111`, `@ai-sdk/openai@3.0.99`, `@ai-sdk/react@3.0.267`

- Tools: `tool({ description, inputSchema: z.object(…), execute })`.
- Server: `streamText({ model, system, messages: await convertToModelMessages(uiMessages), tools, stopWhen: stepCountIs(n) })` → `result.toUIMessageStreamResponse()`.
- Client: `useChat({ transport: new DefaultChatTransport({ api }) })`, `sendMessage({ text }, { body })`; tool parts appear as `{ type: "tool-<name>", toolCallId, state, input, output }`.
- Claude ids: `claude-opus-5` (default), `claude-sonnet-5`. Thinking is on by default on Opus 5; no `budget_tokens`.
