// Members: everyone who verified or confirmed something, as a grid, with a
// filter and sort tabs - and the rules that turn findings into levels.

import { communityIndex } from "@/lib/community";
import { profileHref } from "@/lib/links";
import { LEVELS, POINTS, type Contributor } from "@/lib/reputation";
import { TOPICS } from "@/lib/topics";
import { viewer } from "@/lib/viewer";
import { Identicon } from "@/components/identicon";
import { LevelTag, PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SORTS = {
  points: { label: "Points", by: (a: Contributor, b: Contributor) => b.points - a.points },
  findings: { label: "Findings", by: (a: Contributor, b: Contributor) => b.findings - a.findings },
  confirmed: {
    label: "Most confirmed",
    by: (a: Contributor, b: Contributor) => b.confirmationsReceived - a.confirmationsReceived,
  },
  helpers: {
    label: "Helpers",
    by: (a: Contributor, b: Contributor) => b.confirmationsGiven - a.confirmationsGiven,
  },
  recent: {
    label: "Recently active",
    by: (a: Contributor, b: Contributor) => (a.lastActive < b.lastActive ? 1 : -1),
  },
} as const;
type SortKey = keyof typeof SORTS;

type Search = Promise<{ [key: string]: string | string[] | undefined }>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MembersPage(props: { searchParams: Search }) {
  const params = await props.searchParams;
  const sort: SortKey = one(params.sort) in SORTS ? (one(params.sort) as SortKey) : "points";
  const filter = one(params.filter).trim().replace(/^@+/, "").toLowerCase().slice(0, 40);
  const who = await viewer();
  const shell = { ...who, active: "members" as const };

  let index;
  try {
    index = await communityIndex();
  } catch (err) {
    return (
      <PageShell {...shell}>
        <h1 className="display text-[32px] font-normal">Members</h1>
        <p className="mt-4 text-[14px] text-warn">
          Couldn&apos;t reach Walrus Memory ({err instanceof Error ? err.message : String(err)}).
        </p>
      </PageShell>
    );
  }

  const members = index.contributors
    .filter((c) => !filter || c.handle.toLowerCase().includes(filter))
    .sort((a, b) => SORTS[sort].by(a, b) || b.points - a.points);
  const tab = (key: SortKey) =>
    `/members?sort=${key}${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`;

  return (
    <PageShell {...shell}>
      <h1 className="display text-[30px] font-normal leading-tight sm:text-[36px]">Members</h1>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <form action="/members" method="get" className="w-full max-w-[260px]">
          <input type="hidden" name="sort" value={sort} />
          <label className="flex h-9 items-center gap-2 rounded-[var(--r)] border border-edge bg-[var(--composer-fill)] px-2.5 focus-within:border-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-faint" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <span className="sr-only">Filter by member</span>
            <input
              type="search"
              name="filter"
              defaultValue={filter}
              placeholder="Filter by member"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
            />
          </label>
        </form>

        <nav aria-label="Sort members" className="flex max-w-full overflow-x-auto rounded-[var(--r)] border border-line p-1">
          {(Object.keys(SORTS) as SortKey[]).map((key) => (
            <a
              key={key}
              href={tab(key)}
              aria-current={sort === key ? "page" : undefined}
              className={`whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[13px] transition-colors ${
                sort === key ? "bg-soft font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {SORTS[key].label}
            </a>
          ))}
        </nav>
      </div>

      {members.length === 0 ? (
        <p className="py-10 text-[14px] text-faint">
          {filter ? `No member matches “${filter}”.` : "No members have stored a finding yet."}
        </p>
      ) : (
        <ul className="mt-7 grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {members.map((c) => (
            <li key={c.handle} className="flex min-w-0 gap-3">
              <a href={profileHref(c.handle)} aria-hidden="true" tabIndex={-1} className="shrink-0">
                <Identicon seed={c.handle} size={48} />
              </a>
              <div className="flex min-w-0 flex-col gap-0.5">
                <a
                  href={profileHref(c.handle)}
                  className="truncate text-[15px] text-ink underline decoration-line2 underline-offset-2 hover:decoration-ink"
                >
                  {c.handle}
                </a>
                <span className="text-[12px] text-muted">
                  {c.level.name}
                  {(c.packages ?? 0) > 0 && (
                    <span className="text-ok"> · Sui builder, {c.packages} {c.packages === 1 ? "package" : "packages"}</span>
                  )}
                </span>
                <span className="nums text-[13px] font-medium">
                  {c.points} <span className="font-normal text-faint">points</span>
                </span>
                <span className="nums text-[12px] text-faint">
                  {c.findings} found · confirmed by {c.confirmedBy} · {c.confirmationsGiven} confirmed
                </span>
                {c.categories.length > 0 && (
                  <span className="flex flex-wrap gap-x-2 text-[12px]">
                    {c.categories.slice(0, 3).map((cat) => (
                      <a
                        key={cat}
                        href={`/community?topic=${cat.toLowerCase()}`}
                        className="text-muted underline decoration-line2 underline-offset-2 hover:text-ink"
                      >
                        {TOPICS[cat].label.toLowerCase()}
                      </a>
                    ))}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <section id="levels" aria-label="How levels work" className="mt-14 max-w-[720px] scroll-mt-6 border-t border-line pt-8">
        <h2 className="display text-[20px] font-medium">How points and levels work</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Points reward being confirmed, not posting. A finding you verified earns {POINTS.finding}.
          Each member who reproduces one of yours adds {POINTS.confirmed}. Confirming someone
          else&apos;s finding earns {POINTS.confirmedOther}. Confirming your own refreshes its date
          but earns nothing. Everything is recomputed from the memories on Walrus.
        </p>
        <dl className="mt-5 flex flex-col">
          {LEVELS.map((l) => (
            <div key={l.id} className="grid grid-cols-[96px_1fr] items-baseline gap-4 border-b border-line py-3">
              <dt>
                <LevelTag name={l.name} />
              </dt>
              <dd className="text-[13px] leading-relaxed text-muted">
                {l.rule}
                {l.unlocks && <span className="block text-ink">Unlocks: {l.unlocks.toLowerCase()}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </PageShell>
  );
}
