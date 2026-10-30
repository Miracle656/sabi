// Your project: what the watchdog has learned about the addresses a member
// asked it to watch - balance and burn over time, the alerts that came out of
// it, failures it has seen and the community's fixes for them.

import { projectStatus, type ProjectStatus } from "@/lib/watchdog";
import { mode, network } from "@/lib/memwal";
import { mistToSui, shortId, suiscanAccount, suiscanTx } from "@/lib/onchain";
import { tatumEnabled } from "@/lib/tatum";
import { LOW_RUNWAY_DAYS, SPIKE_RATIO, type Alert } from "@/lib/watch";
import { viewer } from "@/lib/viewer";
import { FindingCard, ViewerProvider } from "@/components/memory-card";
import { PageShell } from "@/components/page-shell";
import { WatchForm } from "@/components/watch-form";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Project = ProjectStatus["projects"][number];

export default async function WatchPage() {
  const who = await viewer();
  const shell = { ...who, active: "watch" as const };

  if (!who.user) {
    return (
      <PageShell {...shell}>
        <Intro />
        <p className="mt-6 text-[14px] text-muted">Sign in (top right) to start watching your project.</p>
      </PageShell>
    );
  }
  if (!tatumEnabled()) {
    return (
      <PageShell {...shell}>
        <Intro />
        <p className="mt-6 text-[14px] text-warn">On-chain reads are not configured on this instance (TATUM_API_KEY).</p>
      </PageShell>
    );
  }

  let status: ProjectStatus;
  try {
    status = await projectStatus(who.user.handle);
  } catch (err) {
    return (
      <PageShell {...shell}>
        <Intro />
        <p className="mt-6 text-[14px] text-warn">
          Couldn&apos;t read your project memory ({err instanceof Error ? err.message : String(err)}). Try again in a
          minute.
        </p>
      </PageShell>
    );
  }
  const net = await network();
  const mock = mode() === "mock";

  return (
    <PageShell {...shell}>
      <ViewerProvider value={{ handle: who.user.handle }}>
        <Intro memories={status.memories} />

        <section className="mt-7 max-w-[760px]">
          <WatchForm />
        </section>

        {status.projects.length === 0 && (
          <p className="mt-8 max-w-[62ch] text-[14px] leading-relaxed text-faint">
            Nothing watched yet. Add the address that pays your project&apos;s gas. Sabi reads its balance through
            Tatum and remembers it on Walrus. After a few readings it knows your normal spend and tells you when
            something changes.
          </p>
        )}

        <div className="mt-8 flex flex-col gap-10">
          {status.projects.map((p) => (
            <ProjectView key={p.address} p={p} net={net} mock={mock} />
          ))}
        </div>
      </ViewerProvider>
    </PageShell>
  );
}

function Intro({ memories }: { memories?: number }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="display text-[30px] font-normal leading-tight sm:text-[36px]">Your project</h1>
      <p className="max-w-[64ch] text-[14px] leading-relaxed text-muted">
        Sabi watches the addresses you give it, remembers every reading in your own memory on Walrus, and learns
        what normal looks like for you: spend per day, gas runway, and which failures keep coming back.
        {memories !== undefined && memories > 0 && (
          <span className="text-ink"> It remembers {memories} things about your project so far.</span>
        )}
      </p>
    </div>
  );
}

function ProjectView({ p, net, mock }: { p: Project; net: "mainnet" | "testnet"; mock: boolean }) {
  return (
    <section aria-label={p.label} className="flex flex-col gap-5 border-t border-line pt-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="display text-[22px] font-medium">{p.label}</h2>
        <a
          href={suiscanAccount(p.address)}
          target="_blank"
          rel="noreferrer"
          className="mono text-[12.5px] text-muted underline decoration-line2 underline-offset-2 hover:text-ink"
        >
          {shortId(p.address)} ↗
        </a>
        <span className="text-[12px] text-faint">watching since {p.since}</span>
      </header>

      <dl className="nums grid max-w-[760px] grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="balance" value={p.balanceMist === null ? "–" : `${mistToSui(p.balanceMist)} SUI`} />
        <Stat
          label="spend / day, latest"
          value={p.latestPerDay === null ? "–" : `${mistToSui(p.latestPerDay)} SUI`}
        />
        <Stat
          label="spend / day, your normal"
          value={p.baselinePerDay === null ? "learning…" : `${mistToSui(p.baselinePerDay)} SUI`}
          hint={p.baselinePerDay === null ? "needs 3+ readings" : undefined}
        />
        <Stat
          label="gas runway"
          value={p.runwayDays === null ? "–" : p.runwayDays > 999 ? "999+ days" : `${Math.floor(p.runwayDays)} days`}
          tone={p.runwayDays !== null && p.runwayDays < LOW_RUNWAY_DAYS ? "warn" : undefined}
        />
      </dl>

      {p.points.length >= 2 && <BalanceChart points={p.points} />}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="border-b border-line pb-2 text-[13px] font-medium">Alerts</h3>
          {p.alerts.length === 0 ? (
            <p className="text-[13px] text-faint">
              Nothing unusual. Sabi flags spend above {SPIKE_RATIO}× your normal, under {LOW_RUNWAY_DAYS} days of
              gas, and new or repeating failures.
            </p>
          ) : (
            p.alerts.map((a, i) => <AlertRow key={i} a={a} />)
          )}

          <h3 className="mt-4 border-b border-line pb-2 text-[13px] font-medium">What Sabi has learned</h3>
          <ol className="flex flex-col gap-2 text-[13px] text-muted">
            <li>
              <span className="nums text-ink">{p.snapshots}</span> balance readings since {p.since}, each one a
              memory on Walrus.
            </li>
            <li>
              {p.baselinePerDay === null
                ? "Your normal spend is still being learned (it needs 3 readings at least a few hours apart)."
                : `Your normal spend is ${mistToSui(p.baselinePerDay)} SUI/day, learned from ${p.intervals.filter((x) => !x.deposit).length} intervals.`}
            </li>
            <li>
              {p.failures.length === 0
                ? "No failures recorded. Paste a failed transaction from this address in chat and Sabi will remember it."
                : `${p.failures.reduce((n, f) => n + f.count, 0)} failed transactions remembered, ${p.failures.length} distinct ${p.failures.length === 1 ? "failure" : "failures"}.`}
            </li>
          </ol>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="border-b border-line pb-2 text-[13px] font-medium">Failures seen</h3>
          {p.failures.length === 0 && <p className="text-[13px] text-faint">None yet.</p>}
          {p.failures.map((f) => (
            <div key={f.signature} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="mono text-[13px] text-ink [overflow-wrap:anywhere]">{f.signature}</span>
                <span className="nums text-[12px] text-faint">
                  ×{f.count} · {f.recent} this week ·{" "}
                  <a href={suiscanTx(f.lastDigest)} target="_blank" rel="noreferrer" className="underline decoration-line2 underline-offset-2 hover:text-ink">
                    latest ↗
                  </a>
                </span>
              </div>
              {(p.fixes[f.signature] ?? []).length > 0 ? (
                p.fixes[f.signature].map((h) => <FindingCard key={h.memory_id} hit={h} network={net} mock={mock} />)
              ) : (
                <p className="text-[12.5px] text-faint">
                  No community fix yet. When you fix it, tell Sabi, and you&apos;ll be the first to verify it.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-[11.5px] text-faint">
        {label}
        {hint && <span className="block">{hint}</span>}
      </dt>
      <dd className={`display text-[20px] font-medium ${tone === "warn" ? "text-warn" : ""}`}>{value}</dd>
    </div>
  );
}

function AlertRow({ a }: { a: Alert }) {
  const bad = a.severity === "bad";
  return (
    <div
      className={`flex flex-col gap-1 rounded-[var(--r)] px-3.5 py-2.5 text-[13px] ${bad ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}
    >
      <span className="font-medium">{a.title}</span>
      <span className="[overflow-wrap:anywhere]">{a.detail}</span>
      {a.signature && (
        <a
          href={`/community?q=${encodeURIComponent(a.signature)}`}
          className="w-fit underline underline-offset-2"
        >
          Search community findings
        </a>
      )}
    </div>
  );
}

/** Balance over time, on one scale: x by time, y from 0 to the max reading. */
function BalanceChart({ points }: { points: { at: string; mist: bigint }[] }) {
  const W = 640;
  const H = 120;
  const PAD = 6;
  const t0 = Date.parse(points[0].at);
  const t1 = Date.parse(points[points.length - 1].at);
  const max = points.reduce((m, p) => (p.mist > m ? p.mist : m), 0n);
  const x = (at: string) => PAD + ((Date.parse(at) - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = (mist: bigint) => H - PAD - (max === 0n ? 0 : Number((mist * 1000n) / max) / 1000) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.mist).toFixed(1)}`).join(" ");
  return (
    <figure className="max-w-[760px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="SUI balance over time">
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--line2)" />
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
        {points.map((p) => (
          <circle key={p.at} cx={x(p.at)} cy={y(p.mist)} r="2.5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.2" />
        ))}
      </svg>
      <figcaption className="nums mt-1 flex justify-between text-[11.5px] text-faint">
        <span>{points[0].at.slice(0, 10)}</span>
        <span>SUI balance, 0 – {mistToSui(max)}</span>
        <span>{points[points.length - 1].at.slice(0, 10)}</span>
      </figcaption>
    </figure>
  );
}
