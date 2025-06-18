import { BigNumber, BigNumberish, ethers } from 'ethers';
import { UserOperationStruct } from '@account-abstraction/contracts/v0.6/EntryPoint';
import { UserOperationRepository } from '../db/repositories/UserOperationRepository';
import { BundleRepository } from '../db/repositories/BundleRepository';
import { mempoolService } from './MempoolService';
import { entryPointService } from './EntryPointService';
import { redisService } from './RedisService';
import { logger } from '../utils/logger';
import config from '../config';

// Maximum number of user operations to include in a single bundle
const MAX_OPS_PER_BUNDLE = 10;
// Maximum gas limit for a single bundle
const MAX_BUNDLE_GAS_LIMIT = 10_000_000;
// Maximum time to wait for a transaction to be mined (in milliseconds)
const TX_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
// Interval between bundle submissions (in milliseconds)
const BUNDLE_INTERVAL_MS = 5000; // 5 seconds

export class BundlerService {
  private static instance: BundlerService;
  private userOpRepo: UserOperationRepository;
  private bundleRepo: BundleRepository;
  private isRunning = false;
  private bundleInterval: NodeJS.Timeout | null = null;
  private logger = logger.child({ context: 'BundlerService' });
  private readonly BUNDLE_LOCK_KEY = 'bundle:lock';
  private readonly BUNDLE_LOCK_TTL = 30; // 30 seconds

  private constructor() {
    this.userOpRepo = new UserOperationRepository();
    this.bundleRepo = new BundleRepository();
  }

  public static getInstance(): BundlerService {
    if (!BundlerService.instance) {
      BundlerService.instance = new BundlerService();
    }
    return BundlerService.instance;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Bundler service is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting bundler service');

    // Start the bundler loop
    this.bundleInterval = setInterval(
      () => this.bundleLoop().catch(console.error),
      BUNDLE_INTERVAL_MS
    );

    // Initial bundle attempt
    await this.bundleLoop().catch(console.error);
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.bundleInterval) {
      clearInterval(this.bundleInterval);
      this.bundleInterval = null;
    }

    this.logger.info('Stopped bundler service');
  }

  private async bundleLoop(): Promise<void> {
    try {
      // Check if bundling is already in progress
      const lockAcquired = await this.acquireBundleLock();
      if (!lockAcquired) {
        this.logger.debug('Bundle operation already in progress, skipping');
        return;
      }

      try {
        await this.createAndSubmitBundle();
      } finally {
        // Always release the lock
        await this.releaseBundleLock();
      }
    } catch (error) {
      this.logger.error('Error in bundle loop:', error);
    }
  }

  private async createAndSubmitBundle(): Promise<void> {
    // Get pending user operations from mempool
    const pendingOps = await mempoolService.getPendingUserOperations(MAX_OPS_PER_BUNDLE);
    
    if (pendingOps.length === 0) {
      this.logger.debug('No pending user operations to bundle');
      return;
    }

    this.logger.info(`Found ${pendingOps.length} pending user operations to bundle`);

    // Create a bundle in the database
    const bundle = await this.bundleRepo.createBundle(pendingOps.map(op => op.id));
    
    try {
      // Submit the bundle to the blockchain
      const tx = await this.submitBundle(bundle.id, pendingOps);
      
      // Update bundle with transaction hash
      await this.bundleRepo.markAsSubmitted(bundle.id, tx.hash);
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      
      // Update bundle with block number and mark as confirmed
      await this.bundleRepo.markAsConfirmed(bundle.id, receipt.blockNumber);
      
      // Update user operations status
      await this.userOpRepo.markAsConfirmed(
        pendingOps.map(op => op.id),
        receipt.blockNumber
      );
      
      this.logger.info(
        `Successfully submitted bundle ${bundle.id} in transaction ${tx.hash}`,
        { blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() }
      );
    } catch (error) {
      // Handle errors during bundle submission
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to submit bundle ${bundle.id}:`, error);
      
      // Mark bundle as failed
      await this.bundleRepo.markAsFailed(bundle.id, errorMessage);
      
      // Mark user operations as failed
      await this.userOpRepo.markAsFailed(
        pendingOps.map(op => op.id),
        errorMessage
      );
      
      // Remove failed user operations from mempool
      for (const op of pendingOps) {
        await mempoolService.removeUserOperation(op.hash);
      }
    }
  }

  private async submitBundle(
    bundleId: string,
    userOps: UserOperationStruct[]
  ): Promise<ethers.providers.TransactionResponse> {
    this.logger.info(`Submitting bundle ${bundleId} with ${userOps.length} user operations`);
    
    // Estimate gas for the bundle
    const gasEstimate = await this.estimateBundleGas(userOps);
    
    // Get current gas price
    const feeData = await config.ethereum.provider.getFeeData();
    
    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
      throw new Error('Failed to get gas price data');
    }
    
    // Add buffer to gas prices
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
      .mul(120)
      .div(100);
    
    const maxFeePerGas = feeData.maxFeePerGas
      .mul(120)
      .div(100);
    
    // Submit the bundle to the EntryPoint
    return entryPointService.handleOps(
      userOps,
      config.bundler.beneficiary,
      {
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit: gasEstimate.mul(12).div(10), // 20% buffer
      }
    );
  }

  private async estimateBundleGas(
    userOps: UserOperationStruct[]
  ): Promise<BigNumber> {
    // Simple estimation: sum of all verificationGasLimit and callGasLimit
    // In a real implementation, you would want to simulate the transaction
    let totalGas = BigNumber.from(0);
    
    for (const op of userOps) {
      totalGas = totalGas.add(op.verificationGasLimit || 0);
      totalGas = totalGas.add(op.callGasLimit || 0);
    }
    
    // Add a fixed overhead per operation
    totalGas = totalGas.add(BigNumber.from(21000).mul(userOps.length));
    
    // Ensure we don't exceed the block gas limit
    return BigNumber.from(Math.min(totalGas.toNumber(), MAX_BUNDLE_GAS_LIMIT));
  }

  private async acquireBundleLock(): Promise<boolean> {
    try {
      const redis = await redisService.getClient();
      
      // Try to acquire a lock with SET NX EX (set if not exists with expiry)
      const result = await redis.set(
        this.BUNDLE_LOCK_KEY,
        '1',
        'NX',
        'EX',
        this.BUNDLE_LOCK_TTL
      );
      
      return result === 'OK';
    } catch (error) {
      this.logger.error('Failed to acquire bundle lock:', error);
      return false;
    }
  }

  private async releaseBundleLock(): Promise<void> {
    try {
      const redis = await redisService.getClient();
      await redis.del(this.BUNDLE_LOCK_KEY);
    } catch (error) {
      this.logger.error('Failed to release bundle lock:', error);
    }
  }

  public async getStatus(): Promise<{
    isRunning: boolean;
    mempoolSize: number;
    lastBundleId?: string;
    lastBundleTime?: Date;
  }> {
    const mempoolSize = await mempoolService.getMempoolSize();
    const lastBundle = await this.bundleRepo.findMany({
      order: { createdAt: 'DESC' },
      take: 1,
    });

    return {
      isRunning: this.isRunning,
      mempoolSize,
      lastBundleId: lastBundle[0]?.id,
      lastBundleTime: lastBundle[0]?.createdAt,
    };
  }
}

// Export a singleton instance
export const bundlerService = BundlerService.getInstance();
