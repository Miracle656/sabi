// Topics, the newest verified findings in each, and who verified them -
// rebuilt from Walrus Memory by the community index (lib/community.ts).

import { cookies } from "next/headers";
import { CATEGORIES, type Category } from "@/lib/findings";
import { communityIndex } from "@/lib/community";
import { defaultNamespace, mode, network } from "@/lib/memwal";
import { LEVELS, POINTS } from "@/lib/reputation";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { FindingCard, ViewerProvider } from "@/components/memory-card";
import { profileHref } from "@/lib/links";
import { LevelTag, PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TOPIC_LABEL: Record<Category, string> = {
  CARRIER: "Carriers",
  PAYMENTS: "Payments",
  WALLET: "Wallets",
  RPC: "RPC",
  TOOLING: "Tooling",
  REGULATORY: "Regulatory",
  EXCHANGE: "Exchanges",
  INFRA: "Infra",
};

export default async function CommunityPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await props.searchParams).topic;
  const topic = CATEGORIES.find((c) => c === (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase());
  const namespace = defaultNamespace();
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);

  let index;
  try {
    index = await communityIndex(namespace);
  } catch (err) {
    return (
      <PageShell namespace={namespace}>
        <h1 className="display text-[34px] font-normal">Community</h1>
        <p className="mt-4 max-w-[60ch] text-[14px] text-warn">
          Couldn&apos;t reach Walrus Memory to build the index ({err instanceof Error ? err.message : String(err)}).
          Nothing is lost; try again in a minute.
        </p>
      </PageShell>
    );
  }

  const net = await network();
  const mock = mode() === "mock";
  const shown = (topic ? index.active.filter((h) => h.finding?.category === topic) : index.active).slice(0, 60);
  const { indexed, total } = index.coverage;

  return (
    <PageShell namespace={namespace}>
      <ViewerProvider value={{ handle: session?.handle }}>
        <div className="flex flex-col gap-2">
          <h1 className="display text-[34px] font-normal leading-tight sm:text-[42px]">Community</h1>
          <p className="nums max-w-[64ch] text-[14px] text-muted">
            {index.active.length} current findings from {index.contributors.length} members.
            Everything here is rebuilt from the memories on Walrus: there is no separate database to
            trust.
          </p>
          <p className="nums text-[12px] text-faint">
            {total === null
              ? `Indexed ${indexed} memories`
              : indexed >= total
                ? `Indexed all ${total} memories in the namespace`
                : `Indexed ${indexed} of ${total} memories; the rest are still searchable from chat`}
            {" · "}refreshed {new Date(index.builtAt).toUTCString().slice(17, 22)} UTC
          </p>
        </div>

        <nav aria-label="Topics" className="mt-7 flex flex-wrap gap-2">
          <TopicChip href="/community" active={!topic} label="All" count={index.active.length} />
          {index.topics
            .filter((t) => t.active > 0 || t.category === topic)
            .map((t) => (
              <TopicChip
                key={t.category}
                href={`/community?topic=${t.category.toLowerCase()}`}
                active={topic === t.category}
                label={TOPIC_LABEL[t.category]}
                count={t.active}
                stale={t.stale}
              />
            ))}
        </nav>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-label="Findings" className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <h2 className="text-[13px] font-medium">
                {topic ? TOPIC_LABEL[topic] : "All topics"} · newest first
              </h2>
              <span className="text-[12px] text-faint">{shown.length} shown</span>
            </div>
            {shown.length === 0 && (
              <p className="py-6 text-[13.5px] text-faint">
                Nothing verified here yet. Reproduce something, tell Sabi, and it becomes the first
                record.
              </p>
            )}
            {shown.map((h) => (
              <FindingCard key={h.memory_id} hit={h} network={net} mock={mock} />
            ))}
          </section>

          <aside className="flex flex-col gap-8">
            <section aria-label="Contributors">
              <div className="flex items-baseline justify-between border-b border-line pb-3">
                <h2 className="text-[13px] font-medium">Contributors</h2>
                <span className="text-[12px] text-faint">by points</span>
              </div>
              {index.contributors.length === 0 && (
                <p className="py-4 text-[13px] text-faint">No members have stored a finding yet.</p>
              )}
              <ol className="flex flex-col">
                {index.contributors.slice(0, 15).map((c, i) => (
                  <li key={c.handle} className="flex items-center gap-3 border-b border-line py-3">
                    <span className="nums mono w-5 text-[11.5px] text-faint">{i + 1}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <a
                        href={profileHref(c.handle)}
                        className="truncate text-[14px] underline decoration-line2 underline-offset-2 hover:decoration-ink"
                      >
                        {c.handle}
                      </a>
                      <span className="nums text-[11.5px] text-faint">
                        {c.findings} found · confirmed by {c.confirmedBy} · {c.confirmationsGiven} confirmed
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="nums display text-[15px] font-medium">{c.points}</span>
                      <LevelTag name={c.level.name} title={c.level.rule} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-label="How levels work" className="flex flex-col gap-3">
              <h2 className="border-b border-line pb-3 text-[13px] font-medium">How levels work</h2>
              <p className="text-[12.5px] leading-relaxed text-muted">
                A finding earns {POINTS.finding} points. Each member who reproduces it adds{" "}
                {POINTS.confirmed}; confirming someone else&apos;s earns {POINTS.confirmedOther}.
                Confirming your own refreshes its date but earns nothing.
              </p>
              <dl className="flex flex-col gap-2.5">
                {LEVELS.map((l) => (
                  <div key={l.id} className="grid grid-cols-[84px_1fr] items-baseline gap-3">
                    <dt>
                      <LevelTag name={l.name} />
                    </dt>
                    <dd className="text-[12.5px] leading-relaxed text-muted">
                      {l.rule}
                      {l.unlocks && <span className="block text-faint">{l.unlocks}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </aside>
        </div>
      </ViewerProvider>
    </PageShell>
  );
}

function TopicChip({
  href,
  active,
  label,
  count,
  stale = 0,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  stale?: number;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      title={stale ? `${stale} stale` : undefined}
      className={`nums inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
        active ? "border-ink text-ink" : "border-line text-muted hover:border-line2 hover:text-ink"
      }`}
    >
      {label}
      <span className={active ? "text-muted" : "text-faint"}>{count}</span>
      {stale > 0 && <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-label={`${stale} stale`} />}
    </a>
  );
}
