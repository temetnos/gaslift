import { Repository, FindManyOptions, In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { UserOperation, UserOperationStatus } from '../entities/UserOperation';
import { BaseRepository } from './BaseRepository';

export class UserOperationRepository extends BaseRepository<UserOperation> {
  constructor() {
    super(AppDataSource.getRepository(UserOperation));
  }

  async findByHash(hash: string): Promise<UserOperation | null> {
    return this.repository.findOne({ where: { hash } });
  }

  async findBySender(sender: string, status?: UserOperationStatus): Promise<UserOperation[]> {
    const where: any = { sender };
    if (status) {
      where.status = status;
    }
    return this.findManyBy(where);
  }

  async findPending(limit = 100): Promise<UserOperation[]> {
    return this.findMany({
      where: { status: 'pending' },
      order: { submittedAt: 'ASC' },
      take: limit,
    });
  }

  async findByBundleId(bundleId: string): Promise<UserOperation[]> {
    return this.findManyBy({ bundleId } as any);
  }

  async updateStatus(
    ids: string[],
    status: UserOperationStatus,
    transactionHash?: string,
    blockNumber?: number
  ): Promise<void> {
    await this.repository.update(ids, {
      status,
      ...(transactionHash && { transactionHash }),
      ...(blockNumber && { blockNumber }),
      ...(status === 'confirmed' && { confirmedAt: new Date() }),
    } as any);
  }

  async markAsSubmitted(ids: string[], transactionHash: string): Promise<void> {
    await this.updateStatus(ids, 'submitted', transactionHash);
  }

  async markAsConfirmed(ids: string[], blockNumber: number): Promise<void> {
    await this.updateStatus(ids, 'confirmed', undefined, blockNumber);
  }

  async markAsFailed(ids: string[], error: string): Promise<void> {
    await this.repository.update(ids, {
      status: 'failed',
      error: error.substring(0, 255),
    } as any);
  }

  async getPendingUserOperationHashes(): Promise<string[]> {
    const operations = await this.findMany({
      where: { status: 'pending' },
      select: ['hash'],
      order: { submittedAt: 'ASC' },
    });
    return operations.map(op => op.hash);
  }

  async getPendingUserOperations(limit = 100): Promise<UserOperation[]> {
    return this.findMany({
      where: { status: 'pending' },
      order: { submittedAt: 'ASC' },
      take: limit,
    });
  }
}
