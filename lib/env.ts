// Server-side environment. Everything here is read on the server only (API
// routes, server components, scripts); the delegate key never reaches the client
// bundle because nothing here is NEXT_PUBLIC_ and no client component imports it.

export type MemwalMode = "live" | "mock";

export interface SabiEnv {
  mode: MemwalMode;
  delegateKey: string;
  accountId: string;
  relayerUrl: string;
  namespace: string;
  reporter: string;
  anthropicKey: string;
  openaiKey: string;
  /** Comma-separated OpenAI model ids offered in the switcher. */
  openaiModels: string;
  /** Google OAuth client id - presence enables Enoki sign-in. */
  googleClientId: string;
  /** Enoki public API key - lets sign-in also resolve a zkLogin Sui address. */
  enokiKey: string;
  /** HMAC key for the session cookie; required whenever sign-in is enabled. */
  sessionSecret: string;
}

const DEFAULT_RELAYER = "https://relayer.memory.walrus.xyz";
const DEFAULT_NAMESPACE = "sabi";
const DEFAULT_OPENAI_MODELS = "gpt-5,gpt-5-mini";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getEnv(): SabiEnv {
  const mode: MemwalMode = read("MEMWAL_MODE") === "mock" ? "mock" : "live";
  return {
    mode,
    delegateKey: read("MEMWAL_DELEGATE_KEY"),
    accountId: read("MEMWAL_ACCOUNT_ID"),
    relayerUrl: read("MEMWAL_SERVER_URL") || read("MEMWAL_RELAYER_URL") || DEFAULT_RELAYER,
    namespace: read("MEMWAL_NAMESPACE") || DEFAULT_NAMESPACE,
    reporter: normalizeHandle(read("SABI_REPORTER") || "anon"),
    anthropicKey: read("ANTHROPIC_API_KEY"),
    openaiKey: read("OPENAI_API_KEY"),
    openaiModels: read("OPENAI_MODEL") || DEFAULT_OPENAI_MODELS,
    googleClientId: read("GOOGLE_CLIENT_ID") || read("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
    enokiKey: read("ENOKI_API_KEY"),
    sessionSecret: read("SABI_SESSION_SECRET"),
  };
}

/** `@handle` -> `@handle`, `handle` -> `@handle`, strips spaces. */
export function normalizeHandle(raw: string): string {
  const h = raw.replace(/\s+/g, "").replace(/^@+/, "");
  return h ? `@${h}` : "@anon";
}

export interface MissingVar {
  name: string;
  why: string;
  where: string;
}

/** Which variables still block the app from running. Empty = ready. */
export function missingVars(env = getEnv()): MissingVar[] {
  const out: MissingVar[] = [];
  if (env.mode === "live") {
    if (!env.delegateKey)
      out.push({
        name: "MEMWAL_DELEGATE_KEY",
        why: "the Ed25519 delegate key the SDK signs requests with",
        where: "Walrus Memory Playground (https://memory.walrus.xyz) or `pnpm keygen`",
      });
    if (!env.accountId)
      out.push({
        name: "MEMWAL_ACCOUNT_ID",
        why: "the shared Walrus Memory account every Sabi writer points at",
        where: "Walrus Memory Playground (https://memory.walrus.xyz)",
      });
  }
  // Sign-in without a stable HMAC key mis-attributes silently: each process
  // mints its own random key, so a cookie sealed by one instance reads as
  // signed-out on the next, and the write falls back to SABI_REPORTER while the
  // UI still shows the user their handle. Refuse to run half-configured.
  if (env.googleClientId && !env.sessionSecret)
    out.push({
      name: "SABI_SESSION_SECRET",
      why: "signs the session cookie; without it, sign-in silently breaks across restarts/instances",
      where: "any long random string, e.g. `openssl rand -hex 32`",
    });
  // Either provider is enough. The switcher offers whichever keys are present,
  // and the memory tools are identical on both - that is the point of the demo.
  if (!env.anthropicKey && !env.openaiKey)
    out.push({
      name: "ANTHROPIC_API_KEY or OPENAI_API_KEY",
      why: "one model provider key - the switcher offers whichever you set (both is fine)",
      where: "https://console.anthropic.com or https://platform.openai.com/api-keys",
    });
  return out;
}
