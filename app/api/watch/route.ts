// The signed-in member's watchdog: GET reads (and refreshes stale balances),
// POST starts watching an address. Personal memory, so sign-in is required.

import { cookies } from "next/headers";
import { addWatch, projectStatus } from "@/lib/watchdog";
import { jsonSafe } from "@/lib/watch";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function member() {
  return openSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function GET() {
  const session = await member();
  if (!session) return Response.json({ error: "Sign in to see your project." }, { status: 401 });
  try {
    return Response.json(jsonSafe(await projectStatus(session.handle)));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const session = await member();
  if (!session) return Response.json({ status: "error", error: "Sign in to watch an address." }, { status: 401 });
  let body: { address?: unknown; label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ status: "error", error: "bad request" }, { status: 400 });
  }
  if (typeof body.address !== "string") {
    return Response.json({ status: "error", error: "address is required" }, { status: 400 });
  }
  try {
    const res = await addWatch(session.handle, body.address, typeof body.label === "string" ? body.label : "");
    return Response.json(res, { status: res.status === "error" ? 422 : 200 });
  } catch (err) {
    return Response.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
