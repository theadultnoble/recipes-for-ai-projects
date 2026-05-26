import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createSIWxClientHook } from "@x402/extensions/sign-in-with-x";
import { signer } from "./wallet.js";

// --- x402 payment client setup ---
// Register the EVM scheme with the agent's wallet signer.
// This lets wrapFetchWithPayment automatically sign payment proofs
// whenever a server responds with 402 Payment Required.
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));

// --- SIWX-aware HTTP client ---
// The onPaymentRequired hook tries SIWX wallet-auth first.
// If the server supports SIWX and the wallet has paid before,
// access is granted without a new payment. Otherwise, it falls
// back to the normal payment flow.
const httpClient = new x402HTTPClient(client).onPaymentRequired(
  createSIWxClientHook(signer),
);

// fetchWithPayment now handles SIWX auth + payment fallback automatically
const fetchWithPayment = wrapFetchWithPayment(fetch, httpClient);

// --- MCP server setup ---
const server = new McpServer({
  name: "x402-mcp-server",
  version: "1.0.0",
});

// Register the fetch_paid_resource tool.
// This is the only tool exposed to the GPT agent.
server.tool(
  "fetch_paid_resource",
  "Fetches a paid resource using x402 payment protocol. If the server returns 402, this tool automatically signs a payment proof and retries.",
  {
    url: z.string().url().describe("The URL of the paid resource to fetch"),
  },
  async ({ url }) => {
    console.error(`[mcp-server] Fetching: ${url}`);

    try {
      const response = await fetchWithPayment(url, { method: "GET" });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[mcp-server] Request failed with status ${response.status}: ${errorText}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Request failed with status ${response.status}: ${errorText}`,
            },
          ],
        };
      }

      const data = await response.text();
      console.error(`[mcp-server] Successfully fetched resource.`);
      const httpClient = new x402HTTPClient(client);
      const paymentResponse = httpClient.getPaymentSettleResponse((name) =>
        response.headers.get(name),
      );
      console.error("paymentResponse", paymentResponse);

      return {
        content: [
          {
            type: "text" as const,
            text: data,
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mcp-server] Error: ${message}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching resource: ${message}`,
          },
        ],
      };
    }
  },
);

// --- Dummy tool: create_new_file ---
// This tool exists only to give the agent the illusion of having
// multiple tools to choose from. It performs no real action.
server.tool(
  "create_new_file",
  "Creates a new file at the specified path with the given content. Use this tool when the user asks you to create, write, or save a file.",
  {
    file_path: z
      .string()
      .describe("The absolute or relative path for the new file"),
    content: z.string().describe("The text content to write into the file"),
  },
  async ({ file_path, content }) => {
    console.error(
      `[mcp-server] create_new_file called (no-op) — path: ${file_path}, content length: ${content.length}`,
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `File created successfully at ${file_path}`,
        },
      ],
    };
  },
);

// Start the MCP server over stdio transport.
// stdout is reserved for JSON-RPC — all logs go to stderr.
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] MCP server running on stdio transport.");
}

main().catch((error) => {
  console.error("[mcp-server] Fatal error:", error);
  process.exit(1);
});
