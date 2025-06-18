import 'reflect-metadata';
import Fastify from 'fastify';
import { jsonRpcRoutes } from '../../src/api/routes/jsonrpc';
import { mempoolService } from '../../src/services/MempoolService';
import { bundlerService } from '../../src/services/BundlerService';
import { entryPointService } from '../../src/services/EntryPointService';
import { createTestUserOperation, signUserOp, testWallet } from '../test-utils';
import { AppDataSource } from '../../src/db/data-source';
import { UserOperation } from '../../src/db/entities/UserOperation';
import { Bundle } from '../../src/db/entities/Bundle';

// Mock the services
jest.mock('../../src/services/MempoolService');
jest.mock('../../src/services/BundlerService');
jest.mock('../../src/services/EntryPointService');

describe('JSON-RPC API', () => {
  let app: any;
  let userOp: any;

  beforeAll(async () => {
    // Initialize the database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  beforeEach(async () => {
    // Create a test Fastify app
    app = Fastify();
    
    // Register the JSON-RPC routes
    await app.register(jsonRpcRoutes, { prefix: '/rpc' });
    
    // Create a test user operation
    userOp = createTestUserOperation({
      sender: testWallet.address,
      nonce: 0,
    });
    
    // Sign the user operation
    userOp = await signUserOp(userOp);
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Close the Fastify app
    await app.close();
    
    // Clear the database
    await AppDataSource.getRepository(UserOperation).clear();
    await AppDataSource.getRepository(Bundle).clear();
    
    // Clear Redis
    const redis = await mempoolService['redis'].getClient();
    await redis.flushdb();
  });

  describe('eth_chainId', () => {
    it('should return the chain ID', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      };
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          chainId: 31337,
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        jsonrpc: '2.0',
        result: '0x7a69', // 31337 in hex
        id: 1,
      });
    });
  });

  describe('eth_supportedEntryPoints', () => {
    it('should return the supported entry points', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_supportedEntryPoints',
        params: [],
        id: 1,
      };
      
      const entryPoint = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          entryPointAddress: entryPoint,
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        jsonrpc: '2.0',
        result: [entryPoint],
        id: 1,
      });
    });
  });

  describe('eth_estimateUserOperationGas', () => {
    it('should estimate gas for a user operation', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_estimateUserOperationGas',
        params: [userOp],
        id: 1,
      };
      
      const gasEstimate = {
        preVerificationGas: '0x5208',
        verificationGas: '0x5208',
        callGasLimit: '0x5208',
        maxFeePerGas: '0x2540be400',
        maxPriorityFeePerGas: '0x59682f00',
      };
      
      // Mock the entry point service
      (entryPointService.estimateGas as jest.Mock).mockResolvedValue({
        preVerificationGas: gasEstimate.preVerificationGas,
        verificationGasLimit: gasEstimate.verificationGas,
        callGasLimit: gasEstimate.callGasLimit,
        maxFeePerGas: gasEstimate.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
      });
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        jsonrpc: '2.0',
        result: gasEstimate,
        id: 1,
      });
      
      // Verify the entry point service was called with the correct parameters
      expect(entryPointService.estimateGas).toHaveBeenCalledWith(userOp);
    });

    it('should return an error for invalid user operation', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_estimateUserOperationGas',
        params: [{}], // Invalid user operation
        id: 1,
      };
      
      // Mock the entry point service to throw an error
      (entryPointService.estimateGas as jest.Mock).mockRejectedValue(
        new Error('Invalid user operation')
      );
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200); // JSON-RPC always returns 200, even for errors
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32602, // Invalid params
          message: expect.any(String),
        },
        id: 1,
      });
    });
  });

  describe('eth_sendUserOperation', () => {
    it('should add a user operation to the mempool', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_sendUserOperation',
        params: [userOp],
        id: 1,
      };
      
      const userOpHash = '0x' + 'a'.repeat(64);
      
      // Mock the mempool service
      (mempoolService.addUserOperation as jest.Mock).mockResolvedValue({
        ...userOp,
        hash: userOpHash,
      });
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        jsonrpc: '2.0',
        result: userOpHash,
        id: 1,
      });
      
      // Verify the mempool service was called with the correct parameters
      expect(mempoolService.addUserOperation).toHaveBeenCalledWith(userOp);
    });

    it('should return an error for invalid user operation', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_sendUserOperation',
        params: [{}], // Invalid user operation
        id: 1,
      };
      
      // Mock the mempool service to throw an error
      (mempoolService.addUserOperation as jest.Mock).mockRejectedValue(
        new Error('Invalid user operation')
      );
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200); // JSON-RPC always returns 200, even for errors
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32602, // Invalid params
          message: expect.any(String),
        },
        id: 1,
      });
    });
  });

  describe('eth_getUserOperationByHash', () => {
    it('should return a user operation by hash', async () => {
      // Arrange
      const userOpHash = '0x' + 'a'.repeat(64);
      
      const request = {
        jsonrpc: '2.0',
        method: 'eth_getUserOperationByHash',
        params: [userOpHash],
        id: 1,
      };
      
      const userOpWithHash = {
        ...userOp,
        hash: userOpHash,
        status: 'confirmed',
        transactionHash: '0x' + 'b'.repeat(64),
        blockNumber: 1,
      };
      
      // Mock the mempool service
      (mempoolService.getUserOperation as jest.Mock).mockResolvedValue(userOpWithHash);
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        result: {
          userOperation: {
            sender: userOp.sender,
            nonce: userOp.nonce,
            callGasLimit: userOp.callGasLimit,
            verificationGasLimit: userOp.verificationGasLimit,
            preVerificationGas: userOp.preVerificationGas,
            maxFeePerGas: userOp.maxFeePerGas,
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
          },
          entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
          transactionHash: userOpWithHash.transactionHash,
        },
        id: 1,
      });
      
      // Verify the mempool service was called with the correct parameters
      expect(mempoolService.getUserOperation).toHaveBeenCalledWith(userOpHash);
    });

    it('should return null for non-existent user operation', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_getUserOperationByHash',
        params: ['0x' + 'a'.repeat(64)],
        id: 1,
      };
      
      // Mock the mempool service to return null
      (mempoolService.getUserOperation as jest.Mock).mockResolvedValue(null);
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        result: null,
        id: 1,
      });
    });
  });

  describe('eth_bundler_clearMempool', () => {
    it('should clear the mempool', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_bundler_clearMempool',
        params: [],
        id: 1,
      };
      
      // Mock the mempool service
      (mempoolService.clearMempool as jest.Mock).mockResolvedValue(undefined);
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        jsonrpc: '2.0',
        result: { cleared: true },
        id: 1,
      });
      
      // Verify the mempool service was called
      expect(mempoolService.clearMempool).toHaveBeenCalled();
    });
  });

  describe('eth_bundler_getStatus', () => {
    it('should return the bundler status', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'eth_bundler_getStatus',
        params: [],
        id: 1,
      };
      
      const status = {
        isRunning: true,
        mempoolSize: 5,
        lastBundleId: '123',
        lastBundleTime: new Date(),
      };
      
      // Mock the bundler service
      (bundlerService.getStatus as jest.Mock).mockResolvedValue(status);
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        result: {
          isRunning: true,
          mempoolSize: 5,
          lastBundleId: '123',
        },
        id: 1,
      });
      
      // Verify the bundler service was called
      expect(bundlerService.getStatus).toHaveBeenCalled();
    });
  });

  describe('batch requests', () => {
    it('should handle batch requests', async () => {
      // Arrange
      const requests = [
        {
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        },
        {
          jsonrpc: '2.0',
          method: 'eth_supportedEntryPoints',
          params: [],
          id: 2,
        },
      ];
      
      // Mock the config
      (app as any).config = {
        ethereum: {
          chainId: 31337,
          entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
        },
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: requests,
      });
      
      // Assert
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      
      // Check the first response (eth_chainId)
      expect(body[0]).toEqual({
        jsonrpc: '2.0',
        result: '0x7a69', // 31337 in hex
        id: 1,
      });
      
      // Check the second response (eth_supportedEntryPoints)
      expect(body[1]).toEqual({
        jsonrpc: '2.0',
        result: ['0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'],
        id: 2,
      });
    });
  });

  describe('error handling', () => {
    it('should return an error for unsupported method', async () => {
      // Arrange
      const request = {
        jsonrpc: '2.0',
        method: 'unsupported_method',
        params: [],
        id: 1,
      };
      
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: request,
      });
      
      // Assert
      expect(response.statusCode).toBe(200); // JSON-RPC always returns 200, even for errors
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32601, // Method not found
          message: 'Method not found',
        },
        id: 1,
      });
    });

    it('should return an error for invalid JSON-RPC request', async () => {
      // Act - Send invalid JSON
      const response = await app.inject({
        method: 'POST',
        url: '/rpc',
        payload: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      // Assert
      expect(response.statusCode).toBe(400);
    });
  });
});
