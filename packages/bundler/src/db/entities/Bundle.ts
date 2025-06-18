import { Entity, Column, OneToMany, Index } from 'typeorm';
import { BaseEntity } from './BaseEntity';
import { UserOperation } from './UserOperation';

export type BundleStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

@Entity('bundles')
export class Bundle extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 66, nullable: true })
  transactionHash?: string;

  @Column({ type: 'integer', nullable: true })
  blockNumber?: number;

  @Column({ 
    type: 'enum',
    enum: ['pending', 'submitted', 'confirmed', 'failed'],
    default: 'pending'
  })
  status: BundleStatus;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  submittedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error?: string;

  @OneToMany(() => UserOperation, userOp => userOp.bundle, { cascade: true })
  userOperations: UserOperation[];

  // Helper methods
  toJSON() {
    return {
      id: this.id,
      transactionHash: this.transactionHash,
      blockNumber: this.blockNumber,
      status: this.status,
      submittedAt: this.submittedAt,
      confirmedAt: this.confirmedAt,
      error: this.error,
      userOperationCount: this.userOperations?.length || 0,
      userOperationIds: this.userOperations?.map(op => op.id) || [],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
