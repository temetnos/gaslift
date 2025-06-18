import 'reflect-metadata';
import { ethers, Wallet } from 'ethers';
import { bundlerService } from '../../src/services/BundlerService';
import { mempoolService } from '../../src/services/MempoolService';
import { entryPointService } from '../../src/services/EntryPointService';
import { createTestUserOperation, signUserOp, testWallet } from '../test-utils';
import { AppDataSource } from '../../src/db/data-source';
import { UserOperation } from '../../src/db/entities/UserOperation';
import { Bundle } from '../../src/db/entities/Bundle';

// Mock the EntryPointService
jest.mock('../../src/services/EntryPointService', () => {
  return {
    entryPointService: {
      simulateValidation: jest.fn().mockResolvedValue({}),
      simulateHandleOp: jest.fn().mockResolvedValue({}),
      handleOps: jest.fn().mockResolvedValue({
        hash: '0x' + '0'.repeat(64),
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x' + '0'.repeat(64),
        }),
      }),
      estimateGas: jest.fn().mockResolvedValue({
        preVerificationGas: 50000,
        verificationGasLimit: 100000,
        callGasLimit: 100000,
        maxFeePerGas: ethers.utils.parseUnits('10', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('1.5', 'gwei'),
      }),
    },
  };
});

describe('BundlerService', () => {
  let userOp: any;
  let mockProvider: any;
  let mockSigner: any;

  beforeAll(async () => {
    // Initialize the database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Mock provider and signer
    mockProvider = {
      getBlockNumber: jest.fn().mockResolvedValue(1),
      getFeeData: jest.fn().mockResolvedValue({
        maxFeePerGas: ethers.utils.parseUnits('10', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('1.5', 'gwei'),
      }),
      getTransactionReceipt: jest.fn().mockResolvedValue({
        status: 1,
        transactionHash: '0x' + '0'.repeat(64),
        blockNumber: 1,
      }),
    };

    mockSigner = {
      getAddress: jest.fn().mockResolvedValue('0x' + '1'.repeat(40)),
      getBalance: jest.fn().mockResolvedValue(ethers.utils.parseEther('1')),
      sendTransaction: jest.fn().mockResolvedValue({
        hash: '0x' + '0'.repeat(64),
        wait: jest.fn().mockResolvedValue({
          status: 1,
          transactionHash: '0x' + '0'.repeat(64),
        }),
      }),
    };

    // Inject mock provider and signer
    (bundlerService as any).provider = mockProvider;
    (bundlerService as any).signer = mockSigner;
  });

  beforeEach(async () => {
    // Create a test user operation
    userOp = createTestUserOperation({
      sender: testWallet.address,
      nonce: 0,
    });
    
    // Sign the user operation
    userOp = await signUserOp(userOp);
    
    // Clear mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clear the database between tests
    await AppDataSource.getRepository(UserOperation).clear();
    await AppDataSource.getRepository(Bundle).clear();
    
    // Clear Redis
    const redis = await mempoolService['redis'].getClient();
    await redis.flushdb();
  });

  describe('start', () => {
    it('should start the bundler service', async () => {
      // Act
      await bundlerService.start();
      
      // Assert
      expect(bundlerService.isRunning()).toBe(true);
      
      // Cleanup
      await bundlerService.stop();
    });

    it('should not start if already running', async () => {
      // Arrange
      await bundlerService.start();
      
      // Act
      await bundlerService.start(); // Should not throw
      
      // Cleanup
      await bundlerService.stop();
    });
  });

  describe('stop', () => {
    it('should stop the bundler service', async () => {
      // Arrange
      await bundlerService.start();
      
      // Act
      const result = await bundlerService.stop();
      
      // Assert
      expect(result).toBe(true);
      expect(bundlerService.isRunning()).toBe(false);
    });

    it('should not throw if already stopped', async () => {
      // Act & Assert
      await expect(bundlerService.stop()).resolves.not.toThrow();
    });
  });

  describe('bundleUserOperations', () => {
    it('should bundle pending user operations', async () => {
      // Arrange
      await mempoolService.addUserOperation(userOp);
      
      // Act
      const bundle = await bundlerService.bundleUserOperations();
      
      // Assert
      expect(bundle).toBeDefined();
      expect(bundle?.userOperations).toHaveLength(1);
      expect(bundle?.status).toBe('pending');
      
      // Verify the bundle was saved to the database
      const dbBundle = await AppDataSource.getRepository(Bundle).findOne({
        where: { id: bundle?.id },
        relations: ['userOperations'],
      });
      
      expect(dbBundle).toBeDefined();
      expect(dbBundle?.userOperations).toHaveLength(1);
      expect(dbBundle?.userOperations[0].hash).toBeDefined();
    });

    it('should not create a bundle if no user operations are pending', async () => {
      // Act
      const bundle = await bundlerService.bundleUserOperations();
      
      // Assert
      expect(bundle).toBeNull();
    });

    it('should respect the max operations per bundle setting', async () => {
      // Arrange - Add more operations than the max per bundle
      const maxOps = 5; // Default max operations per bundle
      
      for (let i = 0; i < maxOps + 2; i++) {
        const op = createTestUserOperation({
          sender: Wallet.createRandom().address,
          nonce: i,
        });
        await mempoolService.addUserOperation(await signUserOp(op));
      }
      
      // Act
      const bundle = await bundlerService.bundleUserOperations();
      
      // Assert
      expect(bundle).toBeDefined();
      expect(bundle?.userOperations).toHaveLength(maxOps);
    });
  });

  describe('submitBundle', () => {
    it('should submit a bundle to the blockchain', async () => {
      // Arrange - Add a user operation and create a bundle
      await mempoolService.addUserOperation(userOp);
      const bundle = await bundlerService.bundleUserOperations();
      
      if (!bundle) {
        throw new Error('Failed to create bundle');
      }
      
      // Act
      const tx = await bundlerService.submitBundle(bundle);
      
      // Assert
      expect(tx).toBeDefined();
      expect(tx.hash).toBeDefined();
      
      // Verify the bundle was updated in the database
      const updatedBundle = await AppDataSource.getRepository(Bundle).findOne({
        where: { id: bundle.id },
      });
      
      expect(updatedBundle).toBeDefined();
      expect(updatedBundle?.status).toBe('submitted');
      expect(updatedBundle?.transactionHash).toBe(tx.hash);
      
      // Verify the user operations were updated
      const userOps = await AppDataSource.getRepository(UserOperation).find({
        where: { bundleId: bundle.id },
      });
      
      expect(userOps).toHaveLength(1);
      expect(userOps[0].status).toBe('submitted');
      expect(userOps[0].bundleId).toBe(bundle.id);
    });

    it('should handle submission failures', async () => {
      // Arrange - Mock a submission failure
      (entryPointService.handleOps as jest.Mock).mockRejectedValueOnce(new Error('Failed to submit bundle'));
      
      // Add a user operation and create a bundle
      await mempoolService.addUserOperation(userOp);
      const bundle = await bundlerService.bundleUserOperations();
      
      if (!bundle) {
        throw new Error('Failed to create bundle');
      }
      
      // Act & Assert
      await expect(bundlerService.submitBundle(bundle)).rejects.toThrow('Failed to submit bundle');
      
      // Verify the bundle was marked as failed
      const updatedBundle = await AppDataSource.getRepository(Bundle).findOne({
        where: { id: bundle.id },
      });
      
      expect(updatedBundle?.status).toBe('failed');
      expect(updatedBundle?.error).toBeDefined();
    });
  });

  describe('processBundles', () => {
    it('should process pending bundles', async () => {
      // Arrange - Create a pending bundle
      await mempoolService.addUserOperation(userOp);
      const bundle = await bundlerService.bundleUserOperations();
      
      if (!bundle) {
        throw new Error('Failed to create bundle');
      }
      
      // Act
      await bundlerService.processBundles();
      
      // Assert - The bundle should now be submitted
      const updatedBundle = await AppDataSource.getRepository(Bundle).findOne({
        where: { id: bundle.id },
      });
      
      expect(updatedBundle?.status).toBe('submitted');
    });

    it('should handle processing failures', async () => {
      // Arrange - Mock a submission failure
      (entryPointService.handleOps as jest.Mock).mockRejectedValueOnce(new Error('Failed to submit bundle'));
      
      // Create a pending bundle
      await mempoolService.addUserOperation(userOp);
      await bundlerService.bundleUserOperations();
      
      // Act
      await bundlerService.processBundles();
      
      // Assert - The bundle should be marked as failed
      const bundles = await AppDataSource.getRepository(Bundle).find();
      expect(bundles[0].status).toBe('failed');
      expect(bundles[0].error).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return the current status of the bundler', async () => {
      // Act
      const status = await bundlerService.getStatus();
      
      // Assert
      expect(status).toBeDefined();
      expect(status.isRunning).toBe(false);
      expect(status.mempoolSize).toBe(0);
    });

    it('should include information about the last bundle', async () => {
      // Arrange - Create and submit a bundle
      await mempoolService.addUserOperation(userOp);
      await bundlerService.start();
      await bundlerService.processBundles();
      
      // Act
      const status = await bundlerService.getStatus();
      
      // Assert
      expect(status.lastBundleId).toBeDefined();
      expect(status.lastBundleTime).toBeInstanceOf(Date);
      
      // Cleanup
      await bundlerService.stop();
    });
  });
});
