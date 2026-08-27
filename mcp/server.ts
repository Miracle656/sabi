// Sabi over stdio: for MCP clients that spawn local processes (Claude Desktop,
// Claude Code, Cursor).
//
//   pnpm mcp
//
// The tools and prompt live in mcp/tools.ts, shared byte-for-byte with the
// remote HTTP endpoint at app/api/mcp/route.ts.
//
// STDIO DISCIPLINE: stdout carries the MCP protocol. Nothing here may
// console.log. Diagnostics go to stderr via console.error.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadEnv } from "../scripts/_env";

loadEnv();

// Imported AFTER loadEnv() so lib/env.ts reads a populated process.env.
const { registerSabi } = await import("./tools");
const { getEnv } = await import("../lib/env");
const { mode, defaultNamespace } = await import("../lib/memwal");

const env = getEnv();
const server = new McpServer({ name: "sabi", version: "0.1.0" });
registerSabi(server);

if (env.mode === "live" && (!env.delegateKey || !env.accountId)) {
  console.error(
    "sabi mcp WARNING: live mode without MEMWAL_DELEGATE_KEY / MEMWAL_ACCOUNT_ID - every tool call will fail. Set them or MEMWAL_MODE=mock.",
  );
}
console.error(
  `sabi mcp · mode=${mode()} ns=${defaultNamespace()} reporter=${env.reporter} · stdio ready`,
);

await server.connect(new StdioServerTransport());
