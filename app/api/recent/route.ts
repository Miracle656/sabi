// A sample of what the community has actually verified, for the first-run
// screen. MemWal offers vector recall only — there is no "list newest" API — so
// this is a single broad recall across the category vocabulary, re-sorted by
// verification date. It is a SAMPLE, not a complete or strictly-recent list,
// and the UI says so.

import { searchFindings } from "@/lib/memwal";
import { todayISO } from "@/lib/findings";

const BROAD_QUERY =
  "carrier payments wallet rpc tooling regulatory exchange infrastructure Nigeria provider api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await searchFindings(BROAD_QUERY, { limit: 12, today: todayISO() });
    const rows = res.active
      .filter((h) => h.finding)
      .sort((a, b) => (a.finding!.verifiedOn < b.finding!.verifiedOn ? 1 : -1))
      .slice(0, 4)
      .map((h) => ({
        memory_id: h.memory_id,
        stale: h.stale,
        age_days: h.age_days,
        category: h.finding!.category,
        subject: h.finding!.subject,
        fix: h.finding!.fix,
        verifiedOn: h.finding!.verifiedOn,
        reportedBy: h.finding!.reportedBy ?? null,
      }));
    return Response.json({ rows, sampled: res.active.length });
  } catch (err) {
    return Response.json(
      { rows: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
