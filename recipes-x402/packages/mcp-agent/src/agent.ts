import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const PAID_SERVER_URL = process.env.PAID_SERVER_URL;
const PAID_SERVER_PROFILE_URL = process.env.PAID_SERVER_PROFILE_URL;

if (!PAID_SERVER_URL) {
  console.error("Missing PAID_SERVER_URL in environment variables.");
  process.exit(1);
}

if (!PAID_SERVER_PROFILE_URL) {
  console.error("Missing PAID_SERVER_PROFILE_URL in environment variables.");
  process.exit(1);
}

// --- 1. Read the user's prompt from CLI arguments ---
const userPrompt = process.argv.slice(2).join(" ");

if (!userPrompt) {
  console.error('Usage: npm run start:agent -- "your prompt here"');
  process.exit(1);
}

// --- 2. Spawn and connect to the MCP server via stdio ---
async function main() {
  console.log("> Connecting to MCP server...");

  const transport = new StdioClientTransport({
    command: "tsx",
    args: ["src/mcp-server.ts"],
  });

  const mcpClient = new Client({
    name: "x402-agent",
    version: "1.0.0",
  });

  await mcpClient.connect(transport);

  // --- 3. Discover available tools from the MCP server ---
  const { tools: mcpTools } = await mcpClient.listTools();
  console.log(
    `> Discovered ${mcpTools.length} tool(s): ${mcpTools.map((t) => t.name).join(", ")}`,
  );

  // Convert MCP tools into OpenAI function-calling format
  const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
    mcpTools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));

  // --- 4. Run the GPT tool-calling loop ---
  const openai = new OpenAI(); // uses OPENAI_API_KEY from env

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a helpful assistant that can fetch paid resources and create files.

Available tools:
1. fetch_paid_resource — fetches a paid API endpoint using x402 payment protocol. Also supports SIWX (Sign-In-With-X) wallet authentication for repeat access.
2. create_new_file — creates a new file at a given path with specified content.

Available endpoints:
- ${PAID_SERVER_URL} — returns a market data report (requires x402 payment on first access; subsequent requests within 1 hour are authenticated via wallet signature)
- ${PAID_SERVER_PROFILE_URL} — returns wallet profile data (auth-only, requires wallet signature but NO payment)

IMPORTANT RULES:
- Only use the endpoints listed above. Do not guess or fabricate URLs.
- Choose the correct tool for the task. Use fetch_paid_resource for retrieving paid or auth-protected data. Use create_new_file for file creation tasks.
- When the user asks about their wallet, portfolio, or profile, use the wallet-profile endpoint.
- When the user asks about market data, summaries, or prices, use the market-summary endpoint.
- CRITICAL — Relevance Guardrail: After fetching a paid resource, you MUST critically evaluate whether the returned data actually answers the user's specific question. The paid endpoint may return generic or pre-canned data that does not match what the user asked for. If the data is NOT relevant to the user's query (e.g., the user asked about the Ethereum ecosystem but the response only covers the Base ecosystem), you MUST:
  1. Acknowledge that you paid for and retrieved the resource.
  2. Clearly state that the retrieved data does not contain the specific information the user requested.
  3. Summarize what the data DOES contain so the user can decide if it's still useful.
  4. Do NOT present irrelevant data as if it answers the user's question.`,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];

  console.log("> Thinking...");

  // Explicit agentic loop: keep calling GPT until it produces a final text response
  // with no further tool calls. This is intentionally written without any framework
  // so every step of the reasoning process is visible.
  while (true) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: openaiTools,
    });

    const choice = completion.choices[0];

    if (!choice || !choice.message) {
      console.error("No response from GPT.");
      break;
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    // If GPT is not requesting any tool calls, it has a final answer
    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      console.log("\n" + (assistantMessage.content ?? ""));
      break;
    }

    // Process each tool call GPT requested
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      console.log(`> Calling tool: ${toolName}`);

      // Forward the tool call to the MCP server
      const result = await mcpClient.callTool({
        name: toolName,
        arguments: toolArgs,
      });

      // Extract the text content from the MCP response
      const resultText = (
        result.content as Array<{ type: string; text: string }>
      )
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      // Feed the tool result back into the conversation for GPT's next turn
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultText,
      });
    }

    console.log("> Thinking...");
  }

  // Clean up
  await mcpClient.close();
}

main().catch((error) => {
  console.error("Agent error:", error);
  process.exit(1);
});
