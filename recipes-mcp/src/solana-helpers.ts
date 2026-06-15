/**
 * Solana Helper Functions for Transfer and Wallet Balance Tools
 *
 * This module contains core helper functions that power the Solana MCP server's
 * transfer and wallet balance functionality. These functions handle keypair management,
 * transaction construction, signing, and RPC interactions.
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  setTransactionMessageFeePayer,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  getSignatureFromTransaction,
  pipe,
  address,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type { KeyPairSigner, Blockhash, Signature } from "@solana/kit";

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

// ---------------------------------------------------------------------------
// Convenience type aliases derived from factory return types so we avoid
// constructing deeply-nested generic RPC types manually.
// ---------------------------------------------------------------------------
type SendAndConfirmTransaction = ReturnType<
  typeof sendAndConfirmTransactionFactory
>;

// The exact return type of signTransactionMessageWithSigners (non-generic call)

type SignedTransaction = Awaited<
  ReturnType<typeof signTransactionMessageWithSigners>
>;
/**
 * ============================================================================
 * KEYPAIR AND ACCOUNT MANAGEMENT
 * ============================================================================
 */

/**
 * Verifies that the keypair file exists at the path specified in KEYPAIR_PATH
 * environment variable. Exits the process with error code 1 if the file is not
 * found, not readable, or if KEYPAIR_PATH is not set.
 *
 * @throws Exits process if keypair file validation fails
 */
export async function verifyKeypairFile(): Promise<void> {
  if (!process.env.KEYPAIR_PATH) {
    console.error("Error: KEYPAIR_PATH environment variable is not set");
    process.exit(1);
  }

  const keyPairPath = path.join(process.env.KEYPAIR_PATH);
  try {
    await readFile(keyPairPath, "utf8");
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error(`Error: Keypair file not found at ${keyPairPath}`);
    } else if (err.code === "EACCES") {
      console.error(
        `Error: Permission denied reading keypair file at ${keyPairPath}`,
      );
    } else {
      console.error(`Error reading keypair file: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Reads and parses the keypair JSON file from the path specified in KEYPAIR_PATH
 * environment variable. Returns the raw keypair array (Uint8Array values
 * serialized as JSON — typically a 64-byte Ed25519 secret key).
 *
 * @returns The parsed keypair number array from the JSON file
 * @throws {Error} If the file cannot be read or parsed
 */
export async function loadKeypairFromJson(): Promise<number[]> {
  const keyPairPath = path.join(process.env.KEYPAIR_PATH as string);
  const keypair: number[] = JSON.parse(await readFile(keyPairPath, "utf8"));
  return keypair;
}

/**
 * Creates a KeyPairSigner instance from the keypair stored in the JSON file.
 * This signer is used to sign transactions and derive the wallet address.
 *
 * The keypair JSON file should contain a serialized Uint8Array (typically 64 bytes
 * for an Ed25519 keypair). This function:
 * 1. Loads the keypair from JSON
 * 2. Converts it to a Uint8Array
 * 3. Creates a KeyPairSigner from those bytes
 *
 * @returns A signer object with address and signing capabilities
 * @throws {Error} If keypair loading or signer creation fails
 */
export async function getSourceAccountSigner(): Promise<KeyPairSigner> {
  try {
    const SOURCE_ACCOUNT_SIGNER = await createKeyPairSignerFromBytes(
      new Uint8Array(await loadKeypairFromJson()),
    );
    return SOURCE_ACCOUNT_SIGNER;
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * ============================================================================
 * RPC INTERACTIONS
 * ============================================================================
 */

/**
 * Fetches the latest blockhash from the Solana network via RPC.
 * The blockhash is required when constructing transactions to ensure they
 * have a limited lifetime and cannot be replayed indefinitely.
 *
 * @returns The latest blockhash value object (includes blockhash + lastValidBlockHeight)
 * @throws {Error} If the RPC call fails
 *
 * @remarks
 * This function depends on the module-level `solanaRpc` instance.
 */
export async function getLatestBlockHash(): Promise<{
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
}> {
  // Note: solanaRpc is a module-level dependency (requires initialization in calling scope)
  try {
    const { value: blockHash } = await (global as any).solanaRpc
      .getLatestBlockhash()
      .send();
    return blockHash;
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * Fetches the SOL balance (in lamports) for a given wallet address from the network.
 *
 * // Note: 1 SOL = 1,000,000,000 lamports — convert with: lamports / 1_000_000_000
 *
 * @param add - The wallet address to query (base58 encoded)
 * @returns The balance in lamports as a bigint
 * @throws {Error} If the RPC call fails
 *
 * @remarks
 * This function depends on the module-level `solanaRpc` instance.
 */
export async function getAddressBalanceTool(add: string): Promise<bigint> {
  // Note: solanaRpc is a module-level dependency (requires initialization in calling scope)
  try {
    const balance = await (global as any).solanaRpc
      .getBalance(address(add))
      .send();
    return balance.value;
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * ============================================================================
 * TRANSACTION CONSTRUCTION
 * ============================================================================
 */

/**
 * Constructs a complete Solana transaction message for transferring SOL.
 *
 * This function:
 * 1. Fetches the latest blockhash (sets the transaction's expiry window)
 * 2. Converts the SOL amount to lamports (1 SOL = 1_000_000_000 lamports)
 * 3. Creates a version 0 transaction message
 * 4. Sets the fee payer to the source account
 * 5. Sets the transaction lifetime using the blockhash
 * 6. Appends the System Program transfer instruction (moves lamports from source to destination)
 *
 * The returned message is NOT yet signed — pass it to signTransactionMessage next.
 *
 * @param sourceAccountSigner - The source wallet signer (pays fees and sends SOL)
 * @param to - The recipient wallet address (base58 encoded)
 * @param amount - The amount to transfer in SOL
 * @returns An unsigned transaction message ready to be signed
 * @throws {Error} If transaction construction fails
 *
 * @remarks
 * This function depends on the module-level `solanaRpc` instance.
 */
export async function constructTransactionMessage(
  sourceAccountSigner: KeyPairSigner,
  to: string,
  amount: number,
): Promise<unknown> {
  try {
    const blockHash = await getLatestBlockHash();

    // Convert SOL to lamports (1 SOL = 1_000_000_000 lamports)
    const lamportsAmount = amount * 1_000_000_000;

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(sourceAccountSigner.address, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(blockHash, tx),
      (tx) =>
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
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * ============================================================================
 * TRANSACTION SIGNING AND SUBMISSION
 * ============================================================================
 */

/**
 * Signs a transaction message using the signers embedded in the transaction.
 * The transaction message must have already been constructed and include the
 * signer account (via setTransactionMessageFeePayer + KeyPairSigner in the instruction).
 *
 * Returns a fully signed transaction ready to be broadcast to the network.
 *
 * @param transactionMessage - An unsigned transaction message (output of constructTransactionMessage)
 * @returns A signed transaction object (SendableTransaction & Transaction & TransactionWithLifetime)
 * @throws {Error} If signing fails
 */
export async function signTransactionMessage(
  transactionMessage: unknown,
): Promise<SignedTransaction> {
  try {
    // The pipe-built message satisfies the required shape at runtime even though
    // TypeScript cannot verify the full generic constraint chain statically.
    const signedTransaction = await signTransactionMessageWithSigners(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transactionMessage as any,
    );
    return signedTransaction;
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * Sends a signed transaction to the Solana network and waits for confirmation.
 *
 * This function:
 * 1. Broadcasts the transaction to the network via RPC
 * 2. Monitors it until it reaches "confirmed" commitment level
 * 3. Throws on preflight failures (e.g. insufficient balance, invalid instructions)
 *
 * @param sendAndConfirmTransaction - The confirmation helper from sendAndConfirmTransactionFactory
 * @param signedTransaction - A signed transaction ready to broadcast
 * @throws {Error} If the transaction fails preflight checks or network confirmation
 */
export async function sendTransaction(
  sendAndConfirmTransaction: SendAndConfirmTransaction,
  signedTransaction: SignedTransaction,
): Promise<void> {
  try {
    await sendAndConfirmTransaction(
      // Cast required: the pipe-built message doesn't carry all compile-time
      // generic constraints that sendAndConfirmTransaction expects,
      // even though the runtime shape is correct.
      signedTransaction as Parameters<SendAndConfirmTransaction>[0],
      { commitment: "confirmed" },
    );
  } catch (e: unknown) {
    if (
      isSolanaError(
        e,
        SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
      )
    ) {
      const preflightErrorContext = e.context;
      console.error("Preflight validation failed:", preflightErrorContext);
      throw new Error(
        `Preflight failure: ${JSON.stringify(preflightErrorContext)}`,
      );
    } else {
      throw new Error((e as Error)?.message);
    }
  }
}

/**
 * ============================================================================
 * HIGH-LEVEL TRANSFER ORCHESTRATION
 * ============================================================================
 */

/**
 * Orchestrates a complete SOL transfer by combining the lower-level helper functions.
 *
 * This function:
 * 1. Loads the source account signer from the keypair file
 * 2. Constructs a transaction message for the transfer
 * 3. Signs the transaction with the source account's signer
 * 4. Extracts the transaction signature
 * 5. Broadcasts and confirms the transaction on-chain
 * 6. Fetches and returns the confirmed transaction details
 *
 * @param args - Object containing:
 *   - to: Recipient wallet address (base58 encoded)
 *   - amount: Amount to transfer in SOL (converted to lamports internally)
 * @returns The full confirmed transaction object from the network
 * @throws {Error} If any step fails (keypair loading, construction, signing, or broadcast)
 *
 * @remarks
 * This function depends on the module-level `solanaRpc` and `sendAndConfirmTransaction` instances.
 */
export async function transferTool(args: {
  to: string;
  amount: number;
}): Promise<any> {
  try {
    const sourceAccountSigner = await getSourceAccountSigner();
    const transactionMessage = await constructTransactionMessage(
      sourceAccountSigner,
      args.to,
      args.amount,
    );
    const signedTransaction = await signTransactionMessage(transactionMessage);
    const signature = getTransactionSignature(signedTransaction);
    await sendTransaction(
      (global as any).sendAndConfirmTransaction,
      signedTransaction,
    );
    const transaction = await (global as any).solanaRpc
      .getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })
      .send();
    return transaction;
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * ============================================================================
 * SOLANA SLOT QUERY
 * ============================================================================
 */

/**
 * Fetches the current slot (block height) on the Solana blockchain.
 *
 * A slot is a unit of time on Solana, approximately 400ms in duration.
 * The slot number indicates how many slots have elapsed since the genesis block.
 *
 * @returns The current slot number as a bigint
 * @throws {Error} If the RPC call fails
 *
 * @remarks
 * This function depends on the module-level `solanaRpc` instance.
 */
export async function getSlotTool(): Promise<bigint> {
  // Note: solanaRpc is a module-level dependency (requires initialization in calling scope)
  try {
    const slot = await (global as any).solanaRpc.getSlot().send();
    return slot;
  } catch (error: unknown) {
    throw new Error((error as Error)?.message);
  }
}

/**
 * ============================================================================
 * PRICE UTILITY
 * ============================================================================
 */

/** Shape of the in-memory price cache used by getSolanaPrice */
export interface PriceCache {
  value: number;
  timestamp: number;
}

/**
 * Fetches the current SOL/USD price from the CoinGecko API, with optional
 * in-memory caching to prevent excessive API calls on repeated balance checks.
 *
 * Cache behaviour:
 * - If a valid cachedPrice is provided and it is younger than PRICE_CACHE_DURATION,
 *   the cached value is returned without a network request.
 * - Otherwise, a fresh price is fetched from CoinGecko.
 *
 * // Note: The caller is responsible for persisting the updated PriceCache object.
 * //       Typical cache duration: 1 * 60 * 1000 (1 minute)
 *
 * @param cachedPrice - Existing cache object, or null if no cache exists yet
 * @param PRICE_CACHE_DURATION - How long the cache is valid, in milliseconds
 * @returns The current SOL price in USD
 * @throws {Error} If the API call fails
 */
export async function getSolanaPrice(
  cachedPrice: PriceCache | null,
  PRICE_CACHE_DURATION: number,
): Promise<number> {
  const solanaPriceEndpoint =
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=USD";

  if (
    cachedPrice &&
    Date.now() - cachedPrice.timestamp < PRICE_CACHE_DURATION
  ) {
    return cachedPrice.value;
  }

  try {
    const response = await fetch(solanaPriceEndpoint);
    const data = (await response.json()) as { solana: { usd: number } };
    return data.solana.usd;
  } catch (_error: unknown) {
    throw new Error("Failed to get Solana price from CoinGecko API");
  }
}

/**
 * ============================================================================
 * TRANSACTION UTILITY
 * ============================================================================
 */

/**
 * Extracts the transaction signature from a signed transaction.
 *
 * The signature uniquely identifies the transaction on-chain and is used to:
 * - Track the transaction on a block explorer (e.g. solscan.io/tx/<signature>)
 * - Fetch full transaction details after broadcast via rpc.getTransaction()
 *
 * @param signedTransaction - A signed transaction object (output of signTransactionMessage)
 * @returns The transaction signature (base58 encoded string)
 */
export function getTransactionSignature(
  signedTransaction: SignedTransaction,
): Signature {
  return getSignatureFromTransaction(signedTransaction);
}
