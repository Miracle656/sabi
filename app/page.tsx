// Server component: reads env, decides between the setup screen and the app,
// and hands the client ONLY non-secret config (namespace, mode, model list).

import { cookies } from "next/headers";
import { SetupScreen } from "@/components/setup-screen";
import { SabiApp } from "@/components/sabi-app";
import { getEnv, missingVars } from "@/lib/env";
import { availableModels } from "@/lib/models";
import { network } from "@/lib/memwal";
import { SESSION_COOKIE, openSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const env = getEnv();
  const missing = missingVars(env);
  if (missing.length) {
    return <SetupScreen missing={missing} mode={env.mode} />;
  }
  const models = availableModels({
    anthropic: Boolean(env.anthropicKey),
    openai: Boolean(env.openaiKey),
    openaiModels: env.openaiModels,
  });
  if (models.length === 0) {
    // Keys are present but the model list parsed to nothing (e.g. OPENAI_MODEL=",").
    return (
      <SetupScreen
        missing={[
          {
            name: "OPENAI_MODEL",
            why: "the configured model list parsed to zero runnable models",
            where: 'comma-separated ids, e.g. "gpt-5.5,gpt-5.4-mini"',
          },
        ]}
        mode={env.mode}
      />
    );
  }
  const net = await network();
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <SabiApp
      namespace={env.namespace}
      mode={env.mode}
      network={net}
      reporter={session?.handle ?? env.reporter}
      models={models}
      user={session ? { handle: session.handle, address: session.address } : undefined}
      googleClientId={env.googleClientId || undefined}
    />
  );
}
