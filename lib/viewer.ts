// Who is looking, for server pages: the signed-in member (if any) and the
// Google client id the nav needs to offer sign-in. Server-only.

import { cookies } from "next/headers";
import { getEnv } from "./env";
import { SESSION_COOKIE, openSession } from "./session";

export async function viewer(): Promise<{
  user?: { handle: string; address?: string };
  googleClientId?: string;
}> {
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  return {
    user: session ? { handle: session.handle, address: session.address } : undefined,
    googleClientId: getEnv().googleClientId || undefined,
  };
}
