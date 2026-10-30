// The "This worked for me" button. Signed-in only: a confirmation is worth
// exactly the name on it, and the name comes from the session cookie, never
// from the request body.

import { cookies } from "next/headers";
import { ConfirmInputSchema, confirmAction } from "@/lib/actions";
import { todayISO } from "@/lib/findings";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) {
    return Response.json(
      { status: "error", error: "Sign in to confirm, so the confirmation carries your name." },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ status: "error", error: "bad request" }, { status: 400 });
  }
  const input = ConfirmInputSchema.safeParse(body);
  if (!input.success) {
    return Response.json({ status: "error", error: "memory_id and subject are required" }, { status: 400 });
  }
  const res = await confirmAction(input.data, {
    reporter: session.handle,
    today: todayISO(),
    address: session.address,
  });
  return Response.json(res, { status: res.status === "error" ? 422 : 200 });
}
