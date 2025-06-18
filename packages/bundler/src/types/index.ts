import { BigNumberish, providers } from 'ethers';
import { UserOperationStruct } from '@account-abstraction/contracts/v0.6/EntryPoint';

export interface Config {
  // Server
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;
  
  // Database
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    url: string;
  };
  
  // Redis
  redis: {
    host: string;
    port: number;
    password: string;
    url: string;
  };
  
  // Ethereum
  ethereum: {
    rpcUrl: string;
    chainId: number;
    entryPointAddress: string;
    bundlerPrivateKey: string;
    provider: providers.JsonRpcProvider;
    signer: providers.JsonRpcSigner;
  };
  
  // Bundler
  bundler: {
    beneficiary: string;
    minStake: BigNumberish;
    minUnstakeDelay: number;
    minSignerBalance: BigNumberish;
  };
  
  // Gas
  gas: {
    minPriorityFeePerGas: BigNumberish;
    maxPriorityFeePerGas: BigNumberish;
    priorityFeeIncrement: BigNumberish;
    minGasPriceBufferPercent: number;
  };
  
  // Security
  security: {
    apiKeys: string[];
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
  };
  
  // Monitoring
  monitoring: {
    prometheusEnabled: boolean;
    prometheusPort: number;
  };
  
  // Health Check
  healthCheck: {
    intervalMs: number;
    timeoutMs: number;
  };
}

export interface UserOperationWithHash extends UserOperationStruct {
  hash: string;
  submittedAt: Date;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  transactionHash?: string;
  blockNumber?: number;
}

export interface GasEstimate {
  preVerificationGas: BigNumberish;
  verificationGasLimit: BigNumberish;
  callGasLimit: BigNumberish;
  maxFeePerGas: BigNumberish;
  maxPriorityFeePerGas: BigNumberish;
}

export interface Bundle {
  userOperations: UserOperationWithHash[];
  transactionHash?: string;
  blockNumber?: number;
  submittedAt: Date;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: {
    database: boolean;
    redis: boolean;
    ethereum: boolean;
    bundlerBalance: boolean;
    entryPointStatus: boolean;
  };
  details?: Record<string, any>;
}

export * from './errors';
