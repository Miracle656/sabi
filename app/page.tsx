// The landing page: what Sabi is, the three things it does, how its memory
// works, and live numbers read from Walrus Memory. The chat lives at /ask.

import { Suspense } from "react";
import { communityIndex } from "@/lib/community";
import { mode, network } from "@/lib/memwal";
import { viewer } from "@/lib/viewer";
import { FindingCard, TxCard } from "@/components/memory-card";
import { SiteNav } from "@/components/site-nav";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A real mainnet failure, read through Tatum on 2026-10-30. Shown as an
// example of what /ask returns for a pasted digest.
const EXAMPLE_TX = {
  digest: "Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS",
  ok: false,
  sender: "0xd09783e7fe926e738c17522fed72866ef53b85d764bf10c0448854ba041a23ee",
  calls: [
    "0xdfd3bd9d887422391608a2fc9cdeaaab1d2f85009a1fe59609f315e3918293a3::m::gb",
    "0xfa555fe81f851f45d4aa9f1e7d825fa94ee564eeaf424fb941378991274c9ae1::m::gd",
  ],
  moreCalls: 8,
  failure: {
    kind: "MOVE_ABORT",
    abortCode: "101",
    package: "0xfa555fe81f851f45d4aa9f1e7d825fa94ee564eeaf424fb941378991274c9ae1",
    module: "m",
    function: "z",
    command: 1,
  },
  signature: "MoveAbort 101 in 0xfa55…9ae1::m::z",
};

export default async function Landing() {
  const who = await viewer();
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteNav user={who.user} googleClientId={who.googleClientId} sidebarFrom="xl" />

      <main className="flex-1">
        {/* ── hero ───────────────────────────────────────────────────────── */}
        <section className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:pt-20">
          <div className="flex min-w-0 flex-col gap-6">
            <h1 className="display max-w-[16ch] text-[40px] font-normal leading-[1.04] sm:text-[54px] lg:text-[62px]">
              The memory your Sui project should have had.
            </h1>
            <p className="max-w-[54ch] text-[17px] leading-relaxed text-muted">
              Sabi is an AI agent with a shared, permanent memory. It reads your failed transactions straight from
              Sui, answers with fixes other developers verified themselves, watches your project&apos;s gas, and
              learns what you want to be told about. Everything it learns is stored on Walrus and follows you into
              any AI tool.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/ask"
                className="rounded-[var(--r)] bg-ink px-5 py-3 text-[15px] font-medium text-[var(--paper)] transition-opacity hover:opacity-85"
              >
                Ask Sabi
              </a>
              <a
                href="/watch"
                className="rounded-[var(--r)] border border-edge px-5 py-3 text-[15px] transition-colors hover:bg-soft"
              >
                Watch your project
              </a>
              <a href="/docs" className="px-2 py-3 text-[15px] text-muted underline decoration-line2 underline-offset-4 hover:text-ink">
                Read the docs
              </a>
            </div>
            <Suspense fallback={<StatsSkeleton />}>
              <Stats />
            </Suspense>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <span className="eyebrow text-faint">Paste a failed transaction, get the community&apos;s fix</span>
            <TxCard tx={EXAMPLE_TX} gasSui="0.0001" explorer={`https://suiscan.xyz/mainnet/tx/${EXAMPLE_TX.digest}`} />
            <Suspense fallback={<div className="h-40 rounded-[var(--r)] border border-line bg-soft" />}>
              <NewestFinding />
            </Suspense>
          </div>
        </section>

        {/* ── three things ───────────────────────────────────────────────── */}
        <section className="border-t border-line bg-surface2">
          <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8">
            <h2 className="display max-w-[22ch] text-[30px] font-normal leading-tight sm:text-[36px]">
              One agent. Three jobs it never forgets.
            </h2>
            <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
              <Pillar
                n="01"
                title="Research with trust scores"
                body="Paste a digest and Sabi reads the exact failure from mainnet: abort code, module, function, gas. It answers from fixes members verified themselves, shows who confirmed them, and marks findings backed by on-chain evidence."
                href="/ask"
                cta="Diagnose a transaction"
              />
              <Pillar
                n="02"
                title="A watchdog with long-term memory"
                body="Give Sabi your deployer or treasury address. It reads the balance through Tatum, remembers every reading, learns your normal daily spend, and flags spend spikes, low gas runway and failures that keep coming back."
                href="/watch"
                cta="Watch an address"
              />
              <Pillar
                n="03"
                title="Learns your escalation rules"
                body="Tell it what matters: “always flag anything about Enoki”, “rate limits are normal for us”. Each rule is a memory. Alerts change straight away, corrections replace old rules, and the rules follow you to every AI tool."
                href="/docs#rules"
                cta="How rules work"
              />
            </div>
          </div>
        </section>

        {/* ── how memory works ───────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
            <div className="flex flex-col gap-5">
              <h2 className="display text-[30px] font-normal leading-tight sm:text-[36px]">
                Memory you can audit, not a black box.
              </h2>
              <p className="max-w-[56ch] text-[15.5px] leading-relaxed text-muted">
                Every finding is one line on Walrus: what broke, the fix, when it was verified and by whom. Nothing
                is ever edited or deleted. A newer finding names the one it replaces, a second member&apos;s
                re-verification names the one it confirms, and the rules about age and trust run in code at recall
                time, not in the model.
              </p>
              <ol className="flex flex-col gap-4">
                {[
                  ["Ask", "Sabi recalls before it answers and cites every memory it uses."],
                  ["Verify", "Only what you reproduced yourself is stored. Second-hand reports are refused."],
                  ["Store", "One canonical line on Walrus, under your name, with the date."],
                  ["Confirm", "When someone else reproduces it, their confirmation restarts the staleness clock and earns you points."],
                ].map(([t, d], i) => (
                  <li key={t} className="grid grid-cols-[34px_1fr] gap-3 border-t border-line pt-3">
                    <span className="mono text-[12px] text-faint">0{i + 1}</span>
                    <span className="text-[14.5px]">
                      <span className="font-medium">{t}.</span> <span className="text-muted">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <span className="eyebrow text-faint">What is actually stored</span>
              <pre className="mono overflow-x-auto rounded-[var(--r)] border border-line bg-surface2 p-4 text-[12px] leading-relaxed text-muted">
{`[WALLET] WalletConnect relay on a mobile carrier
 → Relay websocket never opens on mobile data
 → FIX: custom relay URL
 → VERIFIED: 2026-10-07 | Carrier X | walletconnect v2
   | volatile:yes | by:@ada | EVIDENCE:<tx digest>

[WALLET] …same finding…
 → VERIFIED: 2026-10-25 | … | by:@tunde | CONFIRMS:<memory id>`}
              </pre>
              <ul className="grid grid-cols-1 gap-3 text-[13.5px] text-muted sm:grid-cols-2">
                <Fact title="Stale after 60 days">Carrier, payments, RPC and exchange findings expire unless someone re-confirms them.</Fact>
                <Fact title="Points for being confirmed">10 per finding, 5 per member who reproduces it. Self-confirmation earns nothing.</Fact>
                <Fact title="Evidence checked on-chain">A finding citing a transaction is read on mainnet before it is stored.</Fact>
                <Fact title="Encrypted on Walrus">Each memory is a Seal-encrypted blob you can open on Walruscan.</Fact>
              </ul>
            </div>
          </div>
        </section>

        {/* ── anywhere ───────────────────────────────────────────────────── */}
        <section className="border-t border-line bg-surface2">
          <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <h2 className="display text-[30px] font-normal leading-tight sm:text-[36px]">
                Different model. Same memory.
              </h2>
              <p className="max-w-[54ch] text-[15.5px] leading-relaxed text-muted">
                Switch between open-weight and GPT models in the app, or connect Sabi to Claude, ChatGPT or Cursor
                over MCP. Same tools, same rules, same memory: what one model stored, another recalls.
              </p>
              <a href="/docs#mcp" className="w-fit text-[14.5px] underline decoration-line2 underline-offset-4 hover:decoration-ink">
                Connect your AI tool →
              </a>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <span className="eyebrow text-faint">MCP endpoint</span>
              <pre className="mono overflow-x-auto rounded-[var(--r)] border border-line bg-[var(--paper)] p-4 text-[12.5px] leading-relaxed">
{`https://sabi-sage.vercel.app/api/mcp

tools: recall_findings · remember_finding · confirm_finding
       inspect_transaction · watch_address · project_status
       set_escalation_rule`}
              </pre>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[12.5px] text-faint sm:px-8">
          <span>Sabi · built on Walrus Memory and Tatum</span>
          <span className="grow" />
          <a href="/docs" className="hover:text-ink">Docs</a>
          <a href="/community" className="hover:text-ink">Findings</a>
          <a href="/members" className="hover:text-ink">Members</a>
          <a href="https://github.com/Miracle656/sabi" target="_blank" rel="noreferrer" className="hover:text-ink">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function Pillar({ n, title, body, href, cta }: { n: string; title: string; body: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line2 pt-4">
      <span className="mono text-[12px] text-faint">{n}</span>
      <h3 className="display text-[20px] font-medium">{title}</h3>
      <p className="text-[14.5px] leading-relaxed text-muted">{body}</p>
      <a href={href} className="mt-auto w-fit text-[14px] underline decoration-line2 underline-offset-4 hover:decoration-ink">
        {cta} →
      </a>
    </div>
  );
}

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 border-t border-line pt-2.5">
      <span className="text-[13.5px] font-medium text-ink">{title}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

/** Live numbers from the community index (a sweep of Walrus Memory, cached 3 min). */
async function Stats() {
  try {
    const index = await communityIndex();
    const confirmations = index.contributors.reduce((n, c) => n + c.confirmationsReceived, 0);
    const items: [string, number][] = [
      ["verified findings", index.active.length],
      ["members", index.contributors.length],
      ["confirmations", confirmations],
      ["memories on Walrus", index.coverage.total ?? index.coverage.indexed],
    ];
    return (
      <dl className="nums mt-2 grid max-w-[560px] grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse gap-0.5">
            <dt className="text-[12px] text-faint">{label}</dt>
            <dd className="display text-[26px] font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    );
  } catch {
    return null;
  }
}

function StatsSkeleton() {
  return (
    <div className="mt-2 grid max-w-[560px] grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <span className="h-6 w-10 rounded bg-soft" />
          <span className="h-3 w-20 rounded bg-soft" />
        </div>
      ))}
    </div>
  );
}

async function NewestFinding() {
  try {
    const index = await communityIndex();
    const hit = index.active[0];
    if (!hit) return null;
    const net = await network();
    return (
      <div className="flex flex-col gap-2">
        <span className="eyebrow text-faint">Newest verified finding</span>
        <FindingCard hit={hit} network={net} mock={mode() === "mock"} />
      </div>
    );
  } catch {
    return null;
  }
}
