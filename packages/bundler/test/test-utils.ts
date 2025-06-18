import { ethers, Wallet } from 'ethers';
import { UserOperationStruct } from '@account-abstraction/contracts/v0.6/EntryPoint';
import { BigNumber } from 'ethers';

// Test account with known private key
const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
export const testWallet = new Wallet(TEST_PRIVATE_KEY);

// Helper to create a test user operation
export function createTestUserOperation(overrides: Partial<UserOperationStruct> = {}): UserOperationStruct {
  const defaults: UserOperationStruct = {
    sender: testWallet.address,
    nonce: 0,
    initCode: '0x',
    callData: '0x',
    callGasLimit: 100000,
    verificationGasLimit: 100000,
    preVerificationGas: 50000,
    maxFeePerGas: ethers.utils.parseUnits('10', 'gwei'),
    maxPriorityFeePerGas: ethers.utils.parseUnits('1.5', 'gwei'),
    paymasterAndData: '0x',
    signature: '0x',
  };

  return { ...defaults, ...overrides };
}

// Helper to sign a user operation
export async function signUserOp(
  userOp: UserOperationStruct,
  privateKey: string = TEST_PRIVATE_KEY
): Promise<UserOperationStruct> {
  const wallet = new Wallet(privateKey);
  const message = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        'address',
        'uint256',
        'bytes32',
        'bytes32',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes32',
      ],
      [
        userOp.sender,
        userOp.nonce,
        ethers.utils.keccak256(userOp.initCode || '0x'),
        ethers.utils.keccak256(userOp.callData || '0x'),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        ethers.utils.keccak256(userOp.paymasterAndData || '0x'),
      ]
    )
  );

  const signature = await wallet.signMessage(ethers.utils.arrayify(message));
  return { ...userOp, signature };
}

// Helper to wait for a specific number of blocks
export async function waitForBlocks(provider: ethers.providers.Provider, blocks: number): Promise<void> {
  const currentBlock = await provider.getBlockNumber();
  const targetBlock = currentBlock + blocks;
  
  return new Promise((resolve) => {
    const checkBlock = async () => {
      const latestBlock = await provider.getBlockNumber();
      if (latestBlock >= targetBlock) {
        resolve();
      } else {
        setTimeout(checkBlock, 1000);
      }
    };
    
    checkBlock();
  });
}

// Helper to mine a specific number of blocks
export async function mineBlocks(provider: ethers.providers.JsonRpcProvider, blocks: number): Promise<void> {
  for (let i = 0; i < blocks; i++) {
    await provider.send('evm_mine', []);
  }
}

// Helper to increase time in the EVM
export async function increaseTime(provider: ethers.providers.JsonRpcProvider, seconds: number): Promise<void> {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

// Helper to get the current timestamp from the latest block
export async function getLatestBlockTimestamp(provider: ethers.providers.Provider): Promise<number> {
  const block = await provider.getBlock('latest');
  return block.timestamp;
}

// Helper to get the current block number
export async function getBlockNumber(provider: ethers.providers.Provider): Promise<number> {
  return provider.getBlockNumber();
}

// Helper to get the balance of an address
export async function getBalance(address: string, provider: ethers.providers.Provider): Promise<BigNumber> {
  return provider.getBalance(address);
}

// Helper to send ETH from the default account
export async function sendETH(
  to: string,
  amount: BigNumber,
  provider: ethers.providers.JsonRpcProvider,
  signer: ethers.Signer
): Promise<ethers.providers.TransactionResponse> {
  const tx = await signer.sendTransaction({
    to,
    value: amount,
  });
  
  return tx.wait();
}

// Helper to generate a random address
export function getRandomAddress(): string {
  return Wallet.createRandom().address;
}

// Helper to generate a random bytes32
export function getRandomBytes32(): string {
  return ethers.utils.hexlify(ethers.utils.randomBytes(32));
}

// Helper to parse Gwei to Wei
export function gweiToWei(gwei: string | number): BigNumber {
  return ethers.utils.parseUnits(gwei.toString(), 'gwei');
}

// Helper to parse Ether to Wei
export function ethToWei(eth: string | number): BigNumber {
  return ethers.utils.parseEther(eth.toString());
}

// Helper to format Wei to Ether
export function weiToEth(wei: BigNumber): string {
  return ethers.utils.formatEther(wei);
}

// Helper to format Wei to Gwei
export function weiToGwei(wei: BigNumber): string {
  return ethers.utils.formatUnits(wei, 'gwei');
}
