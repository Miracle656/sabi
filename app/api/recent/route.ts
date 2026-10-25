// The newest verified findings, for the first-run screen. Read from the
// community index, which sweeps the namespace newest-first per topic - a real
// recency feed while the namespace fits in the sweep (the index reports its
// coverage when it does not).

import { communityIndex } from "@/lib/community";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const index = await communityIndex();
    const rows = index.active.slice(0, 5).map((h) => ({
      memory_id: h.memory_id,
      stale: h.stale,
      age_days: h.age_days,
      category: h.finding!.category,
      subject: h.finding!.subject,
      fix: h.finding!.fix,
      verifiedOn: h.last_verified ?? h.finding!.verifiedOn,
      reportedBy: h.finding!.reportedBy ?? null,
      confirmations: h.confirmations?.filter((c) => !c.self).length ?? 0,
    }));
    return Response.json({ rows, total: index.active.length });
  } catch (err) {
    return Response.json(
      { rows: [], error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
