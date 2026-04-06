import express from "express";
import dotenv from "dotenv";
import reportRoute from "./routes/report.js";
import profileRoute from "./routes/profile.js";
import { paymentMiddlewareFromHTTPServer, x402ResourceServer } from "@x402/express";
import { x402HTTPResourceServer } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  declareSIWxExtension,
  siwxResourceServerExtension,
  createSIWxSettleHook,
  createSIWxRequestHook,
} from "@x402/extensions/sign-in-with-x";
import { TTLSIWxStorage } from "./storage.js";

dotenv.config();

// 1. Validate environment variables
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const RESOURCE_PRICE = process.env.RESOURCE_PRICE;
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const PORT = process.env.PORT || 3000;
const NETWORK = "eip155:84532" as const; // Base Sepolia

if (!WALLET_ADDRESS) {
  console.error("Missing WALLET_ADDRESS in environment variables.");
  process.exit(1);
}

if (!RESOURCE_PRICE) {
  console.error("Missing RESOURCE_PRICE in environment variables.");
  process.exit(1);
}

const app = express();
app.use(express.json());

// --- SIWX storage with 1-hour TTL ---
const storage = new TTLSIWxStorage(60 * 60 * 1000); // 1 hour

// --- x402 resource server with SIWX extension ---
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme())
  .registerExtension(siwxResourceServerExtension)
  .onAfterSettle(
    createSIWxSettleHook({
      storage,
      onEvent: (event) => console.log("[siwx]", event.type, event),
    }),
  );

// --- Route configuration ---
const routes = {
  "GET /report/market-summary": {
    accepts: [
      {
        scheme: "exact",
        price: RESOURCE_PRICE,
        network: NETWORK,
        payTo: WALLET_ADDRESS,
      },
    ],
    description: "Market Data Report",
    mimeType: "application/json",
    // SIWX: allows returning customers to sign in instead of paying again
    extensions: declareSIWxExtension({
      statement: "Sign in to access your purchased market data",
    }),
  },
  "GET /report/wallet-profile": {
    accepts: [], // Auth-only: no payment required
    description: "Wallet Profile",
    mimeType: "application/json",
    extensions: declareSIWxExtension({
      network: NETWORK, // Required for auth-only routes (can't be inferred from accepts)
      statement: "Sign in to view your wallet profile",
      expirationSeconds: 300,
    }),
  },
};

// --- HTTP resource server with SIWX request hook ---
const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  .onProtectedRequest(
    createSIWxRequestHook({
      storage,
      onEvent: (event) => console.log("[siwx]", event.type, event),
    }),
  );

// Apply x402 payment middleware
app.use(paymentMiddlewareFromHTTPServer(httpServer));

// --- Routes ---
app.get("/", (req, res) => {
  res.json({
    status: "healthy",
    message: "x402 Paid Server is up and running!",
  });
});

app.use("/report", reportRoute);
app.use("/report", profileRoute);

app.listen(PORT, () => {
  console.log(`[paid-server] running at http://localhost:${PORT}`);
});
