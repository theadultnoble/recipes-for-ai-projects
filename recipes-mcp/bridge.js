#!/usr/bin/env node

/**
 * HTTP to stdio bridge for Streamable HTTP MCP servers
 * This allows Claude Desktop to connect to HTTP-based MCP servers via stdio transport
 */

const http = require("http");
const readline = require("readline");
const { randomUUID } = require("crypto");

const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL || "http://127.0.0.1:3000/mcp";

let sessionId = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// Handle incoming messages from Claude Desktop on stdin
rl.on("line", async (line) => {
  try {
    const message = JSON.parse(line);

    // Send the message via HTTP POST to the MCP server
    const response = await sendHttpRequest(message);

    // Write response back to stdout
    console.log(JSON.stringify(response));
  } catch (error) {
    console.error(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: `Bridge error: ${error.message}`,
        },
        id: null,
      }),
    );
  }
});

async function sendHttpRequest(message) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "localhost",
      port: 3000,
      path: "/mcp",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,text/event-stream",
      },
    };

    // Add session ID if we have one
    if (sessionId) {
      options.headers["MCP-Session-Id"] = sessionId;
    }

    const req = http.request(options, (res) => {
      let data = "";

      // Check for session ID in response
      if (res.headers["mcp-session-id"]) {
        sessionId = res.headers["mcp-session-id"];
      }

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          // Handle SSE stream responses
          if (res.headers["content-type"] === "text/event-stream") {
            // Parse SSE format
            const lines = data.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const jsonData = line.substring(6);
                if (jsonData) {
                  resolve(JSON.parse(jsonData));
                  return;
                }
              }
            }
          } else {
            // Regular JSON response
            resolve(JSON.parse(data));
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on("error", reject);
    req.write(JSON.stringify(message));
    req.end();
  });
}

// Keep process alive
process.on("SIGINT", () => {
  process.exit(0);
});
