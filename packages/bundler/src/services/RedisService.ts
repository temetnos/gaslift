import { createClient, RedisClientType } from 'redis';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import config from '../config';

export class RedisService {
  private client: RedisClientType;
  private static instance: RedisService;
  private isConnected = false;

  private constructor() {
    this.client = createClient({
      url: config.redis.url,
      ...(config.redis.password && { password: config.redis.password }),
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            logger.error('Max Redis reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1.6s, 3.2s
          return Math.min(retries * 100, 3200);
        },
      },
    });

    this.setupEventListeners();
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  private setupEventListeners(): void {
    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (err) => {
      logger.error('Redis client error:', err);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      logger.warn('Redis client disconnected');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;
    
    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    
    try {
      await this.client.quit();
      this.isConnected = false;
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  public async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Error getting key ${key}:`, error);
      throw error;
    }
  }

  public async set(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, { EX: ttlSeconds });
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error(`Error setting key ${key}:`, error);
      throw error;
    }
  }

  public async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error(`Error deleting key ${key}:`, error);
      throw error;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Error checking if key exists ${key}:`, error);
      throw error;
    }
  }

  public async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Error incrementing key ${key}:`, error);
      throw error;
    }
  }

  public async decr(key: string): Promise<number> {
    try {
      return await this.client.decr(key);
    } catch (error) {
      logger.error(`Error decrementing key ${key}:`, error);
      throw error;
    }
  }

  public async expire(key: string, seconds: number): Promise<boolean> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error(`Error setting expiry for key ${key}:`, error);
      throw error;
    }
  }

  public async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error(`Error getting TTL for key ${key}:`, error);
      throw error;
    }
  }

  public async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Error getting keys for pattern ${pattern}:`, error);
      throw error;
    }
  }

  public async flushAll(): Promise<void> {
    try {
      await this.client.flushAll();
    } catch (error) {
      logger.error('Error flushing all Redis data:', error);
      throw error;
    }
  }

  public async rateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; reset: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const clearBefore = now - windowMs * 2; // Clear old entries to save space

    try {
      // Clean up old entries
      await this.client.zRemRangeByScore(key, 0, clearBefore);

      // Get current count in the window
      const count = await this.client.zCount(key, windowStart, now);

      if (count >= maxRequests) {
        // Get the oldest timestamp in the window to calculate reset time
        const oldest = await this.client.zRange(key, 0, 0, { BY: 'SCORE', REV: true });
        const resetTime = oldest.length > 0 ? parseInt(oldest[0]) + windowMs : now + windowMs;
        
        return {
          allowed: false,
          remaining: Math.max(0, maxRequests - count),
          reset: resetTime,
        };
      }

      // Add current request to the sorted set
      await this.client.zAdd(key, { score: now, value: now.toString() });
      
      // Set expiry on the key
      await this.client.expire(key, Math.ceil(windowMs / 1000) * 2);

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - count - 1),
        reset: now + windowMs,
      };
    } catch (error) {
      logger.error('Error in rate limiting:', error);
      // Fail open in case of Redis errors
      return { allowed: true, remaining: maxRequests, reset: now + windowMs };
    }
  }

  public async getClient(): Promise<RedisClientType> {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.client;
  }
}

// Export a singleton instance
export const redisService = RedisService.getInstance();
