// One escalation rule from the "Your project" page buttons (Escalate, Mute,
// Remove). The same rules the chat learns from conversation.

import { cookies } from "next/headers";
import { RuleInputSchema } from "@/lib/diagnose";
import { addRule } from "@/lib/watchdog";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ status: "error", error: "Sign in first." }, { status: 401 });
  const input = RuleInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ status: "error", error: "bad rule" }, { status: 400 });
  try {
    const res = await addRule(session.handle, input.data.action, input.data.target, input.data.reason);
    return Response.json(res, { status: res.status === "error" ? 422 : 200 });
  } catch (err) {
    return Response.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
