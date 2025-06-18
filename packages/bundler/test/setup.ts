import 'reflect-metadata';
import { config } from '../src/config';
import { logger } from '../src/utils/logger';
import { AppDataSource } from '../src/db/data-source';
import { redisService } from '../src/services/RedisService';

// Configure test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random port for tests
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/gaslift_bundler_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.ETH_RPC_URL = 'http://localhost:8545';
process.env.CHAIN_ID = '31337';
process.env.ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
process.env.BUNDLER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.BUNDLER_BENEFICIARY = '0x0000000000000000000000000000000000000000';

// Global test setup
async function globalSetup() {
  try {
    // Initialize Redis
    await redisService.connect();
    
    // Initialize database
    await AppDataSource.initialize();
    
    // Run migrations
    await AppDataSource.synchronize(true);
    
    logger.info('Test environment initialized');
  } catch (error) {
    logger.error('Failed to initialize test environment:', error);
    process.exit(1);
  }
}

// Global test teardown
async function globalTeardown() {
  try {
    // Drop database
    await AppDataSource.dropDatabase();
    
    // Close database connection
    await AppDataSource.destroy();
    
    // Clear Redis
    await redisService.getClient().flushdb();
    
    // Close Redis connection
    await redisService.disconnect();
    
    logger.info('Test environment cleaned up');
  } catch (error) {
    logger.error('Failed to clean up test environment:', error);
    process.exit(1);
  }
}

export { globalSetup, globalTeardown };

// Run setup before all tests
beforeAll(async () => {
  await globalSetup();
});

// Run teardown after all tests
afterAll(async () => {
  await globalTeardown();
});

// Reset database state between tests
beforeEach(async () => {
  // Clear all tables
  const entities = AppDataSource.entityMetadatas;
  
  for (const entity of entities) {
    const repository = AppDataSource.getRepository(entity.name);
    await repository.clear();
  }
  
  // Clear Redis
  await redisService.getClient().flushdb();
});
