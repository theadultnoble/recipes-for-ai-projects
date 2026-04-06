import type { SIWxStorage } from "@x402/extensions/sign-in-with-x";

/**
 * In-memory SIWX storage with TTL support.
 *
 * Records payments with a timestamp and only considers them valid
 * if they are within the configured TTL window (default: 1 hour).
 * This lets wallets re-access paid resources without re-paying
 * for the duration of the TTL.
 */
export class TTLSIWxStorage implements SIWxStorage {
  private payments = new Map<string, number>(); // key → timestamp (ms)
  private ttlMs: number;

  constructor(ttlMs: number = 60 * 60 * 1000) {
    // Default: 1 hour
    this.ttlMs = ttlMs;
  }

  private key(resource: string, address: string): string {
    return `${resource}:${address.toLowerCase()}`;
  }

  hasPaid(resource: string, address: string): boolean {
    const k = this.key(resource, address);
    const timestamp = this.payments.get(k);

    if (timestamp === undefined) {
      return false;
    }

    // Check if the payment is still within the TTL window
    if (Date.now() - timestamp > this.ttlMs) {
      this.payments.delete(k); // Clean up expired entry
      console.log(
        `[siwx-storage] Payment expired for ${address} on ${resource}`,
      );
      return false;
    }

    console.log(
      `[siwx-storage] Valid payment found for ${address} on ${resource}`,
    );
    return true;
  }

  recordPayment(resource: string, address: string): void {
    const k = this.key(resource, address);
    this.payments.set(k, Date.now());
    console.log(`[siwx-storage] Payment recorded for ${address} on ${resource}`);
  }
}
