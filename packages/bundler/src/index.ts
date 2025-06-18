#!/usr/bin/env node

import 'reflect-metadata';
import { config } from './config';
import { logger } from './utils/logger';
import { apiServer } from './api/server';
import { AppDataSource } from './db/data-source';

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Handle process signals
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
signals.forEach((signal) => {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down...`);
    process.exit(0);
  });
});

// Main function
async function main() {
  try {
    logger.info(`Starting GasLift Bundler (${config.nodeEnv} environment)`);
    
    // Validate configuration
    validateConfig();
    
    // Start the API server
    await apiServer.start();
    
  } catch (error) {
    logger.fatal('Failed to start GasLift Bundler:', error);
    process.exit(1);
  }
}

// Validate required configuration
function validateConfig(): void {
  const requiredVars = [
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'REDIS_URL',
    'ETH_RPC_URL',
    'CHAIN_ID',
    'ENTRY_POINT_ADDRESS',
    'BUNDLER_PRIVATE_KEY',
  ];
  
  const missingVars = requiredVars.filter(
    (key) => !process.env[key] && !(key in config)
  );
  
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    );
  }
}

// Run the application
if (require.main === module) {
  main().catch((error) => {
    logger.fatal('Unhandled error in main:', error);
    process.exit(1);
  });
}

// Export for testing
export { AppDataSource };
