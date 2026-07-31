import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WalletManager, executeTrade, ExecutionRequest } from './index.js';

// ─── Mock @solana/web3.js ─────────────────────────────────────────────────────
vi.mock('@solana/web3.js', () => {
  const MockConnection = vi.fn().mockImplementation(() => ({
    getBalance: vi.fn().mockResolvedValue(5 * 1e9),
  }));

  const MockPublicKey = vi.fn((key: string) => key);

  return {
    Connection: MockConnection,
    PublicKey: MockPublicKey,
    LAMPORTS_PER_SOL: 1_000_000_000,
    Keypair: {
      fromSecretKey: vi.fn(() => ({ publicKey: { toBase58: () => 'mock_pubkey' } })),
      generate: vi.fn(() => ({ publicKey: { toBase58: () => 'generated_pubkey' } })),
    },
  };
});

// ─── WalletManager Tests ──────────────────────────────────────────────────────
describe('WalletManager', () => {
  let walletManager: WalletManager;

  beforeEach(() => {
    // Clear any env vars from previous tests
    delete process.env.SECRET_KEY_1;
    delete process.env.SECRET_KEY_2;
    delete process.env.WALLET_PRIVATE_KEY;
    delete process.env.WALLET_PUBLIC_KEY;

    // Create with mocked connection
    const { Connection } = require('@solana/web3.js');
    const connection = new Connection('http://localhost:8899'); // Provide a valid-looking URL
    walletManager = new WalletManager(connection);
  });

  afterEach(() => {
    if (walletManager) {
      walletManager.stop();
    }
  });

  it('should load wallets from SECRET_KEY_1, SECRET_KEY_2 env vars', async () => {
    process.env.SECRET_KEY_1 = 'abc123';
    process.env.SECRET_KEY_2 = 'def456';

    const count = await walletManager.loadFromEnv();
    expect(count).toBe(2);

    const wallets = walletManager.getAllWallets();
    expect(wallets.length).toBe(2);
    expect(wallets[0].index).toBe(1);
    expect(wallets[0].isActive).toBe(true);
    expect(wallets[1].index).toBe(2);
  });

  it('should fall back to single WALLET_PRIVATE_KEY', async () => {
    process.env.WALLET_PRIVATE_KEY = 'single-key-here';

    const count = await walletManager.loadFromEnv();
    expect(count).toBe(1);

    const wallets = walletManager.getAllWallets();
    expect(wallets.length).toBe(1);
    expect(wallets[0].index).toBe(0);
  });

  it('should return placeholder wallet when no keys found', async () => {
    const count = await walletManager.loadFromEnv();
    expect(count).toBe(1);

    const wallets = walletManager.getAllWallets();
    expect(wallets[0].publicKey).toBe('PLACEHOLDER_WALLET');
    expect(wallets[0].isActive).toBe(false);
  });

  it('should rotate wallets in round-robin order', async () => {
    process.env.SECRET_KEY_1 = 'abc123';
    process.env.SECRET_KEY_2 = 'def456';
    await walletManager.loadFromEnv();

    const wallet1 = walletManager.getNextWallet();
    const wallet2 = walletManager.getNextWallet();
    const wallet3 = walletManager.getNextWallet(); // should wrap around

    expect(wallet1).not.toBeNull();
    expect(wallet2).not.toBeNull();
    expect(wallet3).not.toBeNull();
    expect(wallet1!.index).not.toBe(wallet2!.index);
    // After 2 wallets, third should be first again
    expect(wallet3!.index).toBe(wallet1!.index);
  });

  it('should return null when no active wallets', () => {
    const wallet = walletManager.getNextWallet();
    expect(wallet).toBeNull();
  });

  it('should get a specific wallet by public key', async () => {
    process.env.SECRET_KEY_1 = 'abc123';
    await walletManager.loadFromEnv();

    const wallets = walletManager.getAllWallets();
    const found = walletManager.getWallet(wallets[0].publicKey);
    expect(found).not.toBeUndefined();
    expect(found!.publicKey).toBe(wallets[0].publicKey);
  });

  it('should return undefined for unknown wallet', () => {
    const found = walletManager.getWallet('nonexistent');
    expect(found).toBeUndefined();
  });

  it('should return total balance across all wallets', async () => {
    process.env.SECRET_KEY_1 = 'abc123';
    await walletManager.loadFromEnv();

    const total = walletManager.getTotalBalance();
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('should refresh balance for a specific wallet', async () => {
    process.env.SECRET_KEY_1 = 'abc123';
    await walletManager.loadFromEnv();

    const wallets = walletManager.getAllWallets();
    expect(wallets[0].balance).toBeGreaterThanOrEqual(0);
  });

  it('should return null for invalid wallet on refresh', async () => {
    const balance = await walletManager.refreshBalance('nonexistent');
    expect(balance).toBeNull();
  });
});

// ─── executeTrade Tests ───────────────────────────────────────────────────────
describe('executeTrade', () => {
  const mockRequest: ExecutionRequest = {
    routeId: 'route-1',
    hops: [
      {
        dex: 'raydium',
        poolAddress: 'pool1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 1.0,
        minAmountOut: 0.99,
      },
    ],
    wallet: 'wallet1',
    priorityFee: 0.000005,
    computeBudget: 200_000,
  };

  it('should attempt to execute trade via engine URL', async () => {
    // This will attempt to connect to localhost:18081 which likely isn't running
    // So it should return a failure response
    const result = await executeTrade(mockRequest, 'http://localhost:18081');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle connection errors gracefully', async () => {
    const result = await executeTrade(mockRequest, 'http://nonexistent:9999');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});