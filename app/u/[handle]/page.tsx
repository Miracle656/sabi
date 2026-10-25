// One member's record: level, points, what they verified and what they
// reproduced for others. Derived from the community index like /community.

import { cookies } from "next/headers";
import { sameHandle } from "@/lib/findings";
import { communityIndex } from "@/lib/community";
import { defaultNamespace, mode, network } from "@/lib/memwal";
import { LEVELS, findContributor, levelRank } from "@/lib/reputation";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { FindingCard, ViewerProvider } from "@/components/memory-card";
import { LevelTag, PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function ProfilePage(props: { params: Promise<{ handle: string }> }) {
  const raw = decodeURIComponent((await props.params).handle).replace(/^@+/, "");
  const handle = `@${raw}`;
  const namespace = defaultNamespace();
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);

  let index;
  try {
    index = await communityIndex(namespace);
  } catch (err) {
    return (
      <PageShell namespace={namespace}>
        <h1 className="display text-[34px] font-normal">{handle}</h1>
        <p className="mt-4 max-w-[60ch] text-[14px] text-warn">
          Couldn&apos;t reach Walrus Memory ({err instanceof Error ? err.message : String(err)}). Try
          again in a minute.
        </p>
      </PageShell>
    );
  }

  const net = await network();
  const mock = mode() === "mock";
  const me = findContributor(index.contributors, handle);
  const authored = index.active.filter(
    (h) => sameHandle(h.finding?.reportedBy, handle) && !h.finding?.confirms,
  );
  const reproduced = index.active.filter(
    (h) =>
      !sameHandle(h.finding?.reportedBy, handle) &&
      (h.confirmations ?? []).some((c) => sameHandle(c.by, handle)),
  );
  const level = me?.level ?? LEVELS[0];
  const next = LEVELS[levelRank(level.id) + 1];
  const rank = me ? index.contributors.indexOf(me) + 1 : null;
  const isYou = sameHandle(session?.handle, handle);

  return (
    <PageShell namespace={namespace}>
      <ViewerProvider value={{ handle: session?.handle }}>
        <div className="flex flex-col gap-5 border-b border-line pb-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-soft text-[18px] uppercase text-muted">
              {raw.slice(0, 1)}
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="display text-[30px] font-normal leading-tight sm:text-[36px]">
                {me?.handle ?? handle}
                {isYou && <span className="ml-3 align-middle text-[13px] text-faint">you</span>}
              </h1>
              <div className="flex items-center gap-2.5">
                <LevelTag name={level.name} title={level.rule} />
                {rank && <span className="nums text-[12px] text-faint">#{rank} of {index.contributors.length}</span>}
              </div>
            </div>
          </div>

          <dl className="nums grid max-w-[640px] grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat label="points" value={me?.points ?? 0} />
            <Stat label="findings verified" value={me?.findings ?? 0} />
            <Stat label="members who confirmed them" value={me?.confirmedBy ?? 0} />
            <Stat label="findings reproduced for others" value={me?.confirmationsGiven ?? 0} />
          </dl>

          <p className="max-w-[64ch] text-[13px] leading-relaxed text-muted">
            {next ? (
              <>
                Next level: <span className="text-ink">{next.name}</span> — {next.rule.toLowerCase()}.
                {next.unlocks && ` ${next.unlocks}.`}
              </>
            ) : (
              "Top level reached."
            )}
          </p>
        </div>

        {!me && (
          <p className="py-8 text-[14px] text-faint">
            {handle} has no verified findings or confirmations in the index yet.
          </p>
        )}

        {authored.length > 0 && (
          <section className="mt-8 flex flex-col gap-3">
            <h2 className="border-b border-line pb-3 text-[13px] font-medium">
              Verified by {me?.handle ?? handle} · {authored.length} current
            </h2>
            {authored.map((h) => (
              <FindingCard key={h.memory_id} hit={h} network={net} mock={mock} />
            ))}
          </section>
        )}

        {reproduced.length > 0 && (
          <section className="mt-10 flex flex-col gap-3">
            <h2 className="border-b border-line pb-3 text-[13px] font-medium">
              Reproduced for others · {reproduced.length}
            </h2>
            {reproduced.map((h) => (
              <FindingCard key={h.memory_id} hit={h} network={net} mock={mock} />
            ))}
          </section>
        )}
      </ViewerProvider>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    // dt must precede dd; column-reverse puts the number on top.
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-[11.5px] text-faint">{label}</dt>
      <dd className="display text-[26px] font-medium">{value}</dd>
    </div>
  );
}
