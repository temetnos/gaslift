import { BigNumberish } from 'ethers';

export class ValidationError extends Error {
  constructor(message: string, public readonly code: string, public readonly data?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: any
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly address: string,
    public readonly required: BigNumberish,
    public readonly available: BigNumberish
  ) {
    super(`Insufficient funds: required ${required}, available ${available}`);
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidUserOpError extends Error {
  constructor(message: string, public readonly op: any, public readonly data?: any) {
    super(`Invalid UserOperation: ${message}`);
    this.name = 'InvalidUserOpError';
  }
}

export class RateLimitError extends Error {
  constructor(
    public readonly key: string,
    public readonly limit: number,
    public readonly windowMs: number
  ) {
    super(`Rate limit exceeded: ${limit} requests per ${windowMs}ms`);
    this.name = 'RateLimitError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string, public readonly data?: any) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends Error {
  constructor(service: string, reason?: string) {
    super(`Service unavailable: ${service}${reason ? ` - ${reason}` : ''}`);
    this.name = 'ServiceUnavailableError';
  }
}

export const ERROR_CODES = {
  // JSON-RPC error codes
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  
  // Custom error codes
  INVALID_OP: -32000,
  UNSUPPORTED_OP: -32001,
  GAS_TOO_LOW: -32002,
  PAYMASTER_DEPLETED: -32003,
  RATE_LIMITED: -32004,
  UNAUTHORIZED: -32005,
  INSUFFICIENT_FUNDS: -32006,
  ENTRY_POINT_ERROR: -32007,
} as const;
