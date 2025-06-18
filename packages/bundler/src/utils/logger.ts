import pino from 'pino';
import config from '../config';

const isDevelopment = config.nodeEnv === 'development';
const isTest = config.nodeEnv === 'test';

// Custom timestamp format
const timestamp = () => `,"time":"${new Date(Date.now()).toISOString()}"`;

// Custom log levels
const customLevels = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

// Base logger configuration
const baseLoggerConfig: pino.LoggerOptions = {
  level: isDevelopment ? 'debug' : 'info',
  timestamp,
  customLevels,
  useOnlyCustomLevels: true,
  base: undefined, // Remove pid and hostname
  formatters: {
    level: (label) => ({ level: label }),
  },
};

// Development logger configuration
const devLoggerConfig: pino.LoggerOptions = {
  ...baseLoggerConfig,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
};

// Production logger configuration
const prodLoggerConfig: pino.LoggerOptions = {
  ...baseLoggerConfig,
  serializers: {
    error: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      'password',
      '*.password',
      '*.password.*',
      '*.privateKey',
      '*.privateKey.*',
      '*.apiKey',
      '*.apiKey.*',
      '*.secret',
      '*.secret.*',
    ],
    remove: true,
  },
};

// Test logger configuration (outputs to a file)
const testLoggerConfig: pino.LoggerOptions = {
  ...baseLoggerConfig,
  level: 'silent',
  transport: {
    target: 'pino/file',
    options: {
      destination: './test.log',
      mkdir: true,
    },
  },
};

// Create the appropriate logger based on environment
const logger = isTest
  ? pino(testLoggerConfig)
  : isDevelopment
  ? pino(devLoggerConfig)
  : pino(prodLoggerConfig);

// Create a child logger with context
export function createLogger(context: string) {
  return logger.child({ context });
}

// Export the main logger instance
export { logger };

// Log unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error(
    { err: reason, promise },
    'Unhandled Rejection at:'
  );
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception thrown');
  // In production, you might want to restart the process here
  if (!isDevelopment) {
    process.exit(1);
  }
});

// Log process signals
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) => {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    process.exit(0);
  });
});
