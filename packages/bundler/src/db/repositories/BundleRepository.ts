import { Repository, FindManyOptions } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Bundle, BundleStatus } from '../entities/Bundle';
import { BaseRepository } from './BaseRepository';

export class BundleRepository extends BaseRepository<Bundle> {
  constructor() {
    super(AppDataSource.getRepository(Bundle));
  }

  async findByTransactionHash(transactionHash: string): Promise<Bundle | null> {
    return this.findOneBy({ transactionHash } as any);
  }

  async findPending(limit = 10): Promise<Bundle[]> {
    return this.findMany({
      where: { status: 'pending' },
      order: { submittedAt: 'ASC' },
      take: limit,
      relations: ['userOperations'],
    });
  }

  async createBundle(userOperationIds: string[]): Promise<Bundle> {
    const userOperationRepository = AppDataSource.getRepository('UserOperation');
    const userOperations = await userOperationRepository.find({
      where: { id: userOperationIds },
    });

    const bundle = this.repository.create({
      status: 'pending',
      submittedAt: new Date(),
      userOperations,
    });

    return this.repository.save(bundle);
  }

  async updateStatus(
    id: string,
    status: BundleStatus,
    transactionHash?: string,
    blockNumber?: number,
    error?: string
  ): Promise<Bundle | null> {
    const updateData: any = { status };
    
    if (transactionHash) {
      updateData.transactionHash = transactionHash;
    }
    
    if (blockNumber) {
      updateData.blockNumber = blockNumber;
    }
    
    if (status === 'confirmed') {
      updateData.confirmedAt = new Date();
    }
    
    if (error) {
      updateData.error = error;
    }

    await this.repository.update(id, updateData);
    return this.findOne(id);
  }

  async markAsSubmitted(id: string, transactionHash: string): Promise<Bundle | null> {
    return this.updateStatus(id, 'submitted', transactionHash);
  }

  async markAsConfirmed(id: string, blockNumber: number): Promise<Bundle | null> {
    return this.updateStatus(id, 'confirmed', undefined, blockNumber);
  }

  async markAsFailed(id: string, error: string): Promise<Bundle | null> {
    return this.updateStatus(id, 'failed', undefined, undefined, error);
  }

  async getOldestPendingBundle(): Promise<Bundle | null> {
    const bundles = await this.findMany({
      where: { status: 'pending' },
      order: { submittedAt: 'ASC' },
      take: 1,
      relations: ['userOperations'],
    });
    
    return bundles.length > 0 ? bundles[0] : null;
  }
}
