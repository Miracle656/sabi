# Sabi — the community brain wey no dey forget

A shared, verified memory of Nigerian web3 / fintech dev landmines — carrier-level
WalletConnect blocking, OPay API quirks, RPC rate limits, offramp behaviour — stored
on Walrus through Walrus Memory (MemWal) and recalled by **any** AI model.

Every Lagos dev rediscovers the same landmines from scratch because the knowledge
dies in Telegram scroll. Sabi stores each *verified* finding as a memory on Walrus
and recalls it semantically when anyone describes a blocker. **The memory is the
product; the agent is just the interface.**

> The hackathon submission is [`PROMPT.md`](./PROMPT.md) — the copy-pasteable
> system prompt and the memory rules. This app is the runtime you see it work in.

## What it does

- **Recall before answering.** Any troubleshooting / provider question triggers a
  semantic search of the community namespace first. Findings render as cards with
  the Walrus memory id, who verified it, when, and on which network.
- **Store only what you verified.** The agent refuses second-hand reports and
  stores one canonical line per finding, attributed to you (`by:@handle`).
- **Memory rot is handled.** Volatile categories (carrier, payments, RPC,
  exchange) older than 60 days are flagged *stale* — computed in code from the
  `VERIFIED` date, not by the model.
- **Append-only, but not stuck.** Walrus Memory has no delete. A newer finding
  names the old memory id in `SUPERSEDES:`; recall resolves the chain and hides
  the old one. Nothing is ever lost, it just stops being the answer.
- **Different model. Same memory.** The header switcher swaps Claude Opus 5 /
  Claude Sonnet 5 / (optionally) an OpenAI model. The tools, namespace and
  delegate key do not change, so the memory one model wrote, another recalls.
- **Ledger rail.** A right-rail log of every recall and store in the session,
  with memory ids linking to Walruscan and the Walrus aggregator — the
  proof-it-works panel for the demo video.
- **Light and dark.** A three-way theme control (light / system / dark) in the
  header. The palette is Cortex's, inverted token-for-token; the choice persists
  and is replayed before first paint, so there is no flash.

## MCP server

The same two tools, exposed to any MCP client (Claude Desktop, Cursor, ...):

```bash
pnpm mcp        # stdio server: tools recall_findings + remember_finding, prompt "sabi"
```

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sabi": { "command": "pnpm", "args": ["--dir", "<path-to>/sabi", "mcp"] }
  }
}
```

Load the `sabi` prompt first — the tools without the memory rules will happily
store hearsay; the prompt is the gatekeeper. Attribution over MCP is the
server's `SABI_REPORTER`, exactly like the web app.

## Sign in (optional)

With `GOOGLE_CLIENT_ID` set (and optionally `ENOKI_API_KEY`), the topbar gains
**Sign in**: Google verifies the identity, Enoki derives a zkLogin Sui address,
and findings that visitor stores are attributed to their handle instead of
`SABI_REPORTER`. The chain still records that this instance's delegate key wrote
the memory — sign-in changes the *label*, key registration changes the *right to
write*. Handles embed the email domain for non-Gmail accounts (`@ada` vs
`@ada.acme.co`), so two people can never collide on one handle. Sessions are
stateless HMAC cookies: sign-out clears the browser, but there is no server-side
revocation list — a stolen cookie stays valid until its 7-day expiry. Set
`SABI_SESSION_SECRET` (required) and rotate it to invalidate every session at
once.

## Quick start

```bash
git clone https://github.com/Miracle656/sabi.git && cd sabi
cp .env.example .env        # MEMWAL_DELEGATE_KEY, MEMWAL_ACCOUNT_ID, and ANTHROPIC_API_KEY and/or OPENAI_API_KEY
pnpm install                # or `pnpm install --filter sabi` from the repo root
pnpm smoke                  # proves the Walrus round-trip works from your machine
#   edit seed-findings.json — put YOUR verified findings in (pnpm seed refuses PLACEHOLDER rows)
pnpm seed --dry             # preview the canonical lines
pnpm seed                   # store them in the community namespace
pnpm dev                    # http://localhost:3000
```

No Walrus Memory credentials yet? `MEMWAL_MODE=mock` runs the full UI against an
in-memory store seeded from `seed-findings.json` — so recall returns real cards
and the first-run screen has rows, while nothing persists and nothing touches
Walrus. (A model provider key is still required — `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`, either one: the model is real, only the memory is mocked.)

Get real credentials at the Walrus Memory Playground: <https://memory.walrus.xyz>.
Note the public relayer is **mainnet**; accounts minted in the playground are
mainnet accounts.

## Architecture

```
browser ──▶ app/api/chat/route.ts ── streamText (ai@6) ──▶ Claude / OpenAI
                │                                          │ tool calls
                │   recall_findings ◀──────────────────────┤
                │   remember_finding ◀─────────────────────┘
                ▼
         lib/memwal.ts   (THE ONLY file that imports the SDK)
                │  signs with the delegate key
                ▼
     Walrus Memory relayer ── embed · Seal-encrypt · upload ──▶ Walrus blobs
                │                                          (ciphertext, durable)
                └── vector index (relayer-side, rebuildable via restore())

lib/findings.ts   canonical line format · parser · supersession · staleness
lib/sabi-prompt.ts the system prompt (== PROMPT.md)
components/       neobrutalist UI: chat, memory cards, Memory Wall, model switcher
scripts/          seed · smoke · restore · keygen · add-member · members
```

The canonical memory line (one per finding):

```
[CATEGORY] subject → finding → FIX: fix → VERIFIED: YYYY-MM-DD | provider | version | volatile:yes | by:@handle | SUPERSEDES:<memory_id>
```

Categories: `CARRIER PAYMENTS WALLET RPC TOOLING REGULATORY EXCHANGE INFRA`.
Volatile by default: `CARRIER PAYMENTS RPC EXCHANGE`. Stale after 60 days.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | the Next.js app |
| `pnpm smoke` | store a nonce-tagged finding in `sabi-smoke`, wait for the blob id, recall it, assert. PASS/FAIL + timings. |
| `pnpm seed [--dry] [--file x.json]` | validate + store every finding in `seed-findings.json`; prints `subject → memory_id`. Refuses rows containing `PLACEHOLDER` (memory is append-only) unless `--allow-placeholders`. |
| `pnpm restore [--namespace ns] [--limit n]` | rebuild the relayer's index from Walrus (after a relayer restart or writes from another member) |
| `pnpm keygen` | mint a delegate keypair for a new member (they keep the private key) |
| `pnpm add-member --pubkey <hex> --label "@handle" [--remove]` | account **owner** registers (or revokes) a member's key on-chain |
| `pnpm members` | list the delegate keys on the shared account (who can write) |
| `pnpm test` | unit tests for the finding grammar + a guard that `PROMPT.md` matches the runtime prompt byte-for-byte |
| `pnpm typecheck` | `tsc --noEmit` |

## Multi-writer setup (the "shared brain" part)

One Walrus Memory account = one community brain. Writers are delegate keys on
that account (max 20, enforced by the MemWal contract).

1. The community lead creates the account in the playground and keeps the owner
   wallet (`MEMWAL_OWNER_SUI_KEY`) — only the owner can add/remove keys.
2. A member runs `pnpm keygen`, keeps the private key as their own
   `MEMWAL_DELEGATE_KEY`, and sends the **public** key to the lead.
3. The lead runs `pnpm add-member --pubkey <hex> --label "@member"`.
4. The member sets `MEMWAL_ACCOUNT_ID` (the shared one), `MEMWAL_NAMESPACE=sabi`,
   `SABI_REPORTER=@member`, and runs Sabi. Their findings land in the same
   namespace, attributed to them. `pnpm members` shows everyone on-chain.

If a finding another member just wrote does not show up, run `pnpm restore` —
the relayer's vector index is local and rebuilt from Walrus on demand.

## What is actually guaranteed (and what is not)

Be precise about this in the demo; it is the difference between a real project and a
pitch.

- **On-chain:** the account, who owns it, and which delegate keys may write/read
  (the MemWal `account` contract; Seal's `seal_approve` gates decryption by that list).
- **On Walrus:** every finding, Seal-encrypted, durable for the paid storage epochs.
  The aggregator link on each card fetches the ciphertext — that is the proof.
- **Honour system, enforced by the prompt:** that a finding is *verified*. Any
  delegate can write anything; Sabi's discipline (recall first, store only what the
  user confirms they reproduced, attribute it, never store secrets) is what keeps the
  brain clean. Revocation is the backstop (`pnpm add-member --remove`).
- **The relayer sees plaintext.** It embeds and decrypts on every request; Walrus
  holds ciphertext. You can self-host the relayer.
- **No delete.** Supersession and staleness are recall-time rules in
  `lib/findings.ts`. Old findings stay on Walrus forever, hidden but auditable.
- **Attribution is by handle, not signature.** `by:@handle` comes from the
  writer's `SABI_REPORTER` (the model cannot set it). The on-chain fact is which
  *delegate key* wrote it.
- **Secrets are refused twice.** The prompt forbids storing them and
  `looksLikeSecret()` in `lib/findings.ts` rejects API-key / private-key / JWT /
  phone-number shapes server-side before anything reaches the relayer.
- **Supersession has a search window.** Recall over-fetches (3× the limit, up to
  60 rows) before resolving `SUPERSEDES` chains. A retraction that ranks outside
  that window for a particular query will not hide the old row for that query.

## Demo script (3 beats, ~90 seconds)

1. **Fresh session.** Ask: *"WalletConnect dey fail for my users on MTN. Any fix?"*
   → the 🔍 chip fires → a finding card with FIX, verified date, `by:@…`, and the
   memory id → click `scan` to show the blob on Walruscan.
2. **Store live.** Say: *"Confirmed today: OPay … ; the fix was …"* → Sabi asks at
   most one question → 💾 chip → green **SAVED TO WALRUS ✓** card with the new id.
   (If Sabi found an older contradicting finding, the card shows `supersedes <id>`.)
3. **Reload the page** (a fresh chat — nothing of the old conversation is in
   context), **switch the model** in the header (Opus → Sonnet, or → GPT) and ask
   about the finding you just stored. It recalls it from Walrus, not from the chat.
   *"Different model. Same memory."*

Bonus beat for a second device/member: store from their instance, recall from
yours (`pnpm restore` if the index lags).

## Deploying

Local `pnpm dev` is the demo target. The app is a plain Next.js app with
server-only secrets, so it *can* deploy to Vercel (`MEMWAL_*` and API keys as
project env vars) — but note `/api/chat` has **no authentication**: anyone who
can reach the URL can spend your model credits and write into the shared brain
through your delegate key. Put it behind Vercel deployment protection or add
auth before exposing it publicly. Not configured here on purpose.

## Credits

Built on Walrus Memory (`@mysten-incubation/memwal`), Walrus, Seal and Sui, for
the Walrus Memory hackathon at SuiHub Lagos. Lives inside the Cortex monorepo,
which is why the MemWal wiring was already battle-tested before Sabi existed.
