import { ethers } from 'ethers';
import { GasLiftSDK } from '../src';

// Mock ethers provider
jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  return {
    ...originalModule,
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getFeeData: jest.fn().mockResolvedValue({
          maxFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
          maxPriorityFeePerGas: ethers.utils.parseUnits('1', 'gwei'),
          gasPrice: ethers.utils.parseUnits('2', 'gwei'),
        }),
      })),
    },
    Contract: jest.fn().mockImplementation(() => ({
      getNonce: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
      getUserOpHash: jest.fn().mockResolvedValue('0x1234'),
    })),
  };
});

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GasLiftSDK', () => {
  let sdk: GasLiftSDK;
  const mockConfig = {
    rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/test',
    entryPointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    paymasterAddress: '0x1234567890123456789012345678901234567890',
    chainId: 84532, // Base Sepolia
    apiKey: 'test-api-key',
  };

  beforeEach(() => {
    sdk = new GasLiftSDK(mockConfig);
    jest.clearAllMocks();
  });

  describe('createUserOp', () => {
    it('should create a user operation with default values', async () => {
      const userOp = await sdk.createUserOp(
        '0x1234567890123456789012345678901234567890', // sender
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', // to
        '1000000000000000000', // 1 ETH
        '0x1234' // data
      );

      expect(userOp.sender).toBe('0x1234567890123456789012345678901234567890');
      expect(userOp.to).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
      expect(userOp.value).toBe('1000000000000000000');
      expect(userOp.data).toBe('0x1234');
      expect(ethers.BigNumber.from(userOp.callGasLimit).toNumber()).toBeGreaterThan(0);
      expect(ethers.BigNumber.from(userOp.verificationGasLimit).toNumber()).toBeGreaterThan(0);
      expect(ethers.BigNumber.from(userOp.preVerificationGas).toNumber()).toBeGreaterThan(0);
      expect(ethers.BigNumber.from(userOp.maxFeePerGas).toNumber()).toBeGreaterThan(0);
      expect(ethers.BigNumber.from(userOp.maxPriorityFeePerGas).toNumber()).toBeGreaterThan(0);
    });
  });

  describe('signUserOp', () => {
    it('should sign a user operation', async () => {
      const userOp = {
        sender: '0x1234567890123456789012345678901234567890',
        nonce: 0,
        initCode: '0x',
        callData: '0x1234',
        callGasLimit: 100000,
        verificationGasLimit: 100000,
        preVerificationGas: 50000,
        maxFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('1', 'gwei'),
        paymasterAndData: '0x',
        signature: '0x',
      };

      const wallet = ethers.Wallet.createRandom();
      const signature = await sdk.signUserOp(userOp, wallet);
      
      expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe('sendUserOp', () => {
    it('should send a user operation to the bundler', async () => {
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: expect.any(Number),
          result: '0x1234567890abcdef',
        },
      };
      mockedAxios.post.mockResolvedValue(mockResponse);

      const userOp = {
        sender: '0x1234567890123456789012345678901234567890',
        nonce: 0,
        initCode: '0x',
        callData: '0x1234',
        callGasLimit: 100000,
        verificationGasLimit: 100000,
        preVerificationGas: 50000,
        maxFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('1', 'gwei'),
        paymasterAndData: '0x',
        signature: '0x1234',
      };

      const result = await sdk.sendUserOp(userOp);
      expect(result).toBe('0x1234567890abcdef');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.gaslift.xyz/userop',
        expect.objectContaining({
          method: 'eth_sendUserOperation',
          params: [userOp, mockConfig.entryPointAddress],
        }),
        expect.any(Object)
      );
    });
  });
});
