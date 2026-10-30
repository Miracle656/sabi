// Streaming chat with the two memory tools. Every model in the switcher goes
// through this same route, so "different model, same memory" is literally true:
// the tools, the namespace and the delegate key do not change when the model does.

import { cookies } from "next/headers";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getEnv, missingVars } from "@/lib/env";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { DEFAULT_MODEL_ID, isClaudeModel, modelIds } from "@/lib/models";
import { buildSystemPrompt } from "@/lib/sabi-prompt";
import { todayISO } from "@/lib/findings";
import { searchFindings } from "@/lib/memwal";
import { withTrust } from "@/lib/community";
import { InspectInputSchema, RuleInputSchema, WatchInputSchema, inspectAction } from "@/lib/diagnose";
import { addRule, addWatch, projectStatus, statusForModel } from "@/lib/watchdog";
import {
  ConfirmInputSchema,
  RememberInputSchema,
  confirmAction,
  rememberAction,
} from "@/lib/actions";

export const maxDuration = 120;

interface Body {
  messages: UIMessage[];
  model?: string;
}

// Groq serves open-weight models behind an OpenAI-compatible Chat Completions
// endpoint, so the installed OpenAI provider reaches it with a different base
// URL. `.chat()` is required: the provider's default is the Responses API.
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Pick the requested model, but only if its provider actually has a key. An
 * unknown or unkeyed id falls back to a provider that IS configured rather than
 * to Anthropic unconditionally - otherwise an OpenAI-only deployment would send
 * every request to a provider it cannot authenticate with.
 */
function resolveModel(id: string | undefined): { model: LanguageModel; id: string } {
  const env = getEnv();
  const hasClaude = Boolean(env.anthropicKey);
  const hasOpenAI = Boolean(env.openaiKey);
  const hasGroq = Boolean(env.groqKey);
  const openaiIds = modelIds(env.openaiModels);
  const groqIds = modelIds(env.groqModels);
  const groq = createOpenAI({ name: "groq", baseURL: GROQ_BASE_URL, apiKey: env.groqKey });
  const wanted = (id ?? "").trim();

  if (hasClaude && isClaudeModel(wanted)) return { model: anthropic(wanted), id: wanted };
  if (hasOpenAI && openaiIds.includes(wanted)) return { model: openai(wanted), id: wanted };
  if (hasGroq && groqIds.includes(wanted)) return { model: groq.chat(wanted), id: wanted };
  if (hasClaude) return { model: anthropic(DEFAULT_MODEL_ID), id: DEFAULT_MODEL_ID };
  if (hasOpenAI && openaiIds[0]) return { model: openai(openaiIds[0]), id: openaiIds[0] };
  if (hasGroq && groqIds[0]) return { model: groq.chat(groqIds[0]), id: groqIds[0] };
  // missingVars() rejects the request before this can be reached.
  throw new Error("No model provider is configured.");
}

export async function POST(req: Request) {
  const missing = missingVars();
  if (missing.length) {
    return Response.json(
      { error: `Setup needed: ${missing.map((m) => m.name).join(", ")}` },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const env = getEnv();
  const today = todayISO();
  const resolved = resolveModel(body.model);
  // Never substitute silently: the client labels the transcript with the model
  // it asked for, so a fallback here would mislabel every message.
  if (body.model && resolved.id !== body.model) {
    return Response.json(
      { error: `Model ${body.model} is not available on this instance.` },
      { status: 400 },
    );
  }
  const { model } = resolved;
  // A signed-in visitor writes under their Google-verified handle; anonymous
  // visitors fall back to this instance's SABI_REPORTER. Never model-controlled.
  const session = openSession((await cookies()).get(SESSION_COOKIE)?.value);
  const reporter = session?.handle ?? env.reporter;

  const tools = {
    recall_findings: tool({
      description:
        "Semantic search over the community's verified findings on Walrus Memory. Call BEFORE answering any troubleshooting, blocker, provider-choice or integration question. Returns active findings (answer from these), superseded findings (history only), and stale flags computed from the VERIFIED date.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe("Natural-language description of the problem, provider, or subject."),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)."),
      }),
      execute: async ({ query, limit }) => {
        try {
          const res = withTrust(await searchFindings(query, { limit, today }));
          return {
            query,
            today,
            active: res.active,
            superseded: res.superseded,
            note:
              res.active.length === 0 && res.superseded.length === 0
                ? "No relevant community findings. Answer from general knowledge and label it unverified."
                : undefined,
          };
        } catch (err) {
          return { query, error: describe(err) };
        }
      },
    }),
    inspect_transaction: tool({
      description:
        "Read a Sui mainnet transaction (via Tatum) and name its failure exactly: abort code, package::module::function, gas. Then recalls community findings for that exact failure. Call FIRST whenever the user shares a transaction digest or an explorer link.",
      inputSchema: InspectInputSchema,
      execute: (input) => inspectAction(input, today, session?.handle),
    }),
    watch_address: tool({
      description:
        "Start watching a Sui address for the signed-in user: its SUI balance is read through Tatum and remembered over time, so Sabi can spot spend spikes, low gas runway and recurring failures. Use when the user names their project's deployer/treasury address or asks Sabi to keep an eye on it.",
      inputSchema: WatchInputSchema,
      execute: async ({ address, label }) =>
        session
          ? addWatch(session.handle, address, label ?? "").catch((err: unknown) => ({
              status: "error" as const,
              error: err instanceof Error ? err.message : String(err),
            }))
          : { status: "error" as const, error: "Refused: watching is personal memory, so the user must sign in first." },
    }),
    set_escalation_rule: tool({
      description:
        "Remember how the signed-in user wants their project alerts handled: escalate (always flag), mute (stop flagging), set a threshold, or clear a rule. Call whenever the user says what they care about or don't ('always tell me about enoki', 'stop flagging rate limits', 'only warn me at 3x spend'), or corrects an alert. The newest rule for a target replaces the old one.",
      inputSchema: RuleInputSchema,
      execute: async ({ action, target, reason }) =>
        session
          ? addRule(session.handle, action, target, reason).catch((err: unknown) => ({
              status: "error" as const,
              error: err instanceof Error ? err.message : String(err),
            }))
          : { status: "error" as const, error: "Refused: rules are personal memory, so the user must sign in first." },
    }),
    project_status: tool({
      description:
        "The signed-in user's watched projects from their personal memory: balance, burn per day vs their baseline, runway, alerts, failures seen and the community's fixes for them. Call when the user asks how their project is doing, about gas spend, or what has been failing.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!session) return { error: "Sign in to see your project." };
        try {
          return statusForModel(await projectStatus(session.handle));
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
    remember_finding: tool({
      description:
        "Store ONE verified, reproducible finding as a durable memory on Walrus. Only after the user confirms they reproduced the issue or the fix themselves. Run recall_findings on the subject first; if an active memory contradicts this one, pass its memory_id as supersedes_memory_id (storage is append-only - nothing is deleted). If an active memory already says the same thing, use confirm_finding instead.",
      // Attribution is NOT model-controlled: the reporter comes from the session.
      inputSchema: RememberInputSchema,
      execute: (input) => rememberAction(input, { reporter, today, address: session?.address }),
    }),
    confirm_finding: tool({
      description:
        "Record that the signed-in user reproduced an EXISTING active finding themselves. Use instead of remember_finding when recall already returned a finding that says the same thing. Credits the original author and moves the finding's last-verified date to today.",
      inputSchema: ConfirmInputSchema,
      execute: async (input) =>
        // An anonymous confirmation would carry the operator's name, which says
        // nothing about who reproduced it.
        session
          ? confirmAction(input, { reporter, today, address: session.address })
          : {
              status: "error" as const,
              error: "Refused: confirmations carry the confirmer's name, so the user must sign in first.",
            },
    }),
  };

  const result = streamText({
    model,
    system: buildSystemPrompt({
      today,
      namespace: env.namespace,
      reporter,
    }),
    // A tool call that was aborted mid-flight (Stop button, refresh) leaves a
    // tool part with no output; without this flag every later turn would fail.
    messages: await convertToModelMessages(body.messages, {
      ignoreIncompleteToolCalls: true,
    }),
    tools,
    stopWhen: stepCountIs(8),
    onError: ({ error }) => {
      console.error("[sabi] stream error:", error);
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => `Sabi hit an error: ${describe(error)}`,
  });
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
