import Redis from 'ioredis';
import { PoolState, ArbitrageRoute, REDIS_CHANNELS } from '../types.js';
import { loadConfig } from '../config.js';
import { getLogger, logSystemEvent, logError } from '../logger/index.js';

// ─── Redis Pub/Sub Client ─────────────────────────────────────────────────────
export class RedisClient {
  private pubClient: Redis;
  private subClient: Redis;
  private isConnected: boolean = false;
  private messageHandlers: Map<string, (channel: string, message: string) => void> = new Map();

  constructor() {
    const redisUrl = loadConfig().REDIS_URL;
    this.pubClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 3000);
        return delay;
      },
      lazyConnect: true,
    });
    this.subClient = this.pubClient.duplicate();
  }

  /**
   * Connect to Redis and subscribe to channels.
   */
  async connect(): Promise<void> {
    const logger = getLogger();

    try {
      await this.pubClient.connect();
      await this.subClient.connect();
      this.isConnected = true;
      logSystemEvent('redis_connected', { url: loadConfig().REDIS_URL });
    } catch (err) {
      logError('redis_connect', err as Error);
      throw err;
    }

    // Subscribe to pool updates from Rust engine
    await this.subClient.subscribe(REDIS_CHANNELS.POOL_UPDATES);
    await this.subClient.subscribe(REDIS_CHANNELS.ML_SCORES);
    await this.subClient.subscribe(REDIS_CHANNELS.COMMANDS);

    // Handle incoming messages
    this.subClient.on('message', (channel, message) => {
      const handler = this.messageHandlers.get(channel);
      if (handler) {
        try {
          handler(channel, message);
        } catch (err) {
          logError(`redis_handler_${channel}`, err as Error);
        }
      }
    });

    logger.info('Redis subscriptions active', {
      channels: [REDIS_CHANNELS.POOL_UPDATES, REDIS_CHANNELS.ML_SCORES, REDIS_CHANNELS.COMMANDS],
    });
  }

  /**
   * Register a handler for pool state updates from the Rust engine.
   */
  onPoolUpdates(handler: (pools: PoolState[]) => void): void {
    this.messageHandlers.set(REDIS_CHANNELS.POOL_UPDATES, (_channel, message) => {
      try {
        const data = JSON.parse(message);
        const pools = Array.isArray(data) ? data : [data];

        // Validate and parse pool states
        const validPools: PoolState[] = [];
        for (const raw of pools) {
          try {
            const pool = PoolState.parse(raw);
            validPools.push(pool);
          } catch (err) {
            logError('pool_parse', err as Error, { raw });
          }
        }

        if (validPools.length > 0) {
          handler(validPools);
        }
      } catch (err) {
        logError('pool_message_parse', err as Error, { message: message.slice(0, 200) });
      }
    });
  }

  /**
   * Register a handler for ML model scores.
   */
  onMlScores(handler: (scores: Array<{ routeId: string; confidence: number }>) => void): void {
    this.messageHandlers.set(REDIS_CHANNELS.ML_SCORES, (_channel, message) => {
      try {
        const scores = JSON.parse(message);
        handler(Array.isArray(scores) ? scores : [scores]);
      } catch (err) {
        logError('ml_scores_parse', err as Error);
      }
    });
  }

  /**
   * Register a handler for system commands.
   */
  onCommands(handler: (command: { action: string; payload?: unknown }) => void): void {
    this.messageHandlers.set(REDIS_CHANNELS.COMMANDS, (_channel, message) => {
      try {
        const command = JSON.parse(message);
        handler(command);
      } catch (err) {
        logError('command_parse', err as Error);
      }
    });
  }

  /**
   * Publish opportunities to Redis for the dashboard.
   */
  async publishOpportunities(opportunities: ArbitrageRoute[]): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.pubClient.publish(
        REDIS_CHANNELS.OPPORTUNITIES,
        JSON.stringify(opportunities)
      );
    } catch (err) {
      logError('publish_opportunities', err as Error);
    }
  }

  /**
   * Publish trade data to Redis.
   */
  async publishTrade(trade: unknown): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.pubClient.publish(
        REDIS_CHANNELS.TRADES,
        JSON.stringify(trade)
      );
    } catch (err) {
      logError('publish_trade', err as Error);
    }
  }

  /**
   * Check if Redis is connected.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from Redis.
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;
    try {
      await this.subClient.unsubscribe();
      await this.subClient.quit();
      await this.pubClient.quit();
    } catch (err) {
      logError('redis_disconnect', err as Error);
    }
    logSystemEvent('redis_disconnected');
  }
}