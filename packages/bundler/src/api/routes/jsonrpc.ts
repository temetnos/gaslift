import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { bundlerService } from '../../services/BundlerService';
import { mempoolService } from '../../services/MempoolService';
import { entryPointService } from '../../services/EntryPointService';
import { logger } from '../../utils/logger';
import { ERROR_CODES, RpcError } from '../../types/errors';

// JSON-RPC request schema
const JsonRpcRequestSchema = Type.Object({
  jsonrpc: Type.Literal('2.0'),
  method: Type.String(),
  params: Type.Array(Type.Any()),
  id: Type.Union([Type.String(), Type.Number(), Type.Null()]),
});

type JsonRpcRequest = Static<typeof JsonRpcRequestSchema>;

// JSON-RPC response schema
interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0';
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

// Supported JSON-RPC methods
const SUPPORTED_METHODS = new Set([
  'eth_chainId',
  'eth_supportedEntryPoints',
  'eth_estimateUserOperationGas',
  'eth_sendUserOperation',
  'eth_getUserOperationByHash',
  'eth_getUserOperationReceipt',
  'eth_bundler_clearMempool',
  'eth_bundler_getStatus',
]);

export const jsonRpcRoutes: FastifyPluginAsync = async (fastify) => {
  // JSON-RPC endpoint
  fastify.post<{ Body: JsonRpcRequest | JsonRpcRequest[] }>(
    '/',
    {
      schema: {
        body: Type.Union([
          JsonRpcRequestSchema,
          Type.Array(JsonRpcRequestSchema),
        ]),
        response: {
          200: Type.Union([
            Type.Object({
              jsonrpc: Type.Literal('2.0'),
              result: Type.Any(),
              id: Type.Union([Type.String(), Type.Number(), Type.Null()]),
            }),
            Type.Array(
              Type.Object({
                jsonrpc: Type.Literal('2.0'),
                result: Type.Optional(Type.Any()),
                error: Type.Optional(
                  Type.Object({
                    code: Type.Number(),
                    message: Type.String(),
                    data: Type.Optional(Type.Any()),
                  })
                ),
                id: Type.Union([Type.String(), Type.Number(), Type.Null()]),
              })
            ),
          ]),
        },
      },
    },
    async (request, reply) => {
      try {
        // Handle batch requests
        if (Array.isArray(request.body)) {
          if (request.body.length === 0) {
            throw new RpcError('Empty batch request', ERROR_CODES.INVALID_REQUEST);
          }

          // Process each request in parallel
          const responses = await Promise.all(
            request.body.map((req) => handleSingleRequest(req, request))
          );
          return reply.status(200).send(responses);
        }

        // Single request
        const response = await handleSingleRequest(request.body, request);
        return reply.status(200).send(response);
      } catch (error) {
        logger.error('Error processing JSON-RPC request:', error);
        
        if (error instanceof RpcError) {
          return reply.status(400).send({
            jsonrpc: '2.0',
            error: {
              code: error.code,
              message: error.message,
              data: error.data,
            },
            id: null,
          });
        }

        // Handle unexpected errors
        return reply.status(500).send({
          jsonrpc: '2.0',
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Internal server error',
            data: process.env.NODE_ENV === 'development' ? error.message : undefined,
          },
          id: null,
        });
      }
    }
  );
};

async function handleSingleRequest(
  request: JsonRpcRequest,
  rawRequest: FastifyRequest
): Promise<JsonRpcResponse> {
  const { method, params = [], id } = request;
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
  };

  try {
    // Validate request
    if (request.jsonrpc !== '2.0') {
      throw new RpcError('Invalid JSON-RPC version', ERROR_CODES.INVALID_REQUEST);
    }

    if (!SUPPORTED_METHODS.has(method)) {
      throw new RpcError('Method not found', ERROR_CODES.METHOD_NOT_FOUND);
    }

    // Log the request
    logger.info(`Processing JSON-RPC request: ${method}`, {
      method,
      params,
      ip: rawRequest.ip,
    });

    // Handle the request
    let result: any;
    switch (method) {
      case 'eth_chainId':
        result = await handleChainId();
        break;
      case 'eth_supportedEntryPoints':
        result = await handleSupportedEntryPoints();
        break;
      case 'eth_estimateUserOperationGas':
        result = await handleEstimateUserOperationGas(params);
        break;
      case 'eth_sendUserOperation':
        result = await handleSendUserOperation(params);
        break;
      case 'eth_getUserOperationByHash':
        result = await handleGetUserOperationByHash(params);
        break;
      case 'eth_getUserOperationReceipt':
        result = await handleGetUserOperationReceipt(params);
        break;
      case 'eth_bundler_clearMempool':
        result = await handleClearMempool();
        break;
      case 'eth_bundler_getStatus':
        result = await handleGetStatus();
        break;
      default:
        throw new RpcError('Method not implemented', ERROR_CODES.METHOD_NOT_FOUND);
    }

    response.result = result;
    return response;
  } catch (error) {
    logger.error(`Error in JSON-RPC method ${method}:`, error);
    
    if (error instanceof RpcError) {
      response.error = {
        code: error.code,
        message: error.message,
        data: error.data,
      };
    } else {
      response.error = {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
        data: process.env.NODE_ENV === 'development' ? error.message : undefined,
      };
    }
    
    return response;
  }
}

// Handler implementations
async function handleChainId(): Promise<string> {
  return `0x${config.ethereum.chainId.toString(16)}`;
}

async function handleSupportedEntryPoints(): Promise<string[]> {
  return [config.ethereum.entryPointAddress];
}

async function handleEstimateUserOperationGas(params: any[]): Promise<{
  preVerificationGas: string;
  verificationGas: string;
  callGasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}> {
  if (params.length < 1) {
    throw new RpcError('Missing user operation', ERROR_CODES.INVALID_PARAMS);
  }

  const userOp = params[0];
  const entryPoint = params[1] || config.ethereum.entryPointAddress;

  if (entryPoint.toLowerCase() !== config.ethereum.entryPointAddress.toLowerCase()) {
    throw new RpcError(
      `Unsupported entry point: ${entryPoint}`,
      ERROR_CODES.INVALID_PARAMS
    );
  }

  try {
    const gasEstimate = await entryPointService.estimateGas(userOp);
    
    return {
      preVerificationGas: gasEstimate.preVerificationGas.toString(),
      verificationGas: gasEstimate.verificationGasLimit.toString(),
      callGasLimit: gasEstimate.callGasLimit.toString(),
      maxFeePerGas: gasEstimate.maxFeePerGas.toString(),
      maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas.toString(),
    };
  } catch (error) {
    logger.error('Failed to estimate user operation gas:', error);
    throw new RpcError(
      `Failed to estimate gas: ${error.message}`,
      ERROR_CODES.INVALID_OP,
      { cause: error }
    );
  }
}

async function handleSendUserOperation(params: any[]): Promise<string> {
  if (params.length < 1) {
    throw new RpcError('Missing user operation', ERROR_CODES.INVALID_PARAMS);
  }

  const userOp = params[0];
  const entryPoint = params[1] || config.ethereum.entryPointAddress;

  if (entryPoint.toLowerCase() !== config.ethereum.entryPointAddress.toLowerCase()) {
    throw new RpcError(
      `Unsupported entry point: ${entryPoint}`,
      ERROR_CODES.INVALID_PARAMS
    );
  }

  try {
    // Add user operation to mempool
    const userOpWithHash = await mempoolService.addUserOperation(userOp);
    return userOpWithHash.hash;
  } catch (error) {
    logger.error('Failed to send user operation:', error);
    throw new RpcError(
      `Failed to send user operation: ${error.message}`,
      ERROR_CODES.INVALID_OP,
      { cause: error }
    );
  }
}

async function handleGetUserOperationByHash(params: any[]): Promise<any> {
  if (params.length < 1) {
    throw new RpcError('Missing user operation hash', ERROR_CODES.INVALID_PARAMS);
  }

  const hash = params[0];
  
  try {
    const userOp = await mempoolService.getUserOperation(hash);
    
    if (!userOp) {
      throw new RpcError('User operation not found', ERROR_CODES.INVALID_PARAMS);
    }
    
    // Format the response according to EIP-4337
    return {
      userOperation: {
        sender: userOp.sender,
        nonce: userOp.nonce,
        initCode: userOp.initCode || '0x',
        callData: userOp.callData || '0x',
        callGasLimit: userOp.callGasLimit,
        verificationGasLimit: userOp.verificationGasLimit,
        preVerificationGas: userOp.preVerificationGas,
        maxFeePerGas: userOp.maxFeePerGas,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
        paymasterAndData: userOp.paymasterAndData || '0x',
        signature: userOp.signature || '0x',
      },
      entryPoint: config.ethereum.entryPointAddress,
      blockNumber: userOp.blockNumber ? BigNumber.from(userOp.blockNumber).toHexString() : null,
      blockHash: null, // Not available in the current implementation
      transactionHash: userOp.transactionHash || null,
    };
  } catch (error) {
    logger.error('Failed to get user operation by hash:', error);
    throw new RpcError(
      `Failed to get user operation: ${error.message}`,
      ERROR_CODES.INVALID_PARAMS,
      { cause: error }
    );
  }
}

async function handleGetUserOperationReceipt(params: any[]): Promise<any> {
  if (params.length < 1) {
    throw new RpcError('Missing user operation hash', ERROR_CODES.INVALID_PARAMS);
  }

  const hash = params[0];
  
  try {
    const userOp = await mempoolService.getUserOperation(hash);
    
    if (!userOp) {
      throw new RpcError('User operation not found', ERROR_CODES.INVALID_PARAMS);
    }
    
    if (userOp.status !== 'confirmed' || !userOp.transactionHash) {
      return null; // Not yet mined
    }
    
    // Get the transaction receipt
    const receipt = await config.ethereum.provider.getTransactionReceipt(userOp.transactionHash);
    
    if (!receipt) {
      return null;
    }
    
    // Format the response according to EIP-4337
    return {
      userOpHash: hash,
      entryPoint: config.ethereum.entryPointAddress,
      sender: userOp.sender,
      nonce: userOp.nonce,
      paymaster: userOp.paymasterAndData ? userOp.paymasterAndData.slice(0, 42) : ethers.constants.AddressZero,
      actualGasCost: receipt.gasUsed.mul(receipt.effectiveGasPrice || 0).toString(),
      actualGasUsed: receipt.gasUsed.toString(),
      success: receipt.status === 1,
      logs: receipt.logs,
      receipt: {
        transactionHash: receipt.transactionHash,
        transactionIndex: receipt.transactionIndex,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        from: receipt.from,
        to: receipt.to,
        cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
        gasUsed: receipt.gasUsed.toString(),
        contractAddress: receipt.contractAddress,
        logs: receipt.logs.map((log: any) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          blockHash: log.blockHash,
          logIndex: log.logIndex,
          removed: log.removed,
        })),
        logsBloom: receipt.logsBloom,
        status: receipt.status,
        type: receipt.type,
        effectiveGasPrice: receipt.effectiveGasPrice?.toString() || '0x0',
      },
    };
  } catch (error) {
    logger.error('Failed to get user operation receipt:', error);
    throw new RpcError(
      `Failed to get user operation receipt: ${error.message}`,
      ERROR_CODES.INVALID_PARAMS,
      { cause: error }
    );
  }
}

async function handleClearMempool(): Promise<{ cleared: boolean }> {
  try {
    await mempoolService.clearMempool();
    return { cleared: true };
  } catch (error) {
    logger.error('Failed to clear mempool:', error);
    throw new RpcError(
      `Failed to clear mempool: ${error.message}`,
      ERROR_CODES.INTERNAL_ERROR,
      { cause: error }
    );
  }
}

async function handleGetStatus(): Promise<{
  isRunning: boolean;
  mempoolSize: number;
  lastBundleId?: string;
  lastBundleTime?: Date;
}> {
  try {
    return await bundlerService.getStatus();
  } catch (error) {
    logger.error('Failed to get bundler status:', error);
    throw new RpcError(
      `Failed to get bundler status: ${error.message}`,
      ERROR_CODES.INTERNAL_ERROR,
      { cause: error }
    );
  }
}
