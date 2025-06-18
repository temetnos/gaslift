import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Config } from '../types';

// Load environment variables from .env file
dotenv.config();

// Helper function to parse environment variables
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return (value || defaultValue) as string;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  return value ? value.toLowerCase() === 'true' : defaultValue;
}

// Initialize Ethereum provider and signer
function initEthereum(rpcUrl: string, privateKey: string) {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  return { provider, signer };
}

// Parse configuration from environment variables
export function loadConfig(): Config {
  const nodeEnv = getEnv('NODE_ENV', 'development') as 'development' | 'production' | 'test';
  const port = getEnvNumber('PORT', 3002);
  const logLevel = getEnv('LOG_LEVEL', 'debug');

  // Database configuration
  const dbHost = getEnv('POSTGRES_HOST', 'localhost');
  const dbPort = getEnvNumber('POSTGRES_PORT', 5432);
  const dbUser = getEnv('POSTGRES_USER', 'postgres');
  const dbPassword = getEnv('POSTGRES_PASSWORD', 'postgres');
  const dbName = getEnv('POSTGRES_DB', 'gaslift_bundler');
  const dbUrl = getEnv(
    'DATABASE_URL',
    `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}?schema=public`
  );

  // Redis configuration
  const redisHost = getEnv('REDIS_HOST', 'localhost');
  const redisPort = getEnvNumber('REDIS_PORT', 6379);
  const redisPassword = getEnv('REDIS_PASSWORD', '');
  const redisUrl = getEnv('REDIS_URL', `redis://${redisHost}:${redisPort}`);

  // Ethereum configuration
  const ethRpcUrl = getEnv('ETH_RPC_URL', 'http://localhost:8545');
  const chainId = getEnvNumber('CHAIN_ID', 84532); // Default to Base Sepolia
  const entryPointAddress = getEnv(
    'ENTRY_POINT_ADDRESS',
    '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
  );
  const bundlerPrivateKey = getEnv(
    'BUNDLER_PRIVATE_KEY',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Default hardhat private key
  );
  
  const { provider, signer } = initEthereum(ethRpcUrl, bundlerPrivateKey);

  // Bundler configuration
  const bundlerBeneficiary = getEnv(
    'BUNDLER_BENEFICIARY',
    ethers.constants.AddressZero
  );
  const minStake = ethers.BigNumber.from(
    getEnv('BUNDLER_MIN_STAKE', '100000000000000000') // 0.1 ETH
  );
  const minUnstakeDelay = getEnvNumber('BUNDLER_MIN_UNSTAKE_DELAY', 86400); // 24 hours
  const minSignerBalance = ethers.BigNumber.from(
    getEnv('BUNDLER_MIN_SIGNER_BALANCE', '50000000000000000') // 0.05 ETH
  );

  // Gas configuration
  const minPriorityFeePerGas = ethers.BigNumber.from(
    getEnv('MIN_PRIORITY_FEE_PER_GAS', '1000000000') // 1 gwei
  );
  const maxPriorityFeePerGas = ethers.BigNumber.from(
    getEnv('MAX_PRIORITY_FEE_PER_GAS', '3000000000') // 3 gwei
  );
  const priorityFeeIncrement = ethers.BigNumber.from(
    getEnv('PRIORITY_FEE_INCREMENT', '100000000') // 0.1 gwei
  );
  const minGasPriceBufferPercent = getEnvNumber('MIN_GAS_PRICE_BUFFER_PERCENT', 10);

  // Security configuration
  const apiKeys = getEnv('API_KEYS', 'test-api-key').split(',').map(s => s.trim());
  const rateLimitWindowMs = getEnvNumber('RATE_LIMIT_WINDOW_MS', 60000);
  const rateLimitMaxRequests = getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100);

  // Monitoring configuration
  const prometheusEnabled = getEnvBoolean('PROMETHEUS_METRICS_ENABLED', true);
  const prometheusPort = getEnvNumber('PROMETHEUS_METRICS_PORT', 9091);

  // Health check configuration
  const healthCheckIntervalMs = getEnvNumber('HEALTH_CHECK_INTERVAL_MS', 30000);
  const healthCheckTimeoutMs = getEnvNumber('HEALTH_CHECK_TIMEOUT_MS', 10000);

  return {
    // Server
    nodeEnv,
    port,
    logLevel,
    
    // Database
    postgres: {
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      url: dbUrl,
    },
    
    // Redis
    redis: {
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      url: redisUrl,
    },
    
    // Ethereum
    ethereum: {
      rpcUrl: ethRpcUrl,
      chainId,
      entryPointAddress,
      bundlerPrivateKey,
      provider,
      signer,
    },
    
    // Bundler
    bundler: {
      beneficiary: bundlerBeneficiary,
      minStake,
      minUnstakeDelay,
      minSignerBalance,
    },
    
    // Gas
    gas: {
      minPriorityFeePerGas,
      maxPriorityFeePerGas,
      priorityFeeIncrement,
      minGasPriceBufferPercent,
    },
    
    // Security
    security: {
      apiKeys,
      rateLimitWindowMs,
      rateLimitMaxRequests,
    },
    
    // Monitoring
    monitoring: {
      prometheusEnabled,
      prometheusPort,
    },
    
    // Health Check
    healthCheck: {
      intervalMs: healthCheckIntervalMs,
      timeoutMs: healthCheckTimeoutMs,
    },
  };
}

// Export a singleton instance of the config
const config = loadConfig();
export default config;
