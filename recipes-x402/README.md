# recipes-x402

> Chapter 6 of _Recipes for AI_ — HTTP Payments for AI Agents

---

## What This Is

This project is the hands-on companion to the x402 chapter of the _Recipes for AI_ cookbook. It demonstrates how an AI agent can autonomously pay for access to a paywalled resource using the x402 payment protocol — no human approval, no pre-loaded billing credentials, no API key subscriptions.

The agent receives a natural language prompt from the user, reasons about what it needs, calls a payment-enabled tool, and returns a response. The entire payment handshake happens behind the scenes.

**Payment network:** Base Sepolia testnet (USDC). No real funds required.

---

## The Core Idea

Most of the internet's payment infrastructure was designed for humans. A human clicks a button, authenticates with a bank, and approves a transaction. An AI agent cannot do any of that.

x402 solves this by reviving HTTP's long-dormant `402 Payment Required` status code and turning it into a real protocol. A server declares that a resource costs a certain amount. The agent pays using a cryptographic payment proof signed on-chain. The server verifies the proof and serves the content. No human in the loop.

This project demonstrates that entire flow end-to-end.

---

## How the Payment Flow Works

```
User runs CLI prompt
        ↓
GPT reasons → decides to call fetch_paid_resource tool
        ↓
MCP server receives tool call
        ↓
MCP server fetches the paid endpoint → gets 402 + payment details
        ↓
MCP server signs payment proof (Base Sepolia USDC via viem)
        ↓
MCP server retries request with proof in header
        ↓
Paid server verifies proof → returns content
        ↓
MCP server returns content to GPT
        ↓
GPT summarizes and responds to user
```

---

## Project Structure

```
recipes-x402/
├── packages/
│   ├── paid-server/
│   │   ├── src/
│   │   │   ├── index.ts         ← Express server entry
│   │   │   └── routes/
│   │   │       └── report.ts    ← protected /report/market-summary route
│   │   ├── .env
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mcp-agent/
│       ├── src/
│       │   ├── agent.ts         ← GPT reasoning loop + CLI entry
│       │   ├── mcp-server.ts    ← MCP server exposing fetch_paid_resource
│       │   └── wallet.ts        ← Base Sepolia wallet/signing utility
│       ├── .env
│       ├── package.json
│       └── tsconfig.json
│
├── package.json                 ← monorepo root (workspaces)
└── README.md
```

### `paid-server` —

This is the paywalled Express server that acts as the resource the agent pays to access.
It exposes one protected route:

```
GET /report/market-summary
```

Without payment, this route returns `402 Payment Required`. With a valid x402 payment proof, it returns a mocked market data report in JSON.

**Environment variables:**

```env
WALLET_ADDRESS=        # Server wallet address (receives payments)
PORT=3000
RESOURCE_PRICE=0.001   # Price in USDC per request
```

**Dependencies:**

- `express` — HTTP server
- `@x402/express` — x402 payment middleware for Express
- `@x402/core` — core x402 resource server and facilitator logic
- `@x402/evm` — EVM payment scheme
- `dotenv`

---

### `mcp-agent` —

It contains three files.

#### `src/wallet.ts`

Loads a private key from the environment, creates a `viem` wallet client configured for Base Sepolia, and exports it for use in the MCP server. This is the signing utility — it is what allows the agent to authorize USDC payments on-chain.

#### `src/mcp-server.ts`

The MCP server. This is the heart of the guide.

It exposes one tool to any connected MCP client:

```
fetch_paid_resource(url: string) → string
```

Internally, when this tool is called, it:

1. Wraps the native `fetch` with `@x402/fetch` payment handling
2. Attempts to fetch the given URL
3. If a `402` is returned, signs a payment proof using the wallet and retries automatically
4. Returns the resource content to the caller

The agent (GPT) never sees any of this. It calls the tool, and content comes back.

The MCP server runs over **stdio transport** (`StdioServerTransport`). This means it is spawned as a child process by the agent — run one command and both processes start together.

#### `src/agent.ts`

The GPT reasoning loop and CLI entry point.

It does four things:

1. Reads the user's prompt from the CLI arguments
2. Spawns and connects to the MCP server via `StdioClientTransport`
3. Discovers the available tools from the MCP server
4. Runs a tool-calling loop with GPT until a final text response is produced

The tool-calling loop is written explicitly — no agent framework abstracts it.

**Environment variables:**

```env
OPENAI_API_KEY=
AGENT_PRIVATE_KEY=     # Agent wallet private key (makes payments)
PAID_SERVER_URL=http://localhost:3000
FACILITATOR_URL=https://facilitator.x402.com
```

**Dependencies:**

- `@modelcontextprotocol/sdk` — MCP server and client
- `@x402/fetch` — x402-aware fetch
- `@x402/evm` — EVM payment scheme (Base Sepolia)
- `viem` — wallet signing
- `openai` — GPT reasoning layer
- `zod` — tool input schema validation
- `dotenv`
- `tsx` (dev) — TypeScript execution

---

## Running the Demo

Once both packages are set up, the full demo runs with a single command from the `mcp-agent` directory:

```bash
npm run agent -- "give me a market summary for the Base ecosystem"
```

Expected terminal output:

```
> Thinking...
> Calling tool: fetch_paid_resource
> Payment required: 0.001 USDC
> Signing payment proof...
> Payment accepted. Fetching content...

The Base ecosystem is currently showing bullish sentiment,
with 24-hour volume of $4.2B and an 18% week-over-week
increase in on-chain activity...
```

---

## Architecture Decisions and Why

### Why MCP?

The MCP layer separates the agent's reasoning from the payment infrastructure. GPT does not need to know anything about x402, wallets, or signing. It calls a tool. The MCP server handles everything else. This pattern is reusable — the same MCP server can be connected to any compatible agent, regardless of which LLM powers it.

### Why stdio transport?

The MCP SDK's stdio transport is the most stable option for local, process-spawned integrations. It also means the reader runs one command and both the agent and MCP server start together — no separate terminal windows, which is better for screen recording and simpler to follow in a written guide.

### Why no agent framework (LangChain, etc.)?

Frameworks abstract the tool-calling loop. For a cookbook teaching agent fundamentals, that abstraction removes the exact thing readers need to see. Writing the loop explicitly means readers understand what "agentic" actually means — GPT reasoning across multiple turns, requesting tools, receiving results, and deciding when it has enough information to respond.

### Why GPT as the reasoning model?

The architecture is model-agnostic. Swapping the reasoning model requires only changing the OpenAI client to any other provider that supports tool calling.

### Why Base Sepolia testnet?

Testnet USDC means readers can follow the entire guide without spending real money. The x402 flow is identical to mainnet — only the chain configuration changes.

---

## Key Packages Reference

| Package                     | Role                                              |
| --------------------------- | ------------------------------------------------- |
| `@x402/express`             | Payment middleware for the paid server            |
| `@x402/core`                | Core x402 logic                                   |
| `@x402/fetch`               | x402-aware fetch for the MCP server               |
| `@x402/evm`                 | EVM payment scheme (handles Base Sepolia signing) |
| `viem`                      | Wallet client and chain configuration             |
| `@modelcontextprotocol/sdk` | MCP server and client                             |
| `openai`                    | GPT reasoning and tool-calling loop               |
| `zod`                       | Tool input schema validation                      |

---

## Testnet Setup

Before running the project, the agent wallet needs testnet funds on Base Sepolia.

1. Generate a wallet or use an existing test wallet. Add the private key to `mcp-agent/.env` as `AGENT_PRIVATE_KEY`.
2. Get Base Sepolia ETH from the [Base Sepolia Faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet).
3. Get testnet USDC from the [Circle USDC Faucet](https://faucet.circle.com/) — select Base Sepolia.
4. Add the server wallet address to `paid-server/.env` as `WALLET_ADDRESS`. This wallet receives payments.

The agent wallet and server wallet should be different addresses.

---
