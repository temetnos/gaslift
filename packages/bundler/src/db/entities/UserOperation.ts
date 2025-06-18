import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BigNumber } from 'ethers';
import { BaseEntity } from './BaseEntity';
import { Bundle } from './Bundle';

export type UserOperationStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

@Entity('user_operations')
export class UserOperation extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 255 })
  hash: string;

  @Index()
  @Column({ type: 'varchar', length: 42 })
  sender: string;

  @Column({ type: 'bigint' })
  nonce: number;

  @Column({ type: 'text' })
  initCode: string;

  @Column({ type: 'text' })
  callData: string;

  @Column({ type: 'bigint' })
  callGasLimit: string;

  @Column({ type: 'bigint' })
  verificationGasLimit: string;

  @Column({ type: 'bigint' })
  preVerificationGas: string;

  @Column({ type: 'varchar', length: 255 })
  maxFeePerGas: string;

  @Column({ type: 'varchar', length: 255 })
  maxPriorityFeePerGas: string;

  @Column({ type: 'text' })
  paymasterAndData: string;

  @Column({ type: 'text' })
  signature: string;

  @Column({ 
    type: 'enum',
    enum: ['pending', 'submitted', 'confirmed', 'failed'],
    default: 'pending'
  })
  status: UserOperationStatus;

  @Column({ type: 'varchar', length: 66, nullable: true })
  transactionHash?: string;

  @Column({ type: 'integer', nullable: true })
  blockNumber?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  submittedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error?: string;

  @ManyToOne(() => Bundle, bundle => bundle.userOperations, { nullable: true })
  @JoinColumn({ name: 'bundleId' })
  bundle?: Bundle;

  @Column({ type: 'uuid', nullable: true })
  bundleId?: string;

  // Helper methods
  toJSON() {
    return {
      id: this.id,
      hash: this.hash,
      sender: this.sender,
      nonce: this.nonce,
      initCode: this.initCode,
      callData: this.callData,
      callGasLimit: this.callGasLimit,
      verificationGasLimit: this.verificationGasLimit,
      preVerificationGas: this.preVerificationGas,
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas,
      paymasterAndData: this.paymasterAndData,
      signature: this.signature,
      status: this.status,
      transactionHash: this.transactionHash,
      blockNumber: this.blockNumber,
      submittedAt: this.submittedAt,
      confirmedAt: this.confirmedAt,
      error: this.error,
      bundleId: this.bundleId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromRpc(userOp: any): Partial<UserOperation> {
    return {
      hash: userOp.hash,
      sender: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: userOp.callGasLimit.toString(),
      verificationGasLimit: userOp.verificationGasLimit.toString(),
      preVerificationGas: userOp.preVerificationGas.toString(),
      maxFeePerGas: userOp.maxFeePerGas.toString(),
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas.toString(),
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature,
      status: 'pending',
      submittedAt: new Date(),
    };
  }
}
