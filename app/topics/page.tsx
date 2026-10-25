// Topics: one card per category with how much the community has verified
// there, how much of it needs re-confirming, and when it was last touched.

import { communityIndex } from "@/lib/community";
import { TOPICS } from "@/lib/topics";
import { viewer } from "@/lib/viewer";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function TopicsPage() {
  const who = await viewer();
  const shell = { ...who, active: "topics" as const };

  let index;
  try {
    index = await communityIndex();
  } catch (err) {
    return (
      <PageShell {...shell}>
        <h1 className="display text-[32px] font-normal">Topics</h1>
        <p className="mt-4 text-[14px] text-warn">
          Couldn&apos;t reach Walrus Memory ({err instanceof Error ? err.message : String(err)}).
        </p>
      </PageShell>
    );
  }

  // Busiest first; empty topics still show, so members see where help is missing.
  const topics = [...index.topics].sort((a, b) => b.active - a.active);

  return (
    <PageShell {...shell}>
      <h1 className="display text-[30px] font-normal leading-tight sm:text-[36px]">Topics</h1>
      <p className="mt-2 max-w-[62ch] text-[14px] text-muted">
        Every finding is filed under one topic. Volatile topics expire: a finding there goes stale
        60 days after anyone last verified or confirmed it.
      </p>

      <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topics.map((t) => (
          <a
            key={t.category}
            href={`/community?topic=${t.category.toLowerCase()}`}
            className="flex flex-col gap-2.5 rounded-[var(--r)] border border-line p-4 transition-colors hover:border-line2 hover:bg-surface2"
          >
            <span className="inline-flex w-fit rounded-[6px] bg-soft px-2 py-1 text-[12.5px] font-medium text-ink">
              {TOPICS[t.category].label}
            </span>
            <span className="text-[13px] leading-relaxed text-muted">{TOPICS[t.category].about}</span>
            <span className="nums mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[12px] text-faint">
              <span className="text-ink">
                {t.active} {t.active === 1 ? "finding" : "findings"}
              </span>
              {t.stale > 0 && <span className="text-warn">{t.stale} stale</span>}
              {t.latest && <span>last verified {t.latest}</span>}
            </span>
          </a>
        ))}
      </div>
    </PageShell>
  );
}
