import { DataSource } from 'typeorm';
import { UserOperation } from './entities/UserOperation';
import { Bundle } from './entities/Bundle';
import config from '../config';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.postgres.url,
  synchronize: config.nodeEnv !== 'production',
  logging: config.nodeEnv === 'development',
  entities: [UserOperation, Bundle],
  migrations: [],
  subscribers: [],
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}
