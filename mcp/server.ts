// Sabi as an MCP server: the same community memory, the same two tools, exposed
// to any MCP client (Claude Desktop, Cursor, ChatGPT desktop, ...).
//
//   pnpm mcp
//
// PROMPT.md already claims Sabi "would run on any MCP client given the same two
// tools over a Walrus Memory account". This is that claim, shipped.
//
// The memory rules are served as an MCP *prompt* (`sabi`) so a client can adopt
// the same gatekeeping the web app uses. Tools without those rules will happily
// store hearsay - the prompt is what makes a finding mean something.
//
// STDIO DISCIPLINE: stdout carries the MCP protocol. Nothing here may
// console.log. Diagnostics go to stderr via console.error.

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadEnv } from "../scripts/_env";

loadEnv();

// Imported AFTER loadEnv() so lib/env.ts reads a populated process.env.
const { getEnv } = await import("../lib/env");
const { buildSystemPrompt } = await import("../lib/sabi-prompt");
const {
  FindingInputSchema,
  formatFinding,
  secretInFinding,
  toFinding,
  todayISO,
} = await import("../lib/findings");
const { searchFindings, storeFinding, mode, defaultNamespace } = await import("../lib/memwal");

const env = getEnv();

const server = new McpServer({ name: "sabi", version: "0.1.0" });

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function failure(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  "remember_finding",
  {
    title: "Store a verified finding",
    description:
      "Store ONE verified, reproducible finding as a durable memory on Walrus. Only after the user confirms they reproduced the issue or the fix themselves. Run recall_findings on the subject first; if an active memory contradicts this one, pass its memory_id as supersedes_memory_id (storage is append-only - nothing is deleted).",
    // Attribution is NOT client-controlled: every finding stored through this
    // server is signed off as SABI_REPORTER, exactly as in the web app.
    inputSchema: FindingInputSchema.omit({ reported_by: true }).shape,
  },
  async (input) => {
    const today = todayISO();
    try {
      const secret = secretInFinding(input);
      if (secret) {
        return failure(
          `Refused: the finding looks like it contains a secret (${secret}). Strip it and try again.`,
        );
      }
      const finding = toFinding(input, { today, defaultReporter: env.reporter });
      const line = formatFinding(finding);
      const res = await storeFinding(line);
      return text({
        status: res.status,
        memory_id: res.memory_id,
        job_id: res.job_id,
        namespace: res.namespace,
        mode: mode(),
        // A client must never relay a mock write as durable storage.
        warning:
          mode() === "mock"
            ? "MOCK MODE: stored in-memory only - nothing reached Walrus and this id is not a Walrus blob."
            : undefined,
        text: line,
        finding,
      });
    } catch (err) {
      return failure(`store failed: ${describe(err)}`);
    }
  },
);

server.registerPrompt(
  "sabi",
  {
    title: "Sabi memory rules",
    description:
      "The system prompt that governs when Sabi recalls, when it refuses to store, and how it handles stale and superseded findings. Load this before using the tools.",
  },
  () => ({
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
  }),
);

if (env.mode === "live" && (!env.delegateKey || !env.accountId)) {
  console.error(
    "sabi mcp WARNING: live mode without MEMWAL_DELEGATE_KEY / MEMWAL_ACCOUNT_ID - every tool call will fail. Set them or MEMWAL_MODE=mock.",
  );
}
console.error(
  `sabi mcp · mode=${mode()} ns=${defaultNamespace()} reporter=${env.reporter} · stdio ready`,
);

await server.connect(new StdioServerTransport());
