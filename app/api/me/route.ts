// The signed-in member's standing for the nav: points, level, rank. Read from
// the cached community index, so it costs nothing extra once the index is warm.

import { cookies } from "next/headers";
import { communityIndex } from "@/lib/community";
import { LEVELS, findContributor } from "@/lib/reputation";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: "not signed in" }, { status: 401 });
  try {
    const index = await communityIndex();
    const me = findContributor(index.contributors, session.handle);
    return Response.json({
      handle: session.handle,
      points: me?.points ?? 0,
      level: (me?.level ?? LEVELS[0]).name,
      rank: me ? index.contributors.indexOf(me) + 1 : null,
    });
  } catch {
    return Response.json({ handle: session.handle });
  }
}
