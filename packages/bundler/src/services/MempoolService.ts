import { BigNumber, BigNumberish, ethers } from 'ethers';
import { UserOperationStruct } from '@account-abstraction/contracts/v0.6/EntryPoint';
import { UserOperation } from '../db/entities/UserOperation';
import { UserOperationRepository } from '../db/repositories/UserOperationRepository';
import { redisService } from './RedisService';
import { logger } from '../utils/logger';
import { entryPointService } from './EntryPointService';
import { BundleRepository } from '../db/repositories/BundleRepository';
import { UserOperationWithHash } from '../types';

export class MempoolService {
  private static instance: MempoolService;
  private userOpRepo: UserOperationRepository;
  private bundleRepo: BundleRepository;
  private logger = logger.child({ context: 'MempoolService' });
  private readonly MEMPOOL_KEY_PREFIX = 'mempool:';
  private readonly SENDER_NONCE_KEY_PREFIX = 'sender_nonce:';
  private readonly MAX_MEMPOOL_SIZE = 1000;
  private readonly MEMPOOL_TTL = 24 * 60 * 60; // 24 hours in seconds

  private constructor() {
    this.userOpRepo = new UserOperationRepository();
    this.bundleRepo = new BundleRepository();
  }

  public static getInstance(): MempoolService {
    if (!MempoolService.instance) {
      MempoolService.instance = new MempoolService();
    }
    return MempoolService.instance;
  }

  public async addUserOperation(
    userOp: UserOperationStruct
  ): Promise<UserOperation> {
    try {
      // Generate a unique hash for the user operation
      const userOpHash = this.getUserOperationHash(userOp);
      
      // Check if user operation already exists in mempool
      const existingOp = await this.userOpRepo.findByHash(userOpHash);
      if (existingOp) {
        this.logger.debug('User operation already in mempool', { userOpHash });
        return existingOp;
      }

      // Validate user operation
      await this.validateUserOperation(userOp);

      // Save to database
      const savedOp = await this.userOpRepo.create({
        ...userOp,
        hash: userOpHash,
        status: 'pending',
        submittedAt: new Date(),
      });

      // Add to Redis for fast lookup
      await this.addToMempool(savedOp);

      this.logger.info('Added user operation to mempool', { 
        userOpHash,
        sender: userOp.sender,
        nonce: userOp.nonce.toString(),
      });

      return savedOp;
    } catch (error) {
      this.logger.error('Failed to add user operation to mempool:', error);
      throw error;
    }
  }

  public async removeUserOperation(userOpHash: string): Promise<boolean> {
    try {
      // Remove from Redis
      const removed = await this.removeFromMempool(userOpHash);
      
      if (removed) {
        // Update status in database
        await this.userOpRepo.update(userOpHash, { status: 'removed' });
        this.logger.debug('Removed user operation from mempool', { userOpHash });
      }
      
      return removed;
    } catch (error) {
      this.logger.error('Failed to remove user operation from mempool:', error);
      throw error;
    }
  }

  public async getUserOperation(userOpHash: string): Promise<UserOperation | null> {
    try {
      // First try to get from Redis
      const redisKey = `${this.MEMPOOL_KEY_PREFIX}${userOpHash}`;
      const cachedOp = await redisService.get(redisKey);
      
      if (cachedOp) {
        return JSON.parse(cachedOp);
      }
      
      // Fall back to database
      return this.userOpRepo.findByHash(userOpHash);
    } catch (error) {
      this.logger.error('Failed to get user operation:', error);
      throw error;
    }
  }

  public async getMempoolSize(): Promise<number> {
    try {
      const redis = await redisService.getClient();
      const keys = await redis.keys(`${this.MEMPOOL_KEY_PREFIX}*`);
      return keys.length;
    } catch (error) {
      this.logger.error('Failed to get mempool size:', error);
      throw error;
    }
  }

  public async getPendingUserOperations(limit = 100): Promise<UserOperationWithHash[]> {
    try {
      // Get pending user operations from database
      const userOps = await this.userOpRepo.getPendingUserOperations(limit);
      
      // Convert to UserOperationWithHash format
      return userOps.map(op => ({
        ...op,
        nonce: BigNumber.from(op.nonce),
        callGasLimit: BigNumber.from(op.callGasLimit),
        verificationGasLimit: BigNumber.from(op.verificationGasLimit),
        preVerificationGas: BigNumber.from(op.preVerificationGas),
        maxFeePerGas: BigNumber.from(op.maxFeePerGas),
        maxPriorityFeePerGas: BigNumber.from(op.maxPriorityFeePerGas),
      }));
    } catch (error) {
      this.logger.error('Failed to get pending user operations:', error);
      throw error;
    }
  }

  public async clearMempool(): Promise<void> {
    try {
      const redis = await redisService.getClient();
      const keys = await redis.keys(`${this.MEMPOOL_KEY_PREFIX}*`);
      
      if (keys.length > 0) {
        await redis.del(keys);
      }
      
      this.logger.info('Cleared mempool');
    } catch (error) {
      this.logger.error('Failed to clear mempool:', error);
      throw error;
    }
  }

  public async validateReplaceUserOp(
    oldOp: UserOperationStruct,
    newOp: UserOperationStruct
  ): Promise<boolean> {
    // Check if the sender and nonce match
    if (oldOp.sender !== newOp.sender || oldOp.nonce !== newOp.nonce) {
      return false;
    }

    // Get the old operation hash
    const oldOpHash = this.getUserOperationHash(oldOp);
    
    // Get the new operation hash
    const newOpHash = this.getUserOperationHash(newOp);
    
    // Check if the new operation pays enough to replace the old one
    const oldMaxPriorityFee = BigNumber.from(oldOp.maxPriorityFeePerGas);
    const newMaxPriorityFee = BigNumber.from(newOp.maxPriorityFeePerGas);
    
    // New operation must pay at least 10% more than the old one
    const minNewMaxPriorityFee = oldMaxPriorityFee.mul(110).div(100);
    
    if (newMaxPriorityFee.lt(minNewMaxPriorityFee)) {
      return false;
    }
    
    // Check if the new operation has a higher max fee
    const oldMaxFee = BigNumber.from(oldOp.maxFeePerGas);
    const newMaxFee = BigNumber.from(newOp.maxFeePerGas);
    
    if (newMaxFee.lt(oldMaxFee)) {
      return false;
    }
    
    // All checks passed, the new operation can replace the old one
    await this.removeUserOperation(oldOpHash);
    return true;
  }

  private async validateUserOperation(userOp: UserOperationStruct): Promise<void> {
    // Basic validation
    if (!ethers.utils.isAddress(userOp.sender)) {
      throw new Error(`Invalid sender address: ${userOp.sender}`);
    }

    if (!userOp.nonce) {
      throw new Error('Nonce is required');
    }

    // Check if the mempool is full
    const mempoolSize = await this.getMempoolSize();
    if (mempoolSize >= this.MAX_MEMPOOL_SIZE) {
      throw new Error('Mempool is full');
    }

    // Check for conflicting user operations (same sender and nonce)
    const conflictKey = `${this.SENDER_NONCE_KEY_PREFIX}${userOp.sender}:${userOp.nonce}`;
    const existingOpHash = await redisService.get(conflictKey);
    
    if (existingOpHash) {
      const existingOp = await this.getUserOperation(existingOpHash);
      
      if (existingOp) {
        // Check if the new operation can replace the existing one
        const canReplace = await this.validateReplaceUserOp(existingOp, userOp);
        
        if (!canReplace) {
          throw new Error(`Conflicting user operation with nonce ${userOp.nonce} for sender ${userOp.sender}`);
        }
      }
    }

    // Validate the user operation with the EntryPoint
    try {
      await entryPointService.simulateValidation(userOp);
    } catch (error) {
      this.logger.error('User operation validation failed:', error);
      throw new Error(`User operation validation failed: ${error.message}`);
    }
  }

  private async addToMempool(userOp: UserOperation): Promise<void> {
    const redis = await redisService.getClient();
    const pipeline = redis.pipeline();
    
    const userOpKey = `${this.MEMPOOL_KEY_PREFIX}${userOp.hash}`;
    const senderNonceKey = `${this.SENDER_NONCE_KEY_PREFIX}${userOp.sender}:${userOp.nonce}`;
    
    // Add to mempool
    pipeline.set(
      userOpKey,
      JSON.stringify(userOp),
      'EX',
      this.MEMPOOL_TTL
    );
    
    // Update sender nonce index
    pipeline.set(
      senderNonceKey,
      userOp.hash,
      'EX',
      this.MEMPOOL_TTL
    );
    
    await pipeline.exec();
  }

  private async removeFromMempool(userOpHash: string): Promise<boolean> {
    const redis = await redisService.getClient();
    const userOp = await this.getUserOperation(userOpHash);
    
    if (!userOp) {
      return false;
    }
    
    const pipeline = redis.pipeline();
    
    // Remove from mempool
    pipeline.del(`${this.MEMPOOL_KEY_PREFIX}${userOpHash}`);
    
    // Remove from sender nonce index
    pipeline.del(`${this.SENDER_NONCE_KEY_PREFIX}${userOp.sender}:${userOp.nonce}`);
    
    await pipeline.exec();
    
    return true;
  }

  private getUserOperationHash(userOp: UserOperationStruct): string {
    // This is a simplified version of the actual hash calculation
    // In a real implementation, you would use the EntryPoint's getHash method
    const packed = ethers.utils.defaultAbiCoder.encode(
      [
        'address', // sender
        'uint256', // nonce
        'bytes32', // initCode hash
        'bytes32', // callData hash
        'uint256', // callGasLimit
        'uint256', // verificationGasLimit
        'uint256', // preVerificationGas
        'uint256', // maxFeePerGas
        'uint256', // maxPriorityFeePerGas
        'bytes32', // paymasterAndData hash
      ],
      [
        userOp.sender,
        userOp.nonce,
        ethers.utils.keccak256(userOp.initCode || '0x'),
        ethers.utils.keccak256(userOp.callData || '0x'),
        userOp.callGasLimit || 0,
        userOp.verificationGasLimit || 0,
        userOp.preVerificationGas || 0,
        userOp.maxFeePerGas || 0,
        userOp.maxPriorityFeePerGas || 0,
        ethers.utils.keccak256(userOp.paymasterAndData || '0x'),
      ]
    );
    
    return ethers.utils.keccak256(packed);
  }
}

// Export a singleton instance
export const mempoolService = MempoolService.getInstance();
