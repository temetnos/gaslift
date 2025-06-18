import { ethers } from 'ethers';
import { BigNumber, BigNumberish, Contract, providers } from 'ethers';
import { UserOperationStruct } from '@account-abstraction/contracts/v0.6/EntryPoint';
import { logger } from '../utils/logger';
import config from '../config';
import { GasEstimate } from '../types';

const ENTRY_POINT_ABI = [
  'function getSenderAddress(bytes calldata initCode) external',
  'function simulateValidation(UserOperation calldata userOp) external returns (uint256 preOpGas, uint256 prefund)',
  'function handleOps(UserOperation[] calldata ops, address payable beneficiary) external',
  'function getDepositInfo(address account) external view returns (uint112 totalDeposit, uint256 staked, uint112 unstakeDelaySec, uint256 withdrawTime)',
  'function balanceOf(address account) external view returns (uint256)',
  'function addStake(uint32 unstakeDelaySec) external payable',
  'function unlockStake() external',
  'function withdrawStake(address payable withdrawAddress) external',
  'function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external',
];

export class EntryPointService {
  private static instance: EntryPointService;
  private contract: ethers.Contract;
  private signer: ethers.Signer;
  private provider: ethers.providers.Provider;
  private logger = logger.child({ context: 'EntryPointService' });

  private constructor() {
    this.provider = config.ethereum.provider;
    this.signer = config.ethereum.signer;
    this.contract = new ethers.Contract(
      config.ethereum.entryPointAddress,
      ENTRY_POINT_ABI,
      this.signer
    );
  }

  public static getInstance(): EntryPointService {
    if (!EntryPointService.instance) {
      EntryPointService.instance = new EntryPointService();
    }
    return EntryPointService.instance;
  }

  public async getSenderAddress(initCode: string): Promise<string> {
    try {
      // Create a provider that will revert on failed calls
      const provider = new ethers.providers.Web3Provider(
        new Proxy({}, {
          get: () => () => Promise.reject(new Error('getSenderAddress reverted')),
        })
      );
      
      // Call getSenderAddress which will revert with the actual sender address
      await this.contract.connect(provider).getSenderAddress(initCode);
      
      // This line should not be reached as the call should revert
      throw new Error('getSenderAddress did not revert as expected');
    } catch (error: any) {
      // Parse the revert error to extract the sender address
      const revertData = error.error?.data || error.data;
      if (revertData) {
        const sender = '0x' + revertData.slice(-40);
        if (ethers.utils.isAddress(sender)) {
          return ethers.utils.getAddress(sender);
        }
      }
      
      this.logger.error('Failed to get sender address:', error);
      throw new Error(`Failed to get sender address: ${error.message}`);
    }
  }

  public async simulateValidation(userOp: UserOperationStruct): Promise<{
    preOpGas: BigNumber;
    prefund: BigNumber;
    deadline: number;
  }> {
    try {
      // Create a provider that will revert on failed calls
      const provider = new ethers.providers.Web3Provider(
        new Proxy({}, {
          get: () => () => Promise.reject(new Error('simulateValidation reverted')),
        })
      );
      
      // Call simulateValidation which will revert with the validation result
      await this.contract.connect(provider).simulateValidation(userOp);
      
      // This line should not be reached as the call should revert
      throw new Error('simulateValidation did not revert as expected');
    } catch (error: any) {
      // Parse the revert error to extract the validation result
      const revertData = error.error?.data || error.data;
      if (revertData) {
        try {
          // The revert data contains the validation result as a struct
          // {uint256 preOpGas, uint256 prefund, uint256 validAfter, uint256 validUntil, bytes signatureFailed}
          const decoded = ethers.utils.defaultAbiCoder.decode(
            ['uint256', 'uint256', 'uint256', 'uint256', 'bytes'],
            revertData
          );
          
          return {
            preOpGas: decoded[0],
            prefund: decoded[1],
            deadline: decoded[3].toNumber(),
          };
        } catch (decodeError) {
          this.logger.error('Failed to decode validation result:', decodeError);
          throw new Error(`Failed to decode validation result: ${decodeError}`);
        }
      }
      
      this.logger.error('Failed to simulate validation:', error);
      throw new Error(`Failed to simulate validation: ${error.message}`);
    }
  }

  public async handleOps(
    ops: UserOperationStruct[],
    beneficiary: string
  ): Promise<ethers.providers.TransactionResponse> {
    try {
      const tx = await this.contract.handleOps(ops, beneficiary, {
        gasLimit: this.calculateGasLimit(ops),
      });
      
      this.logger.info(
        { txHash: tx.hash, opsCount: ops.length },
        'Submitted handleOps transaction'
      );
      
      return tx;
    } catch (error) {
      this.logger.error('Failed to handle ops:', error);
      throw new Error(`Failed to handle ops: ${error.message}`);
    }
  }

  public async getDepositInfo(account: string): Promise<{
    totalDeposit: BigNumber;
    staked: boolean;
    unstakeDelaySec: number;
    withdrawTime: number;
  }> {
    try {
      const [totalDeposit, staked, unstakeDelaySec, withdrawTime] = 
        await this.contract.getDepositInfo(account);
      
      return {
        totalDeposit,
        staked: staked.gt(0),
        unstakeDelaySec: unstakeDelaySec.toNumber(),
        withdrawTime: withdrawTime.toNumber(),
      };
    } catch (error) {
      this.logger.error('Failed to get deposit info:', error);
      throw new Error(`Failed to get deposit info: ${error.message}`);
    }
  }

  public async getBalance(account: string): Promise<BigNumber> {
    try {
      return await this.contract.balanceOf(account);
    } catch (error) {
      this.logger.error('Failed to get balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  public async addStake(unstakeDelaySec: number): Promise<ethers.providers.TransactionResponse> {
    try {
      const stakeAmount = await this.calculateRequiredStake();
      
      const tx = await this.contract.addStake(unstakeDelaySec, {
        value: stakeAmount,
      });
      
      this.logger.info(
        { txHash: tx.hash, unstakeDelaySec, stakeAmount: stakeAmount.toString() },
        'Added stake to EntryPoint'
      );
      
      return tx;
    } catch (error) {
      this.logger.error('Failed to add stake:', error);
      throw new Error(`Failed to add stake: ${error.message}`);
    }
  }

  public async unlockStake(): Promise<ethers.providers.TransactionResponse> {
    try {
      const tx = await this.contract.unlockStake();
      
      this.logger.info(
        { txHash: tx.hash },
        'Unlocked stake in EntryPoint'
      );
      
      return tx;
    } catch (error) {
      this.logger.error('Failed to unlock stake:', error);
      throw new Error(`Failed to unlock stake: ${error.message}`);
    }
  }

  public async withdrawStake(
    withdrawAddress: string
  ): Promise<ethers.providers.TransactionResponse> {
    try {
      const tx = await this.contract.withdrawStake(withdrawAddress);
      
      this.logger.info(
        { txHash: tx.hash, withdrawAddress },
        'Withdrew stake from EntryPoint'
      );
      
      return tx;
    } catch (error) {
      this.logger.error('Failed to withdraw stake:', error);
      throw new Error(`Failed to withdraw stake: ${error.message}`);
    }
  }

  public async withdrawTo(
    withdrawAddress: string,
    withdrawAmount: BigNumberish
  ): Promise<ethers.providers.TransactionResponse> {
    try {
      const tx = await this.contract.withdrawTo(withdrawAddress, withdrawAmount);
      
      this.logger.info(
        { 
          txHash: tx.hash, 
          withdrawAddress, 
          withdrawAmount: withdrawAmount.toString() 
        },
        'Withdrew from EntryPoint'
      );
      
      return tx;
    } catch (error) {
      this.logger.error('Failed to withdraw from EntryPoint:', error);
      throw new Error(`Failed to withdraw from EntryPoint: ${error.message}`);
    }
  }

  public async estimateGas(userOp: UserOperationStruct): Promise<GasEstimate> {
    try {
      const { preOpGas } = await this.simulateValidation(userOp);
      
      // Calculate gas limits with some buffer
      const verificationGasLimit = BigNumber.from(userOp.verificationGasLimit || '100000')
        .mul(3)
        .div(2);
      
      const callGasLimit = BigNumber.from(userOp.callGasLimit || '100000')
        .mul(11)
        .div(10);
      
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      
      if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
        throw new Error('Failed to get gas price data');
      }
      
      // Add buffer to gas prices
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
        .mul(110)
        .div(100);
      
      const maxFeePerGas = feeData.maxFeePerGas
        .mul(110)
        .div(100);
      
      return {
        preVerificationGas: preOpGas,
        verificationGasLimit,
        callGasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
    } catch (error) {
      this.logger.error('Failed to estimate gas:', error);
      throw new Error(`Failed to estimate gas: ${error.message}`);
    }
  }

  private calculateGasLimit(ops: UserOperationStruct[]): BigNumber {
    // Base gas limit per operation
    const BASE_GAS_PER_OP = 100000;
    
    // Additional gas for each byte of calldata
    const GAS_PER_BYTE = 16;
    
    // Calculate total calldata size
    const totalCalldataSize = ops.reduce((total, op) => {
      return total + this.estimateCalldataSize(op);
    }, 0);
    
    // Calculate total gas limit with some buffer
    return BigNumber.from(ops.length * BASE_GAS_PER_OP)
      .add(totalCalldataSize * GAS_PER_BYTE)
      .mul(12)
      .div(10); // 20% buffer
  }

  private estimateCalldataSize(op: UserOperationStruct): number {
    // This is a rough estimate of the calldata size
    // In a real implementation, you would want to calculate this more precisely
    return (
      (op.sender?.length || 0) +
      (op.nonce?.toString().length || 0) +
      (op.initCode?.length || 0) +
      (op.callData?.length || 0) +
      (op.callGasLimit?.toString().length || 0) +
      (op.verificationGasLimit?.toString().length || 0) +
      (op.preVerificationGas?.toString().length || 0) +
      (op.maxFeePerGas?.toString().length || 0) +
      (op.maxPriorityFeePerGas?.toString().length || 0) +
      (op.paymasterAndData?.length || 0) +
      (op.signature?.length || 0)
    ) / 2; // Divide by 2 because hex encoding
  }

  private async calculateRequiredStake(): Promise<BigNumber> {
    // Get current deposit info
    const { totalDeposit, staked } = await this.getDepositInfo(
      await this.signer.getAddress()
    );
    
    // If already staked, return 0
    if (staked) {
      return BigNumber.from(0);
    }
    
    // Calculate required stake (1 ETH as a safe default)
    const minStake = ethers.utils.parseEther('1');
    
    // If current deposit is less than min stake, return the difference
    if (totalDeposit.lt(minStake)) {
      return minStake.sub(totalDeposit);
    }
    
    return BigNumber.from(0);
  }
}

// Export a singleton instance
export const entryPointService = EntryPointService.getInstance();
