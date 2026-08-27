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
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getEnv, missingVars } from "@/lib/env";
import { SESSION_COOKIE, openSession } from "@/lib/session";
import { CLAUDE_MODELS, DEFAULT_MODEL_ID, isClaudeModel, openaiModelIds } from "@/lib/models";
import { buildSystemPrompt } from "@/lib/sabi-prompt";
import {
  FindingInputSchema,
  formatFinding,
  secretInFinding,
  toFinding,
  todayISO,
} from "@/lib/findings";
import { searchFindings, storeFinding } from "@/lib/memwal";

export const maxDuration = 120;

interface Body {
  messages: UIMessage[];
  model?: string;
}

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
  const openaiIds = openaiModelIds(env.openaiModels);
  const wanted = (id ?? "").trim();

  if (hasClaude && isClaudeModel(wanted)) return { model: anthropic(wanted), id: wanted };
  if (hasOpenAI && openaiIds.includes(wanted)) return { model: openai(wanted), id: wanted };
  if (hasClaude) return { model: anthropic(DEFAULT_MODEL_ID), id: DEFAULT_MODEL_ID };
  if (hasOpenAI && openaiIds[0]) return { model: openai(openaiIds[0]), id: openaiIds[0] };
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
          const res = await searchFindings(query, { limit, today });
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
    remember_finding: tool({
      description:
        "Store ONE verified, reproducible finding as a durable memory on Walrus. Only after the user confirms they reproduced the issue or the fix themselves. Run recall_findings on the subject first; if an active memory contradicts this one, pass its memory_id as supersedes_memory_id (storage is append-only - nothing is deleted).",
      // Attribution is NOT model-controlled: every finding stored through this
      // instance is signed off as env.reporter (the member running it).
      inputSchema: FindingInputSchema.omit({ reported_by: true }),
      execute: async (input) => {
        try {
          const secret = secretInFinding(input);
          if (secret) {
            return {
              status: "error" as const,
              error: `Refused: the finding looks like it contains a secret (${secret}). Strip it and try again.`,
            };
          }
          const finding = toFinding(input, { today, defaultReporter: reporter });
          const text = formatFinding(finding);
          const res = await storeFinding(text);
          return {
            status: res.status,
            memory_id: res.memory_id,
            job_id: res.job_id,
            namespace: res.namespace,
            text,
            finding,
          };
        } catch (err) {
          return { status: "error" as const, error: describe(err) };
        }
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
