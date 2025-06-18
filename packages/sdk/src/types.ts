import { BigNumberish } from 'ethers';

export * from '@account-abstraction/contracts/v0.6/EntryPoint';

export interface UserOperationStruct {
  sender: string;
  nonce: BigNumberish;
  initCode: string;
  callData: string;
  callGasLimit: BigNumberish;
  verificationGasLimit: BigNumberish;
  preVerificationGas: BigNumberish;
  maxFeePerGas: BigNumberish;
  maxPriorityFeePerGas: BigNumberish;
  paymasterAndData: string;
  signature: string;
}

export interface UserOperationReceipt {
  userOpHash: string;
  entryPoint: string;
  sender: string;
  nonce: BigNumberish;
  paymaster: string;
  actualGasCost: BigNumberish;
  actualGasUsed: BigNumberish;
  success: boolean;
  reason?: string;
  logs: any[];
  receipt: any;
}

export interface UserOperationEvent {
  userOpHash: string;
  sender: string;
  paymaster: string;
  nonce: BigNumberish;
  success: boolean;
  actualGasCost: BigNumberish;
  actualGasUsed: BigNumberish;
  logs: any[];
}

export interface GasEstimate {
  preVerificationGas: BigNumberish;
  verificationGasLimit: BigNumberish;
  callGasLimit: BigNumberish;
}

export interface GasPrice {
  maxFeePerGas: BigNumberish;
  maxPriorityFeePerGas: BigNumberish;
}

export interface FeeData {
  maxFeePerGas: BigNumberish | null;
  maxPriorityFeePerGas: BigNumberish | null;
  gasPrice: BigNumberish | null;
}

export interface TransactionDetailsForUserOp {
  target: string;
  data: string;
  value?: BigNumberish;
  gasLimit?: BigNumberish;
  maxFeePerGas?: BigNumberish;
  maxPriorityFeePerGas?: BigNumberish;
  nonce?: BigNumberish;
}
