import 'reflect-metadata';
import { ethers } from 'ethers';
import { mempoolService } from '../../src/services/MempoolService';
import { createTestUserOperation, signUserOp, testWallet } from '../test-utils';
import { AppDataSource } from '../../src/db/data-source';
import { UserOperation } from '../../src/db/entities/UserOperation';

describe('MempoolService', () => {
  let userOp: any;

  beforeAll(async () => {
    // Initialize the database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  beforeEach(async () => {
    // Create a test user operation
    userOp = createTestUserOperation({
      sender: testWallet.address,
      nonce: 0,
    });
    
    // Sign the user operation
    userOp = await signUserOp(userOp);
  });

  afterEach(async () => {
    // Clear the database and Redis between tests
    await AppDataSource.getRepository(UserOperation).clear();
    const redis = await mempoolService['redis'].getClient();
    await redis.flushdb();
  });

  describe('addUserOperation', () => {
    it('should add a user operation to the mempool', async () => {
      // Act
      const result = await mempoolService.addUserOperation(userOp);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.sender).toBe(userOp.sender);
      expect(Number(result.nonce)).toBe(Number(userOp.nonce));
      
      // Verify the operation is in the database
      const dbOp = await AppDataSource.getRepository(UserOperation).findOne({
        where: { hash: result.hash },
      });
      
      expect(dbOp).toBeDefined();
      expect(dbOp?.status).toBe('pending');
      
      // Verify the operation is in Redis
      const redisOp = await mempoolService.getUserOperation(result.hash);
      expect(redisOp).toBeDefined();
      expect(redisOp?.sender).toBe(userOp.sender);
    });

    it('should not add a duplicate user operation', async () => {
      // Arrange
      const firstAdd = await mempoolService.addUserOperation(userOp);
      
      // Act
      const secondAdd = await mempoolService.addUserOperation(userOp);
      
      // Assert
      expect(secondAdd.hash).toBe(firstAdd.hash);
      
      // Verify only one operation exists in the database
      const ops = await AppDataSource.getRepository(UserOperation).find();
      expect(ops.length).toBe(1);
    });

    it('should replace a user operation with higher gas fees', async () => {
      // Arrange - Add initial user operation
      const initialOp = await mempoolService.addUserOperation(userOp);
      
      // Create a replacement with higher fees
      const replacementOp = {
        ...userOp,
        maxPriorityFeePerGas: ethers.BigNumber.from(userOp.maxPriorityFeePerGas).mul(2),
        maxFeePerGas: ethers.BigNumber.from(userOp.maxFeePerGas).mul(2),
      };
      
      // Act - Add replacement
      const result = await mempoolService.addUserOperation(replacementOp);
      
      // Assert
      expect(result.maxPriorityFeePerGas).not.toBe(userOp.maxPriorityFeePerGas);
      
      // Verify the old operation was removed
      const oldOp = await mempoolService.getUserOperation(initialOp.hash);
      expect(oldOp).toBeNull();
      
      // Verify the new operation is in the database
      const dbOp = await AppDataSource.getRepository(UserOperation).findOne({
        where: { hash: result.hash },
      });
      
      expect(dbOp).toBeDefined();
      expect(dbOp?.maxPriorityFeePerGas).toBe(replacementOp.maxPriorityFeePerGas.toString());
    });
  });

  describe('getUserOperation', () => {
    it('should retrieve a user operation by hash', async () => {
      // Arrange
      const addedOp = await mempoolService.addUserOperation(userOp);
      
      // Act
      const retrievedOp = await mempoolService.getUserOperation(addedOp.hash);
      
      // Assert
      expect(retrievedOp).toBeDefined();
      expect(retrievedOp?.hash).toBe(addedOp.hash);
      expect(retrievedOp?.sender).toBe(userOp.sender);
    });

    it('should return null for non-existent user operation', async () => {
      // Act
      const result = await mempoolService.getUserOperation('0x' + '0'.repeat(64));
      
      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getPendingUserOperations', () => {
    it('should return all pending user operations', async () => {
      // Arrange - Add multiple operations
      const op1 = await mempoolService.addUserOperation(userOp);
      
      const op2 = await mempoolService.addUserOperation({
        ...userOp,
        nonce: 1,
      });
      
      // Act
      const pendingOps = await mempoolService.getPendingUserOperations();
      
      // Assert
      expect(pendingOps.length).toBe(2);
      expect(pendingOps.some(op => op.hash === op1.hash)).toBe(true);
      expect(pendingOps.some(op => op.hash === op2.hash)).toBe(true);
    });

    it('should respect the limit parameter', async () => {
      // Arrange - Add multiple operations
      await mempoolService.addUserOperation(userOp);
      await mempoolService.addUserOperation({
        ...userOp,
        nonce: 1,
      });
      
      // Act
      const limitedOps = await mempoolService.getPendingUserOperations(1);
      
      // Assert
      expect(limitedOps.length).toBe(1);
    });
  });

  describe('removeUserOperation', () => {
    it('should remove a user operation from the mempool', async () => {
      // Arrange
      const addedOp = await mempoolService.addUserOperation(userOp);
      
      // Act
      const removed = await mempoolService.removeUserOperation(addedOp.hash);
      
      // Assert
      expect(removed).toBe(true);
      
      // Verify the operation is no longer in Redis
      const redisOp = await mempoolService.getUserOperation(addedOp.hash);
      expect(redisOp).toBeNull();
      
      // Verify the operation is marked as removed in the database
      const dbOp = await AppDataSource.getRepository(UserOperation).findOne({
        where: { hash: addedOp.hash },
      });
      
      expect(dbOp).toBeDefined();
      expect(dbOp?.status).toBe('removed');
    });

    it('should return false for non-existent user operation', async () => {
      // Act
      const result = await mempoolService.removeUserOperation('0x' + '0'.repeat(64));
      
      // Assert
      expect(result).toBe(false);
    });
  });

  describe('clearMempool', () => {
    it('should clear all user operations from the mempool', async () => {
      // Arrange - Add multiple operations
      await mempoolService.addUserOperation(userOp);
      await mempoolService.addUserOperation({
        ...userOp,
        nonce: 1,
      });
      
      // Act
      await mempoolService.clearMempool();
      
      // Assert
      const pendingOps = await mempoolService.getPendingUserOperations();
      expect(pendingOps.length).toBe(0);
      
      // Verify Redis is empty
      const redis = await mempoolService['redis'].getClient();
      const keys = await redis.keys('*');
      expect(keys.length).toBe(0);
    });
  });

  describe('getMempoolSize', () => {
    it('should return the number of user operations in the mempool', async () => {
      // Arrange - Add multiple operations
      await mempoolService.addUserOperation(userOp);
      await mempoolService.addUserOperation({
        ...userOp,
        nonce: 1,
      });
      
      // Act
      const size = await mempoolService.getMempoolSize();
      
      // Assert
      expect(size).toBe(2);
    });
  });
});
