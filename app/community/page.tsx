// Findings: the newest verified findings, filterable by topic and searchable,
// rebuilt from Walrus Memory by the community index (lib/community.ts).

import { CATEGORIES } from "@/lib/findings";
import { communityIndex } from "@/lib/community";
import { mode, network } from "@/lib/memwal";
import { profileHref } from "@/lib/links";
import { TOPICS } from "@/lib/topics";
import { viewer } from "@/lib/viewer";
import { FindingCard, ViewerProvider } from "@/components/memory-card";
import { LevelTag, PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function FindingsPage(props: { searchParams: Search }) {
  const params = await props.searchParams;
  const topic = CATEGORIES.find((c) => c === one(params.topic).toUpperCase());
  const q = one(params.q).trim().slice(0, 120);
  const who = await viewer();
  const shell = { ...who, active: "findings" as const, query: q };

  let index;
  try {
    index = await communityIndex();
  } catch (err) {
    return (
      <PageShell {...shell}>
        <h1 className="display text-[32px] font-normal">Findings</h1>
        <p className="mt-4 max-w-[60ch] text-[14px] text-warn">
          Couldn&apos;t reach Walrus Memory to build the index ({err instanceof Error ? err.message : String(err)}).
          Nothing is lost; try again in a minute.
        </p>
      </PageShell>
    );
  }

  const net = await network();
  const mock = mode() === "mock";
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = index.active.filter(
    (h) =>
      (!topic || h.finding?.category === topic) &&
      words.every((w) => h.text.toLowerCase().includes(w)),
  );
  const shown = matches.slice(0, 60);
  const { indexed, total } = index.coverage;
  const heading = q ? `Results for “${q}”` : topic ? TOPICS[topic].label : "All findings";

  return (
    <PageShell {...shell}>
      <ViewerProvider value={{ handle: who.user?.handle }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="display text-[30px] font-normal leading-tight sm:text-[36px]">{heading}</h1>
            <p className="nums text-[13px] text-muted">
              {matches.length} {matches.length === 1 ? "finding" : "findings"}
              {q && (
                <>
                  {" · "}
                  <a href={topic ? `/community?topic=${topic.toLowerCase()}` : "/community"} className="underline decoration-line2 underline-offset-2 hover:text-ink">
                    clear search
                  </a>
                </>
              )}
            </p>
          </div>
          <a
            href="/"
            className="rounded-[var(--r)] bg-ink px-3.5 py-2 text-[13.5px] font-medium text-[var(--paper)] transition-opacity hover:opacity-85"
          >
            Ask Sabi
          </a>
        </div>

        <nav aria-label="Topics" className="mt-6 flex flex-wrap gap-2">
          <TopicChip href={q ? `/community?q=${encodeURIComponent(q)}` : "/community"} active={!topic} label="All" count={index.active.length} />
          {index.topics
            .filter((t) => t.active > 0 || t.category === topic)
            .map((t) => (
              <TopicChip
                key={t.category}
                href={`/community?topic=${t.category.toLowerCase()}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                active={topic === t.category}
                label={TOPICS[t.category].label}
                count={t.active}
                stale={t.stale}
              />
            ))}
        </nav>

        <div className="mt-7 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section aria-label="Findings" className="flex min-w-0 flex-col gap-3">
            {shown.length === 0 && (
              <p className="border-t border-line py-6 text-[13.5px] text-faint">
                {q
                  ? "No verified finding matches that. Ask Sabi: it searches by meaning, not just words."
                  : "Nothing verified here yet. Reproduce something, tell Sabi, and it becomes the first record."}
              </p>
            )}
            {shown.map((h) => (
              <FindingCard key={h.memory_id} hit={h} network={net} mock={mock} />
            ))}
          </section>

          <aside className="flex flex-col gap-8">
            <section aria-label="Top members">
              <div className="flex items-baseline justify-between border-b border-line pb-3">
                <h2 className="text-[13px] font-medium">Top members</h2>
                <a href="/members" className="text-[12px] text-faint hover:text-ink">
                  All members &rarr;
                </a>
              </div>
              {index.contributors.length === 0 && (
                <p className="py-4 text-[13px] text-faint">No members have stored a finding yet.</p>
              )}
              <ol className="flex flex-col">
                {index.contributors.slice(0, 6).map((c, i) => (
                  <li key={c.handle} className="flex items-center gap-3 border-b border-line py-3">
                    <span className="nums mono w-4 text-[11.5px] text-faint">{i + 1}</span>
                    <a
                      href={profileHref(c.handle)}
                      className="min-w-0 flex-1 truncate text-[13.5px] underline decoration-line2 underline-offset-2 hover:decoration-ink"
                    >
                      {c.handle}
                    </a>
                    <span className="nums text-[13px] font-medium">{c.points}</span>
                    <LevelTag name={c.level.name} title={c.level.rule} />
                  </li>
                ))}
              </ol>
            </section>

            <p className="nums text-[12px] leading-relaxed text-faint">
              {total === null
                ? `Indexed ${indexed} ${indexed === 1 ? "memory" : "memories"}`
                : indexed >= total
                  ? total === 1
                    ? "Indexed the only memory in the namespace"
                    : `Indexed all ${total} memories in the namespace`
                  : `Indexed ${indexed} of ${total} memories; the rest are still searchable from chat`}
              . Rebuilt from Walrus Memory, so there is no separate database to trust. Refreshed{" "}
              {new Date(index.builtAt).toUTCString().slice(17, 22)} UTC.
            </p>
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
