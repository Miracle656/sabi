// Daily: refresh every member's watched balances, so burn is measured even on
// days nobody opens the page. Vercel Cron sends `Authorization: Bearer
// $CRON_SECRET` when CRON_SECRET is set on the project; without it this route
// refuses, so it can never be triggered by a stranger.

import { snapshotEveryone } from "@/lib/watchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await snapshotEveryone());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
