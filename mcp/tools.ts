// The ONE registration of Sabi's MCP surface. Both transports use it - the
// stdio server (Claude Desktop, Cursor) and the remote HTTP endpoint
// (claude.ai, ChatGPT web) - so "same tools, same rules everywhere" is a fact
// of the module graph, not a promise.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getEnv } from "../lib/env";
import { buildSystemPrompt } from "../lib/sabi-prompt";
import { todayISO } from "../lib/findings";
import { defaultNamespace, mode, searchFindings } from "../lib/memwal";
import { InspectInputSchema, RuleInputSchema, WatchInputSchema, inspectAction } from "../lib/diagnose";
import { addRule, addWatch, projectStatus, statusForModel } from "../lib/watchdog";
import {
  ConfirmInputSchema,
  RememberInputSchema,
  confirmAction,
  rememberAction,
  type WriteResult,
} from "../lib/actions";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function write(res: WriteResult) {
  if (res.status === "error") return failure(res.error);
  return text({
    ...res,
    mode: mode(),
    // A client must never relay a mock write as durable storage.
    warning:
      mode() === "mock"
        ? "MOCK MODE: stored in-memory only - nothing reached Walrus and this id is not a Walrus blob."
        : undefined,
  });
}

export function registerSabi(server: McpServer): void {
  server.registerTool(
    "recall_findings",
    {
      title: "Recall community findings",
      description:
        "Semantic search over the community's verified findings on Walrus Memory. Call BEFORE answering any troubleshooting, blocker, provider-choice or integration question. Returns active findings (answer from these), superseded findings (history only), and stale flags computed from the VERIFIED date.",
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe("Natural-language description of the problem, provider, or subject."),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)."),
      },
    },
    async ({ query, limit }) => {
      const today = todayISO();
      try {
        const res = await searchFindings(query, { limit, today });
        return text({
          query,
          today,
          namespace: defaultNamespace(),
          mode: mode(),
          active: res.active,
          superseded: res.superseded,
          note:
            res.active.length === 0 && res.superseded.length === 0
              ? "No relevant community findings. Answer from general knowledge and label it unverified."
              : undefined,
        });
      } catch (err) {
        return failure(`recall failed: ${describe(err)}`);
      }
    },
  );

  server.registerTool(
    "inspect_transaction",
    {
      title: "Diagnose a Sui transaction",
      description:
        "Read a Sui mainnet transaction (via Tatum) and name its failure exactly: abort code, package::module::function, gas. Then recalls community findings for that exact failure. Call FIRST whenever the user shares a transaction digest or an explorer link.",
      inputSchema: InspectInputSchema.shape,
    },
    async (input) => {
      const res = await inspectAction(input, todayISO(), getEnv().reporter);
      return res.status === "error" ? failure(res.error) : text(res);
    },
  );

  // MCP has no sign-in: the watchdog belongs to this instance's SABI_REPORTER,
  // the same member every write through this server is attributed to.
  server.registerTool(
    "watch_address",
    {
      title: "Watch a Sui address",
      description:
        "Start watching a Sui address: its SUI balance is read through Tatum and remembered over time, so Sabi can spot spend spikes, low gas runway and recurring failures.",
      inputSchema: WatchInputSchema.shape,
    },
    async ({ address, label }) => {
      try {
        const res = await addWatch(getEnv().reporter, address, label ?? "");
        return res.status === "error" ? failure(res.error) : text(res);
      } catch (err) {
        return failure(describe(err));
      }
    },
  );

  server.registerTool(
    "set_escalation_rule",
    {
      title: "Remember an alert preference",
      description:
        "Remember how project alerts should be handled: escalate (always flag), mute (stop flagging), set a threshold, or clear a rule. Call whenever the user says what they care about or don't, or corrects an alert. The newest rule for a target replaces the old one.",
      inputSchema: RuleInputSchema.shape,
    },
    async ({ action, target, reason }) => {
      try {
        const res = await addRule(getEnv().reporter, action, target, reason);
        return res.status === "error" ? failure(res.error) : text(res);
      } catch (err) {
        return failure(describe(err));
      }
    },
  );

  server.registerTool(
    "project_status",
    {
      title: "How is my project doing",
      description:
        "Watched projects from personal memory: balance, burn per day vs baseline, runway, alerts, failures seen and the community's fixes for them.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(statusForModel(await projectStatus(getEnv().reporter)));
      } catch (err) {
        return failure(describe(err));
      }
    },
  );

  server.registerTool(
    "remember_finding",
    {
      title: "Store a verified finding",
      description:
        "Store ONE verified, reproducible finding as a durable memory on Walrus. Only after the user confirms they reproduced the issue or the fix themselves. Run recall_findings on the subject first; if an active memory contradicts this one, pass its memory_id as supersedes_memory_id (storage is append-only - nothing is deleted). If an active memory already says the same thing, use confirm_finding instead.",
      // Attribution is NOT client-controlled: every finding stored through this
      // server is signed off as SABI_REPORTER, exactly as in the web app.
      inputSchema: RememberInputSchema.shape,
    },
    async (input) => write(await rememberAction(input, { reporter: getEnv().reporter, today: todayISO() })),
  );

  server.registerTool(
    "confirm_finding",
    {
      title: "Confirm an existing finding",
      description:
        "Record that the user reproduced an EXISTING active finding themselves. Use instead of remember_finding when recall already returned a finding that says the same thing. Credits the original author and moves the finding's last-verified date to today.",
      inputSchema: ConfirmInputSchema.shape,
    },
    async (input) => write(await confirmAction(input, { reporter: getEnv().reporter, today: todayISO() })),
  );

  server.registerPrompt(
    "sabi",
    {
      title: "Sabi memory rules",
      description:
        "The system prompt that governs when Sabi recalls, when it refuses to store, and how it handles stale and superseded findings. Load this before using the tools.",
    },
    () => {
      const env = getEnv();
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: buildSystemPrompt({
                today: todayISO(),
                namespace: env.namespace,
                reporter: env.reporter,
              }),
            },
          },
        ],
      };
    },
  );
}
