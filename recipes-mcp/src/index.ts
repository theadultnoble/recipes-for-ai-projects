#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createSolanaRpc,
  address,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  pipe,
  setTransactionMessageFeePayer,
  createTransactionMessage,
  createKeyPairSignerFromBytes,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  KeyPairSigner,
  signTransactionMessageWithSigners,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  getSignatureFromTransaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { readFile } from "fs/promises";
import path from "path";

let solanaRpc: any;
let solanaRpcSubscription: any;

try {
  solanaRpc = createSolanaRpc(process.env.RPC_URL!);
  solanaRpcSubscription = createSolanaRpcSubscriptions(
    process.env.RPC_URL!.replace("https://", "wss://"),
  );
  console.error("RPC_URL:", process.env.RPC_URL);
} catch (err) {
  console.error(err);
}

const solanaPriceEndpoint =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=USD";
const PRICE_CACHE_DURATION = 1 * 60 * 1000;
let cachedPrice: { value: number; timestamp: number } | null = null;

const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
  rpc: solanaRpc,
  rpcSubscriptions: solanaRpcSubscription,
});

function bigIntReplacer(_key: string, value: any): any {
  return typeof value === "bigint" ? value.toString() : value;
}

function solToLamports(sol: number): number {
  return sol * 1_000_000_000;
}

function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

async function verifyKeypairFile() {
  if (!process.env.KEYPAIR_PATH) {
    console.error("Error: KEYPAIR_PATH environment variable is not set");
    process.exit(1);
  }

  const keyPairPath = path.join(process.env.KEYPAIR_PATH as string);
  try {
    await readFile(keyPairPath, "utf8");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`Error: Keypair file not found at ${keyPairPath}`);
    } else if (error.code === "EACCES") {
      console.error(
        `Error: Permission denied reading keypair file at ${keyPairPath}`,
      );
    } else {
      console.error(`Error reading keypair file: ${error.message}`);
    }
    process.exit(1);
  }
}

async function loadKeypairFromJson() {
  const keyPairPath = path.join(process.env.KEYPAIR_PATH as string);
  const keypair = JSON.parse(await readFile(keyPairPath, "utf8"));
  return keypair;
}

async function getSolanaPrice() {
  try {
    if (
      cachedPrice &&
      Date.now() - cachedPrice.timestamp < PRICE_CACHE_DURATION
    ) {
      return cachedPrice.value;
    }

    const response = await fetch(solanaPriceEndpoint);
    const data = await response.json();

    cachedPrice = {
      value: data.solana.usd,
      timestamp: Date.now(),
    };

    return cachedPrice.value;
  } catch (error) {
    throw new Error("Failed to get Solana price");
  }
}

async function getSourceAccountSigner() {
  try {
    const SOURCE_ACCOUNT_SIGNER = await createKeyPairSignerFromBytes(
      new Uint8Array(await loadKeypairFromJson()),
    );
    return SOURCE_ACCOUNT_SIGNER;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

async function getLatestBlockHash() {
  try {
    const { value: blockHash } = await solanaRpc.getLatestBlockhash().send();
    return blockHash;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

async function constructTransactionMessage(
  sourceAccountSigner: KeyPairSigner<string>,
  to: string,
  amount: number,
) {
  try {
    const blockHash = await getLatestBlockHash();
    const lamportsAmount = solToLamports(amount);
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx: any) =>
        setTransactionMessageFeePayer(sourceAccountSigner.address, tx),
      (tx: any) => setTransactionMessageLifetimeUsingBlockhash(blockHash, tx),
      (tx: any) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            amount: lamportsAmount,
            source: sourceAccountSigner,
            destination: address(to),
          }),
          tx,
        ),
    );
    return transactionMessage;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

async function signTransactionMessage(transactionMessage: any) {
  try {
    const signedTransaction =
      await signTransactionMessageWithSigners(transactionMessage);
    return signedTransaction;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

async function sendTransaction(signedTransaction: any) {
  try {
    const transactionSignature = await sendAndConfirmTransaction(
      signedTransaction,
      { commitment: "confirmed" },
    );
    return transactionSignature;
  } catch (e: any) {
    if (
      isSolanaError(
        e,
        SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
      )
    ) {
      const preflightErrorContext = e.context;
      console.log(preflightErrorContext);
    } else {
      throw e?.message;
    }
  }
}

async function transferTool(args: { to: string; amount: number }) {
  try {
    const sourceAccountSigner = await getSourceAccountSigner();
    const transactionMessage = await constructTransactionMessage(
      sourceAccountSigner,
      args.to,
      args.amount,
    );
    const signedTransaction = await signTransactionMessage(transactionMessage);
    const signature = getSignatureFromTransaction(signedTransaction);
    await sendTransaction(signedTransaction);
    const transaction = await solanaRpc
      .getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })
      .send();
    return transaction;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

async function getSlotTool() {
  try {
    const slot = await solanaRpc.getSlot().send();
    return slot;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

async function getAddressBalanceTool(add: string) {
  try {
    const balance = await solanaRpc.getBalance(address(add)).send();
    return balance.value;
  } catch (error: any) {
    throw new Error(error?.message);
  }
}

// Create a function to instantiate a new server for each session
const getServer = () => {
  const server = new McpServer({
    name: "Solana MCP",
    version: "1.0.0",
  });

  server.registerTool(
    "get-latest-slot",
    {
      description: "Get the latest slot number",
    },
    async () => {
      try {
        return {
          content: [
            {
              type: "text" as const,
              text: String(await getSlotTool()),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: error?.message }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-wallet-address",
    {
      description: "Get the wallet address",
    },
    async () => {
      try {
        let address = (await getSourceAccountSigner()).address as string;
        return {
          content: [
            {
              type: "text" as const,
              text: address,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `${error?.message}}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-wallet-balance",
    {
      description: "Get the wallet balance in SOL, Lamports, and USD",
    },
    async () => {
      try {
        let address = (await getSourceAccountSigner()).address as string;
        const lamportsBalance = await getAddressBalanceTool(address);
        const solBalance = lamportsToSol(Number(lamportsBalance));
        const price = await getSolanaPrice();
        const usdBalance = (solBalance * price).toFixed(4);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  lamportsBalance: lamportsBalance,
                  solanaBalnce: solBalance,
                  usdBalance: usdBalance,
                },
                bigIntReplacer,
                2,
              ),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: error?.message }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "transfer",
    {
      description: "Transfer SOL to a recipient address",
      inputSchema: {
        to: z.string(),
        amount: z.number(),
      } as any,
    },
    async (args: any) => {
      try {
        const transaction = await transferTool(args);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(transaction, bigIntReplacer, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: error?.message }],
          isError: true,
        };
      }
    },
  );

  return server;
};

// Create Express app for HTTP transport
const app = createMcpExpressApp();

// Map to store active transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Validate Origin header to prevent DNS rebinding attacks
const validateOrigin = (req: Request): boolean => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }
  return true;
};

// MCP HTTP endpoint handler
app.post("/mcp", async (req: Request, res: Response) => {
  console.log("Received MCP POST request");

  try {
    // Security: Validate Origin header
    if (!validateOrigin(req)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Forbidden: Invalid Origin",
        },
        id: null,
      });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const isInitRequest = req.body.method === "initialize";

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport for this session
      transport = transports[sessionId];
    } else if (isInitRequest && !sessionId) {
      // New initialization request (no session ID yet) - create new transport
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          console.log(`Session initialized with ID: ${newSessionId}`);
          transports[newSessionId] = transport;
          // Set session ID header in response
          res.setHeader("MCP-Session-Id", newSessionId);
        },
      });

      // Connect transport to a new server instance
      const server = getServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // No session ID provided on non-init request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Internal server error",
      },
      id: null,
    });
  }
});

// Optional GET endpoint for SSE streams
app.get("/mcp", async (req: Request, res: Response) => {
  console.log("Received MCP GET request (SSE stream)");

  try {
    // Security: Validate Origin header
    if (!validateOrigin(req)) {
      res.status(403).send();
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !transports[sessionId]) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Session not found",
        },
        id: null,
      });
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling MCP GET request:", error);
    res.status(500).send();
  }
});

async function main() {
  try {
    await verifyKeypairFile();

    const port = parseInt(process.env.PORT || "3000", 10);
    const host = "127.0.0.1";

    app.listen(port, host, () => {
      console.log(`Solana MCP Server listening on http://${host}:${port}/mcp`);
      console.error(
        `Solana MCP Server listening on http://${host}:${port}/mcp`,
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch(console.error);
