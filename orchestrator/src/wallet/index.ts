import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as crypto from 'node:crypto';
import { WalletState } from '../types.js';
import { getLogger, logSystemEvent, logError } from '../logger/index.js';

// ─── Wallet Manager ───────────────────────────────────────────────────────────
export class WalletManager {
  private wallets: WalletState[] = [];
  private currentIndex: number = 0;
  private connection: Connection;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Load wallets from environment variables.
   * Expects SECRET_KEY_1, SECRET_KEY_2, ... or WALLET_PRIVATE_KEY.
   * Each is a base58-encoded private key.
   */
  async loadFromEnv(): Promise<number> {
    const logger = getLogger();
    const loaded: WalletState[] = [];
    let index = 0;

    // Try SECRET_KEY_1, SECRET_KEY_2, ... pattern first
    while (true) {
      index++;
      const key = process.env[`SECRET_KEY_${index}`];
      if (!key) break;

      try {
        // For now, we store the public key — actual key derivation
        // will be done by the Rust execution engine
        const publicKey = this.derivePublicKey(key);
        loaded.push({
          publicKey,
          index,
          balance: 0,
          lastChecked: 0,
          isActive: true,
        });
      } catch (err) {
        logError(`wallet_load_env_${index}`, err as Error);
      }
    }

    // Fall back to single WALLET_PRIVATE_KEY
    if (loaded.length === 0 && process.env.WALLET_PRIVATE_KEY) {
      try {
        const publicKey = this.derivePublicKey(process.env.WALLET_PRIVATE_KEY);
        loaded.push({
          publicKey,
          index: 0,
          balance: 0,
          lastChecked: 0,
          isActive: true,
        });
      } catch (err) {
        logError('wallet_load_single', err as Error);
      }
    }

    // If no keys found, add a placeholder for configuration
    if (loaded.length === 0) {
      logger.warn('No wallet keys found in environment. Using placeholder wallet.');
      loaded.push({
        publicKey: 'PLACEHOLDER_WALLET',
        index: 0,
        balance: 0,
        lastChecked: 0,
        isActive: false,
      });
    }

    this.wallets = loaded;
    logSystemEvent('wallets_loaded', { count: this.wallets.length });

    // Start balance polling
    this.startBalancePolling();

    // Initial balance fetch
    await this.refreshAllBalances();

    return this.wallets.length;
  }

  /**
   * Derive a public key from a private key string.
   * In production, this uses @solana/web3.js Keypair.
   * For now, we return a placeholder or derive from the key string.
   */
  private derivePublicKey(privateKeyStr: string): string {
    try {
      // Try to parse as a Solana Keypair from base58
      const decoded = Buffer.from(privateKeyStr, 'base58');
      if (decoded.length === 64) {
        // Full keypair — take the last 32 bytes as secret, derive public
        // Actually in Solana, Keypair.fromSecretKey takes the full 64 bytes
        // We'll just return a placeholder for now — the Rust engine handles signing
        return `Wallet_${privateKeyStr.slice(0, 8)}...`;
      }
    } catch {
      // Not base58, use as-is for placeholder
    }
    return `Wallet_${crypto.createHash('sha256').update(privateKeyStr).digest('hex').slice(0, 16)}`;
  }

  /**
   * Get the next wallet in round-robin rotation.
   */
  getNextWallet(): WalletState | null {
    const activeWallets = this.wallets.filter(w => w.isActive);
    if (activeWallets.length === 0) return null;

    const wallet = activeWallets[this.currentIndex % activeWallets.length];
    this.currentIndex = (this.currentIndex + 1) % activeWallets.length;
    return wallet;
  }

  /**
   * Get a specific wallet by public key.
   */
  getWallet(publicKey: string): WalletState | undefined {
    return this.wallets.find(w => w.publicKey === publicKey);
  }

  /**
   * Get all wallets.
   */
  getAllWallets(): WalletState[] {
    return [...this.wallets];
  }

  /**
   * Get the total balance across all wallets.
   */
  getTotalBalance(): number {
    return this.wallets.reduce((sum, w) => sum + w.balance, 0);
  }

  /**
   * Refresh balance for a single wallet.
   */
  async refreshBalance(publicKey: string): Promise<number | null> {
    const wallet = this.getWallet(publicKey);
    if (!wallet) return null;

    try {
      const pubKey = new PublicKey(publicKey);
      const balanceLamports = await this.connection.getBalance(pubKey);
      const balance = balanceLamports / LAMPORTS_PER_SOL;
      wallet.balance = balance;
      wallet.lastChecked = Date.now();
      return balance;
    } catch (err) {
      logError(`balance_refresh_${publicKey}`, err as Error);
      return null;
    }
  }

  /**
   * Refresh balances for all wallets.
   */
  async refreshAllBalances(): Promise<void> {
    for (const wallet of this.wallets) {
      if (wallet.isActive) {
        await this.refreshBalance(wallet.publicKey);
      }
    }
    logSystemEvent('balances_refreshed', {
      wallets: this.wallets.map(w => ({ pubkey: w.publicKey, balance: w.balance })),
    });
  }

  /**
   * Start automatic balance polling.
   */
  private startBalancePolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      this.refreshAllBalances().catch(err => {
        logError('balance_poll', err as Error);
      });
    }, 30_000); // every 30 seconds
  }

  /**
   * Stop balance polling.
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// ─── Transaction Signing Delegation ───────────────────────────────────────────
export interface ExecutionRequest {
  routeId: string;
  hops: Array<{
    dex: string;
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    minAmountOut: number;
  }>;
  wallet: string;
  priorityFee: number;
  computeBudget: number;
}

export interface ExecutionResponse {
  success: boolean;
  txSignature?: string;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Delegates transaction execution to the Rust engine.
 * The Rust engine handles actual signing and submission.
 */
export async function executeTrade(
  request: ExecutionRequest,
  engineUrl: string = 'http://localhost:8081'
): Promise<ExecutionResponse> {
  const logger = getLogger();
  const startTime = Date.now();

  try {
    const { default: axios } = await import('axios');
    const response = await axios.post(`${engineUrl}/api/execute`, request, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });

    const executionTimeMs = Date.now() - startTime;

    if (response.data.success) {
      logger.info(
        { txSignature: response.data.txSignature, executionTimeMs },
        'Trade executed successfully via Rust engine'
      );
      return {
        success: true,
        txSignature: response.data.txSignature,
        executionTimeMs,
      };
    }

    logger.error({ error: response.data.error, executionTimeMs }, 'Trade execution failed');
    return {
      success: false,
      error: response.data.error || 'Unknown error',
      executionTimeMs,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - startTime;
    logger.error({ err: err.message, executionTimeMs }, 'Trade execution request failed');
    return {
      success: false,
      error: err.message || 'Failed to communicate with execution engine',
      executionTimeMs,
    };
  }
}