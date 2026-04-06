import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config();

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;

if (!AGENT_PRIVATE_KEY) {
    throw new Error("Missing AGENT_PRIVATE_KEY in environment variables.");
}

// Create an EVM signer from the agent's private key.
// This signer is used by the x402 client to authorize USDC payments on Base Sepolia.
export const signer = privateKeyToAccount(AGENT_PRIVATE_KEY as `0x${string}`);
