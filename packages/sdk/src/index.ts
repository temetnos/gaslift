import { ethers } from 'ethers';
import { UserOperationStruct } from '@account-abstraction/contracts/v0.6/EntryPoint';
import { hexlify, hexZeroPad, hexConcat, keccak256 } from 'ethers/lib/utils';
import axios, { AxiosInstance } from 'axios';

export interface GasLiftConfig {
  rpcUrl: string;
  entryPointAddress: string;
  paymasterAddress: string;
  chainId: number;
  apiKey: string;
  apiUrl?: string;
}

export interface UserOpGasFields {
  callGasLimit: ethers.BigNumberish;
  verificationGasLimit: ethers.BigNumberish;
  preVerificationGas: ethers.BigNumberish;
  maxFeePerGas: ethers.BigNumberish;
  maxPriorityFeePerGas: ethers.BigNumberish;
}

export interface UserOpOptions extends Partial<UserOpGasFields> {
  paymasterAndData?: string;
  signature?: string;
  nonceKey?: number;
}

export class GasLiftSDK {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly entryPoint: ethers.Contract;
  private readonly paymasterAddress: string;
  private readonly chainId: number;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly httpClient: AxiosInstance;

  constructor(config: GasLiftConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.entryPoint = new ethers.Contract(
      config.entryPointAddress,
      [
        'function getNonce(address,uint192) external view returns (uint256)',
        'function getUserOpHash(UserOperation calldata userOp) external view returns (bytes32)',
      ],
      this.provider
    );
    this.paymasterAddress = config.paymasterAddress;
    this.chainId = config.chainId;
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || 'https://api.gaslift.xyz';
    
    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.apiKey,
      },
    });
  }

  /**
   * Creates a user operation with the given parameters
   */
  async createUserOp(
    sender: string,
    to: string,
    value: ethers.BigNumberish,
    data: string,
    options: UserOpOptions = {}
  ): Promise<UserOperationStruct> {
    const nonce = await this.getNonce(sender, options.nonceKey || 0);
    
    // Default gas values (will be estimated if not provided)
    const gasFields: UserOpGasFields = {
      callGasLimit: options.callGasLimit || 100000,
      verificationGasLimit: options.verificationGasLimit || 100000,
      preVerificationGas: options.preVerificationGas || 50000,
      maxFeePerGas: options.maxFeePerGas || (await this.getGasPrice()),
      maxPriorityFeePerGas: options.maxPriorityFeePerGas || (await this.getMaxPriorityFeePerGas()),
    };

    // Construct paymasterAndData if not provided
    const paymasterAndData = options.paymasterAndData || this.paymasterAddress;

    // Construct the user operation
    const userOp: UserOperationStruct = {
      sender,
      nonce,
      initCode: '0x',
      callData: data,
      callGasLimit: gasFields.callGasLimit,
      verificationGasLimit: gasFields.verificationGasLimit,
      preVerificationGas: gasFields.preVerificationGas,
      maxFeePerGas: gasFields.maxFeePerGas,
      maxPriorityFeePerGas: gasFields.maxPriorityFeePerGas,
      paymasterAndData,
      signature: options.signature || '0x',
    };

    return userOp;
  }

  /**
   * Signs a user operation with the given signer
   */
  async signUserOp(
    userOp: UserOperationStruct,
    signer: ethers.Wallet
  ): Promise<string> {
    const message = await this.entryPoint.getUserOpHash(userOp);
    const signature = await signer.signMessage(ethers.utils.arrayify(message));
    return signature;
  }

  /**
   * Sends a user operation to the bundler
   */
  async sendUserOp(userOp: UserOperationStruct): Promise<string> {
    try {
      const response = await this.httpClient.post('/userop', {
        jsonrpc: '2.0',
        method: 'eth_sendUserOperation',
        params: [userOp, this.entryPoint.address],
        id: Date.now(),
      });

      if (response.data.error) {
        throw new Error(`Bundler error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error: any) {
      throw new Error(`Failed to send user operation: ${error.message}`);
    }
  }

  /**
   * Gets the nonce for a sender
   */
  async getNonce(sender: string, key: number = 0): Promise<ethers.BigNumber> {
    try {
      const nonce = await this.entryPoint.getNonce(sender, key);
      return nonce;
    } catch (error) {
      return ethers.BigNumber.from(0);
    }
  }

  /**
   * Estimates gas for a user operation
   */
  async estimateUserOpGas(userOp: UserOperationStruct): Promise<UserOpGasFields> {
    try {
      const response = await this.httpClient.post('', {
        jsonrpc: '2.0',
        method: 'eth_estimateUserOperationGas',
        params: [userOp, this.entryPoint.address],
        id: Date.now(),
      });

      if (response.data.error) {
        throw new Error(`Estimation error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error: any) {
      throw new Error(`Failed to estimate gas: ${error.message}`);
    }
  }

  /**
   * Gets the current gas price
   */
  private async getGasPrice(): Promise<ethers.BigNumber> {
    const feeData = await this.provider.getFeeData();
    return feeData.maxFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  }

  /**
   * Gets the current max priority fee per gas
   */
  private async getMaxPriorityFeePerGas(): Promise<ethers.BigNumber> {
    const feeData = await this.provider.getFeeData();
    return feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('0.1', 'gwei');
  }

  /**
   * Creates a hash of the user operation
   */
  async getUserOpHash(userOp: UserOperationStruct): Promise<string> {
    const packed = this.packUserOp(userOp);
    const enc = ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256'],
      [keccak256(packed), this.entryPoint.address, this.chainId]
    );
    return keccak256(enc);
  }

  /**
   * Packs a user operation into bytes
   */
  private packUserOp(op: UserOperationStruct): string {
    return ethers.utils.defaultAbiCoder.encode(
      [
        'address',
        'uint256',
        'bytes32',
        'bytes32',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes32',
      ],
      [
        op.sender,
        op.nonce,
        keccak256(op.initCode),
        keccak256(op.callData),
        op.callGasLimit,
        op.verificationGasLimit,
        op.preVerificationGas,
        op.maxFeePerGas,
        op.maxPriorityFeePerGas,
        keccak256(op.paymasterAndData),
      ]
    );
  }
}

export { GasLiftSDK as default };
