// Sabi as a REMOTE MCP server, for clients that cannot spawn a local process:
// claude.ai custom connectors and ChatGPT web point at
//   https://<deployment>/api/mcp
//
// Stateless streamable HTTP: each request builds a fresh McpServer over the
// same registration the stdio server uses (mcp/tools.ts), so the web
// connector and the desktop client are provably the same surface.
//
// Trust model: this endpoint is as public as the chat UI - both drive the
// instance's delegate key. Writes are attributed to SABI_REPORTER (there is
// no session here), and the same secretInFinding gate runs server-side.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerSabi } from "@/mcp/tools";

export const maxDuration = 120;

async function handle(req: Request): Promise<Response> {
  const server = new McpServer({ name: "sabi", version: "0.1.0" });
  registerSabi(server);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session ids, every request self-contained. Required on
    // serverless, where consecutive requests hit different instances.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Fire-and-forget: the response is already materialized (JSON mode).
    void transport.close().catch(() => {});
  }
}

export async function POST(req: Request) {
  return handle(req);
}

// GET opens an SSE stream in the spec; stateless JSON mode declines it.
export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
