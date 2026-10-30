// Typeahead for the top-bar search: verified findings whose text matches every
// word, from the cached community index (no extra memory reads per keystroke),
// plus members whose handle matches.

import { communityIndex } from "@/lib/community";
import { byRecency } from "@/lib/reputation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 120);
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return Response.json({ findings: [], members: [], total: 0 });
  try {
    const index = await communityIndex();
    const hits = index.active
      .filter((h) => words.every((w) => h.text.toLowerCase().includes(w)))
      // Subject matches first: that is what the user is most likely naming.
      .sort((a, b) => {
        const sa = words.every((w) => a.finding!.subject.toLowerCase().includes(w)) ? 0 : 1;
        const sb = words.every((w) => b.finding!.subject.toLowerCase().includes(w)) ? 0 : 1;
        return sa - sb || byRecency(a, b);
      });
    const handle = q.replace(/^@+/, "");
    return Response.json({
      total: hits.length,
      findings: hits.slice(0, 6).map((h) => ({
        memory_id: h.memory_id,
        category: h.finding!.category,
        subject: h.finding!.subject,
        fix: h.finding!.fix,
        verifiedOn: h.last_verified ?? h.finding!.verifiedOn,
        reportedBy: h.finding!.reportedBy ?? null,
        stale: h.stale,
        confirmations: h.confirmations?.filter((c) => !c.self).length ?? 0,
      })),
      members: index.contributors
        .filter((c) => c.handle.toLowerCase().replace(/^@+/, "").includes(handle))
        .slice(0, 3)
        .map((c) => ({ handle: c.handle, level: c.level.name, points: c.points })),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err), findings: [], members: [] });
  }
}
