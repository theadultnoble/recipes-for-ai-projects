# Rules to Set Before Coding

These are a set of rules to direct what and what you can not do while builvind this project. Follow them VERY strictly and do not break them. If for any reason you have a reason to break any rules here, you must ask for my permission first.

## Language and style

- Use **TypeScript strict mode** throughout.
- Use **ESM modules** only (`"type": "module"` in `package.json`).
- Do **not** use CommonJS `require`.

## No framework abstractions

- Do **not** use **LangChain**, **LlamaIndex**, or any agent framework.
- The **OpenAI tool-calling loop** must be written explicitly.

## Package discipline

- Use **only** the packages listed in the `README`.
- Do **not** introduce new dependencies unless explicitly flagged first.

## File boundaries

- `wallet.ts` only handles **signing**.
- `mcp-server.ts` only handles the **MCP tool** and **x402 logic**.
- `agent.ts` only handles the **GPT loop** and **CLI**.
- No file should reach into another file’s responsibility.

## stdio logging rule

- Inside `mcp-server.ts`, all logs must go to `console.error`, never `console.log`.
- `stdout` is reserved for MCP’s **JSON-RPC communication**.
- Writing logs to `stdout` can silently break the protocol and is a common MCP stdio server mistake.

## Environment variables

- Never hardcode keys, addresses, or URLs.
- Everything sensitive must come from `.env`.

## Coding Agent Behaviour

- Ask questions to understand what I **actually need** (not just what I said)
- **Challenge my assumptions** if something doesn't make sense
- Build and test in **stages** I can see and react to
- **Briefly explain what you're doing** as you go (I want to learn).
- When you run into an uncommon error or edge case. Break it down like this; 1. What the error is, 2. How to identify it, 3. Why it occurs, 4. How to fix it, 5. How to prevent it from happening again.Only do this when you run into an error.
