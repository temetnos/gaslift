import { ethers } from 'ethers';
import { AppDataSource } from '../db/data-source';
import { redisService } from './RedisService';
import { HealthStatus } from '../types';
import { logger } from '../utils/logger';
import config from '../config';

export class HealthService {
  private static instance: HealthService;
  private lastCheck: Date | null = null;
  private lastStatus: HealthStatus | null = null;
  private isChecking = false;
  private checkInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): HealthService {
    if (!HealthService.instance) {
      HealthService.instance = new HealthService();
    }
    return HealthService.instance;
  }

  public async start(): Promise<void> {
    if (this.checkInterval) {
      logger.warn('Health check already started');
      return;
    }

    // Initial health check
    await this.checkHealth();

    // Schedule periodic health checks
    this.checkInterval = setInterval(
      () => this.checkHealth(),
      config.healthCheck.intervalMs
    );

    logger.info('Health check service started');
  }

  public async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Health check service stopped');
  }

  public async getStatus(): Promise<HealthStatus> {
    // If we have a recent status, return it
    if (
      this.lastStatus &&
      this.lastCheck &&
      Date.now() - this.lastCheck.getTime() < config.healthCheck.intervalMs / 2
    ) {
      return this.lastStatus;
    }

    // Otherwise, perform a fresh check
    return this.checkHealth();
  }

  private async checkHealth(): Promise<HealthStatus> {
    if (this.isChecking) {
      logger.debug('Health check already in progress');
      return this.lastStatus || this.createDefaultStatus('degraded');
    }

    this.isChecking = true;
    const startTime = Date.now();
    const status = this.createDefaultStatus('healthy');

    try {
      // Check database connection
      try {
        await AppDataSource.query('SELECT 1');
        status.checks.database = true;
      } catch (error) {
        logger.error('Database health check failed:', error);
        status.status = 'degraded';
        status.checks.database = false;
        status.details = {
          ...status.details,
          databaseError: error instanceof Error ? error.message : String(error),
        };
      }

      // Check Redis connection
      try {
        await redisService.ping();
        status.checks.redis = true;
      } catch (error) {
        logger.error('Redis health check failed:', error);
        status.status = 'degraded';
        status.checks.redis = false;
        status.details = {
          ...status.details,
          redisError: error instanceof Error ? error.message : String(error),
        };
      }

      // Check Ethereum node
      try {
        await config.ethereum.provider.getBlockNumber();
        status.checks.ethereum = true;
      } catch (error) {
        logger.error('Ethereum node health check failed:', error);
        status.status = 'unhealthy';
        status.checks.ethereum = false;
        status.details = {
          ...status.details,
          ethereumError: error instanceof Error ? error.message : String(error),
        };
      }

      // Check bundler balance
      try {
        const balance = await config.ethereum.signer.getBalance();
        const minBalance = config.bundler.minSignerBalance;
        status.checks.bundlerBalance = balance.gte(minBalance);
        
        if (!status.checks.bundlerBalance) {
          logger.warn(
            `Bundler balance (${ethers.utils.formatEther(balance)} ETH) is below minimum (${ethers.utils.formatEther(minBalance)} ETH)`
          );
          status.status = 'degraded';
          status.details = {
            ...status.details,
            bundlerBalance: ethers.utils.formatEther(balance),
            minRequiredBalance: ethers.utils.formatEther(minBalance),
          };
        }
      } catch (error) {
        logger.error('Bundler balance check failed:', error);
        status.checks.bundlerBalance = false;
        status.status = 'degraded';
        status.details = {
          ...status.details,
          balanceCheckError: error instanceof Error ? error.message : String(error),
        };
      }

      // Check EntryPoint contract
      try {
        const code = await config.ethereum.provider.getCode(config.ethereum.entryPointAddress);
        status.checks.entryPointStatus = code !== '0x';
        
        if (!status.checks.entryPointStatus) {
          logger.error('EntryPoint contract not found at address:', config.ethereum.entryPointAddress);
          status.status = 'unhealthy';
          status.details = {
            ...status.details,
            entryPointError: 'Contract not found at the specified address',
          };
        }
      } catch (error) {
        logger.error('EntryPoint check failed:', error);
        status.checks.entryPointStatus = false;
        status.status = 'unhealthy';
        status.details = {
          ...status.details,
          entryPointError: error instanceof Error ? error.message : String(error),
        };
      }

      // Update status based on checks
      if (!status.checks.ethereum || !status.checks.entryPointStatus) {
        status.status = 'unhealthy';
      } else if (!status.checks.database || !status.checks.redis || !status.checks.bundlerBalance) {
        status.status = 'degraded';
      }

      // Add performance metrics
      const duration = Date.now() - startTime;
      status.details = {
        ...status.details,
        checkDurationMs: duration,
        lastCheck: new Date().toISOString(),
        version: process.env.npm_package_version || 'unknown',
        nodeEnv: config.nodeEnv,
      };

      this.lastStatus = status;
      this.lastCheck = new Date();
      
      return status;
    } catch (error) {
      logger.error('Health check failed:', error);
      const errorStatus = this.createDefaultStatus('unhealthy');
      errorStatus.details = {
        ...errorStatus.details,
        error: error instanceof Error ? error.message : String(error),
      };
      this.lastStatus = errorStatus;
      return errorStatus;
    } finally {
      this.isChecking = false;
    }
  }

  private createDefaultStatus(status: 'healthy' | 'degraded' | 'unhealthy'): HealthStatus {
    return {
      status,
      timestamp: new Date(),
      checks: {
        database: false,
        redis: false,
        ethereum: false,
        bundlerBalance: false,
        entryPointStatus: false,
      },
      details: {},
    };
  }

  public async ping(): Promise<boolean> {
    try {
      await this.checkHealth();
      return true;
    } catch (error) {
      logger.error('Ping failed:', error);
      return false;
    }
  }
}

// Export a singleton instance
export const healthService = HealthService.getInstance();
