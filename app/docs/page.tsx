// The docs: every feature, how to use it, how to test it, and what is
// guaranteed. Static content; the numbers in it are the ones in the code
// (lib/findings.ts, lib/reputation.ts, lib/watch.ts).

import { STALE_AFTER_DAYS } from "@/lib/findings";
import { LEVELS, POINTS } from "@/lib/reputation";
import { LOW_RUNWAY_DAYS, SPIKE_RATIO } from "@/lib/watch";
import { viewer } from "@/lib/viewer";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

const TOC: [string, string][] = [
  ["start", "Getting started"],
  ["ask", "Asking"],
  ["store", "Storing a finding"],
  ["confirm", "Confirmations"],
  ["levels", "Points and levels"],
  ["search", "Search, topics, members"],
  ["diagnose", "Diagnosing a transaction"],
  ["watch", "Your project (watchdog)"],
  ["rules", "Escalation rules"],
  ["mcp", "Use it from any AI tool"],
  ["memory", "How memory is stored"],
  ["limits", "What is guaranteed"],
  ["testing", "Testing checklist"],
];

const MCP_URL = "https://sabi-sage.vercel.app/api/mcp";

export default async function DocsPage() {
  const who = await viewer();
  return (
    <PageShell {...who} active="docs">
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_220px]">
        <article className="flex min-w-0 max-w-[760px] flex-col gap-12">
          <header className="flex flex-col gap-3">
            <h1 className="display text-[34px] font-normal leading-tight sm:text-[40px]">Sabi docs</h1>
            <p className="text-[15.5px] leading-relaxed text-muted">
              Sabi is an AI agent with a shared memory on Walrus. It answers developer questions from fixes other
              members verified themselves, reads Sui transactions through Tatum, watches your project&apos;s gas,
              and learns which alerts you care about. This page covers every feature and how to try it.
            </p>
          </header>

          <Section id="start" title="Getting started">
            <ol className="ml-5 list-decimal space-y-2">
              <li>
                Open <A href="/ask">Ask Sabi</A>. You can ask without signing in.
              </li>
              <li>
                <strong>Sign in with Google</strong> (top right) before you store, confirm or watch anything. Your
                handle comes from your Google account and goes on everything you write. Sabi&apos;s model can never
                change it.
              </li>
              <li>Pick a model in the top bar if you like. The memory is the same whichever model you use.</li>
            </ol>
            <Note>
              Everything Sabi stores is a permanent memory on Walrus mainnet. Nothing can be edited or deleted, so
              only store what you actually reproduced.
            </Note>
          </Section>

          <Section id="ask" title="Asking">
            <p>
              Describe a blocker in plain words, for example &ldquo;WalletConnect keeps failing for users on mobile
              data&rdquo;. Before answering, Sabi searches community memory by meaning, up to three phrasings. Each
              finding it uses shows as a card: the fix, who verified it, when, who else confirmed it, and its memory
              id with links to the encrypted blob on Walruscan.
            </p>
            <p>
              When memory has nothing, Sabi says so and labels the rest of its answer as not verified by the
              community. Volatile findings (carriers, payments, RPC, exchanges) are flagged <em>stale</em> when
              nobody has verified them for {STALE_AFTER_DAYS} days.
            </p>
          </Section>

          <Section id="store" title="Storing a finding">
            <p>
              Tell Sabi what you reproduced and what fixed it, for example: &ldquo;I confirmed today that X fails
              with error Y on Z; the fix was W.&rdquo; Sabi asks at most one question if something is missing, then
              stores one line on Walrus under your name. You get a &ldquo;Stored on Walrus&rdquo; card with the
              memory id.
            </p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>Second-hand reports are refused. Reproduce it first.</li>
              <li>Anything that looks like a key, token or phone number is refused before it reaches Walrus.</li>
              <li>
                If an existing finding says the opposite, the new one <em>supersedes</em> it: the old one stays on
                Walrus as history but stops being the answer.
              </li>
              <li>
                If your finding comes from a failed transaction, Sabi can attach its digest as{" "}
                <strong>on-chain evidence</strong>. The digest is read on mainnet first, and the card gets an
                &ldquo;On-chain evidence&rdquo; badge.
              </li>
            </ul>
          </Section>

          <Section id="confirm" title="Confirmations">
            <p>
              When you reproduce someone else&apos;s finding, click <strong>This worked for me</strong> on its card
              (signed in), or tell Sabi &ldquo;that worked for me too&rdquo;. Sabi stores a confirmation under your
              name that points at the original. The card then shows &ldquo;Confirmed by …&rdquo;, the
              finding&apos;s last-verified date moves to today, and the author earns points.
            </p>
            <p>
              Confirming your own finding refreshes its date but earns nothing. A duplicate confirmation on the same
              day is stored only once.
            </p>
          </Section>

          <Section id="levels" title="Points and levels">
            <p>
              Points come from being confirmed, not from posting: {POINTS.finding} per finding you verified,{" "}
              {POINTS.confirmed} for each member who reproduces one of yours, {POINTS.confirmedOther} for confirming
              someone else&apos;s finding. It is all recomputed from the memories on Walrus, so there is no score
              stored anywhere to tamper with.
            </p>
            <Table
              head={["Level", "Rule", "Unlocks"]}
              rows={LEVELS.map((l) => [l.name, l.rule, l.unlocks ?? ""])}
            />
          </Section>

          <Section id="search" title="Search, topics, members">
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong>Search</strong> (top bar) suggests matching findings and members as you type. Use &ldquo;Ask
                Sabi about …&rdquo; to search by meaning instead of exact words.
              </li>
              <li>
                <A href="/community">Findings</A> lists current findings, newest first, filterable by topic.
              </li>
              <li>
                <A href="/topics">Topics</A> shows each category with its finding count, stale count and last
                verified date.
              </li>
              <li>
                <A href="/members">Members</A> lists everyone who verified or confirmed something, sortable by points,
                findings, most confirmed, helpers and recent activity. Each member has a profile page.
              </li>
            </ul>
          </Section>

          <Section id="diagnose" title="Diagnosing a transaction">
            <p>
              Paste a Sui transaction digest or a Suiscan link into <A href="/ask">Ask Sabi</A>. Sabi reads the
              transaction from mainnet through <strong>Tatum&apos;s Sui gRPC gateway</strong> and shows what failed:
              abort code, the package::module::function that raised it, which command in the transaction, every Move
              call, and the gas paid. Then it searches community memory for that exact failure.
            </p>
            <p>
              Try it with a real mainnet failure:{" "}
              <code className="mono break-all text-[13px]">Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS</code>. It
              reads as <code className="mono text-[13px]">MoveAbort 101 in 0xfa55…9ae1::m::z</code>.
            </p>
            <p>
              If the failed transaction was sent from an address you watch, the failure is also recorded in your
              project memory (see below).
            </p>
          </Section>

          <Section id="watch" title="Your project (watchdog)">
            <p>
              On <A href="/watch">Your project</A> (signed in), add the address that pays your project&apos;s gas: a
              deployer, treasury or bot. Sabi reads its SUI balance through Tatum and stores every reading in your
              own memory on Walrus, separate from the community&apos;s. From those readings it works out:
            </p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>spend per day, latest and your normal (the median of earlier periods; needs three readings);</li>
              <li>gas runway: days of balance left at your normal spend;</li>
              <li>
                alerts: spend at {SPIKE_RATIO}× your normal or more, under {LOW_RUNWAY_DAYS} days of gas, a new
                failure type, or the same failure three or more times in a week;
              </li>
              <li>every failure Sabi diagnosed for this address, next to the community&apos;s verified fix.</li>
            </ul>
            <p>
              Balances are read when you open the page (if the last reading is over 6 hours old) and once a day by a
              scheduled job. Deposits are recognized and never counted as spend. In chat, &ldquo;watch my deployer
              0x…&rdquo; and &ldquo;how&apos;s my project doing?&rdquo; do the same.
            </p>
          </Section>

          <Section id="rules" title="Escalation rules">
            <p>
              Tell Sabi what matters and it remembers. Each rule is a memory, so it applies everywhere you use Sabi.
            </p>
            <Table
              head={["You say or click", "Rule stored", "Effect"]}
              rows={[
                ["“Always flag anything about Enoki”", "escalate text:enoki", "Matching alerts turn red and go first; new Enoki findings from the community show up too"],
                ["“Rate limits are normal for us”", "mute text:rate limit", "Matching alerts are hidden but counted under “muted by your rules”"],
                ["“Only warn me at 3× spend”", "set spike_ratio=3", "Spend alerts use your threshold"],
                ["“Warn me under 7 days of gas”", "set runway_days=7", "Runway alerts use your threshold"],
                ["Always escalate / Mute on an alert", "escalate or mute that failure or alert type", "Same as saying it"],
                ["Remove / Unmute", "clear <target>", "The rule stops applying"],
              ]}
            />
            <p>
              The newest rule for a target replaces the old one, so a correction is just another rule. A specific
              escalate beats a broad mute: mute all new failures, escalate &ldquo;MoveAbort 101&rdquo;, and that one
              still reaches you.
            </p>
          </Section>

          <Section id="mcp" title="Use it from any AI tool">
            <p>
              Sabi is also an MCP server, with the same tools, rules and memory as the app. Add it as a custom
              connector in Claude or ChatGPT, or in Cursor&apos;s MCP settings:
            </p>
            <Code>{MCP_URL}</Code>
            <Table
              head={["Tool", "What it does"]}
              rows={[
                ["recall_findings", "Search community memory by meaning"],
                ["remember_finding", "Store a verified finding (optionally with on-chain evidence)"],
                ["confirm_finding", "Record that you reproduced an existing finding"],
                ["inspect_transaction", "Read a Sui transaction through Tatum and find fixes for its failure"],
                ["watch_address", "Start watching an address"],
                ["project_status", "Balance, spend, runway, alerts and failures for your watched addresses"],
                ["set_escalation_rule", "Escalate, mute or set a threshold"],
              ]}
            />
            <Note>
              The MCP server has no sign-in. Everything written through it is attributed to the instance&apos;s
              configured member, and its watchdog is that member&apos;s.
            </Note>
          </Section>

          <Section id="memory" title="How memory is stored">
            <p>Every memory is one line, Seal-encrypted and stored as a blob on Walrus mainnet:</p>
            <Code>
              {`[CATEGORY] subject → finding → FIX: fix → VERIFIED: date | provider | version | volatile:yes | by:@handle
  … | SUPERSEDES:<memory id>   a newer finding replacing this one
  … | CONFIRMS:<memory id>     a second member's re-verification
  … | EVIDENCE:<tx digest>     a mainnet transaction, read before storing

[WATCH] 0x… → label → SINCE: date                    (your project memory)
[SNAPSHOT] 0x… → <balance> MIST → AT: time
[FAILURE] 0x… → MoveAbort 101 in … → TX: digest → AT: time
[RULE] escalate → text:enoki → REASON: … → AT: time`}
            </Code>
            <p>
              Community findings live in one shared namespace. Each member&apos;s watchdog and rules live in their
              own namespace. Staleness, supersession, confirmations, points, baselines and alerts are all computed
              in code when memory is read, never by the model.
            </p>
          </Section>

          <Section id="limits" title="What is guaranteed">
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong>On-chain:</strong> which delegate keys may write to the memory account, and every memory as
                an encrypted blob on Walrus.
              </li>
              <li>
                <strong>Read from Sui:</strong> transactions, balances and evidence, through Tatum&apos;s Sui gRPC
                gateway.
              </li>
              <li>
                <strong>Honour system:</strong> whether a finding is true. Sabi&apos;s rules (verify first, attribute
                every write, confirmations, levels) keep it honest; they cannot prove it.
              </li>
              <li>
                <strong>The relayer sees plaintext</strong> while it embeds and encrypts. Walrus only ever holds
                ciphertext.
              </li>
              <li>
                <strong>Spend comes from balance readings,</strong> because Tatum&apos;s data API does not list Sui
                transaction history. A deposit and a spend in the same period partly cancel out.
              </li>
              <li>
                <strong>The community index</strong> is rebuilt from Walrus every few minutes and covers about 800
                memories. Findings shows how much of the namespace it covered.
              </li>
            </ul>
          </Section>

          <Section id="testing" title="Testing checklist">
            <Table
              head={["Feature", "Try", "Expect"]}
              rows={[
                ["Ask", "“WalletConnect fails on mobile data, any fix?”", "Recall first, finding cards with who and when"],
                ["Store", "“I confirmed today that … the fix was …”", "“Stored on Walrus” card with a memory id"],
                ["Confirm", "Second account → This worked for me", "“Confirmed by …”, points change on Members"],
                ["Diagnose", "Paste Ho8VJdiBRTJ88HEtjJpKe1Sj3SEW3wuKDpNFCyEye7PS", "Red card: MoveAbort 101, raised in …::m::z"],
                ["Search", "Type “wallet” in the top bar", "Suggestions, see all, ask Sabi"],
                ["Watchdog", "Your project → add your deployer", "Balance now; spend and runway after a few readings"],
                ["Failures", "Paste a failed tx from your watched address", "“Added to your project memory”, a new failure alert"],
                ["Rules", "“Always flag anything about enoki”", "“Rule remembered”, listed under Your rules"],
                ["Any model", "Switch model, ask again", "Same memory recalled"],
                ["MCP", "Connect the endpoint above in Claude", "Same tools from another app"],
              ]}
            />
          </Section>
        </article>

        <nav aria-label="On this page" className="hidden xl:block">
          <div className="sticky top-6 flex flex-col gap-1 border-l border-line pl-4">
            <span className="eyebrow pb-2 text-faint">On this page</span>
            {TOC.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="py-0.5 text-[13px] text-muted hover:text-ink">
                {label}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </PageShell>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3.5 text-[15px] leading-relaxed text-muted">
      <h2 className="display border-b border-line pb-2 text-[22px] font-medium text-ink">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-ink underline decoration-line2 underline-offset-2 hover:decoration-ink">
      {children}
    </a>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[var(--r)] bg-warn-soft px-4 py-3 text-[14px] text-warn">{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mono overflow-x-auto rounded-[var(--r)] border border-line bg-surface2 p-4 text-[12.5px] leading-relaxed text-ink">
      {children}
    </pre>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--r)] border border-line">
      <table className="w-full border-collapse text-left text-[13.5px]">
        <thead className="bg-surface2">
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b border-line px-3.5 py-2.5 font-medium text-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={`border-b border-line px-3.5 py-2.5 ${j === 0 ? "text-ink" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
