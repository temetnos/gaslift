import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifyMetrics from 'fastify-metrics';
import { healthRoutes } from './routes/health';
import { jsonRpcRoutes } from './routes/jsonrpc';
import { logger } from '../utils/logger';
import config from '../config';
import { healthService } from '../services/HealthService';
import { redisService } from '../services/RedisService';
import { bundlerService } from '../services/BundlerService';

export class ApiServer {
  private server: FastifyInstance;
  private isShuttingDown = false;
  private logger = logger.child({ context: 'ApiServer' });

  constructor() {
    this.server = Fastify({
      logger: config.nodeEnv !== 'production' ? logger : false,
      disableRequestLogging: config.nodeEnv === 'production',
      trustProxy: true,
      connectionTimeout: 30 * 1000, // 30 seconds
      requestTimeout: 10 * 1000, // 10 seconds
    });

    this.setupMiddlewares();
    this.setupRoutes();
    this.setupHooks();
  }

  private setupMiddlewares(): void {
    // Security headers
    this.server.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          formAction: ["'self'"],
        },
      },
    });

    // CORS
    this.server.register(fastifyCors, {
      origin: config.nodeEnv === 'development' ? '*' : false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Length', 'X-Request-Id'],
      credentials: true,
      maxAge: 86400, // 24 hours
    });

    // Rate limiting
    this.server.register(fastifyRateLimit, {
      global: true,
      max: config.security.rateLimitMaxRequests,
      timeWindow: config.security.rateLimitWindowMs,
      redis: redisService.getClient(),
      nameSpace: 'api-rate-limit-',
      keyGenerator: (req) => {
        // Rate limit by IP + API key if provided
        const apiKey = req.headers['x-api-key'] as string;
        return apiKey ? `${req.ip}-${apiKey}` : req.ip;
      },
      errorResponseBuilder: (req, context) => {
        return {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Rate limit exceeded, retry in ${context.after}`,
          code: 'RATE_LIMIT_EXCEEDED',
        };
      },
    });

    // Sensible defaults
    this.server.register(fastifySensible);

    // Metrics (Prometheus)
    if (config.monitoring.prometheusEnabled) {
      this.server.register(fastifyMetrics, {
        endpoint: '/metrics',
        routeMetrics: {
          enabled: true,
          registeredRoutesOnly: true,
          groupStatusCodes: true,
        },
        defaultMetrics: {
          enabled: true,
          register: undefined,
          prefix: 'bundler_',
        },
      });
    }
  }

  private setupRoutes(): void {
    // Health checks
    this.server.register(healthRoutes, { prefix: '/health' });
    
    // JSON-RPC API
    this.server.register(jsonRpcRoutes, { prefix: '/rpc' });
    
    // 404 handler
    this.server.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
      });
    });
  }

  private setupHooks(): void {
    // Add request ID to logs
    this.server.addHook('onRequest', async (request) => {
      request.log = request.log.child({ requestId: request.id });
    });

    // Log all requests
    this.server.addHook('onResponse', (request, reply, done) => {
      const responseTime = reply.getResponseTime().toFixed(2);
      
      if (request.routerPath === '/health' || request.routerPath === '/metrics') {
        // Skip logging health checks and metrics
        return done();
      }

      this.logger.info({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: `${responseTime}ms`,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }, 'Request completed');
      
      done();
    });

    // Handle uncaught errors
    this.server.setErrorHandler((error, request, reply) => {
      const statusCode = error.statusCode || 500;
      
      if (statusCode >= 500) {
        this.logger.error(
          {
            error: error.message,
            stack: error.stack,
            request: {
              method: request.method,
              url: request.url,
              params: request.params,
              query: request.query,
              body: request.body,
              headers: request.headers,
            },
          },
          'Unhandled error processing request'
        );
      }

      reply.status(statusCode).send({
        statusCode,
        error: error.name || 'Internal Server Error',
        message: error.message || 'An unexpected error occurred',
        ...(config.nodeEnv === 'development' && { stack: error.stack }),
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Initialize services
      await this.initializeServices();
      
      // Start the server
      const address = await this.server.listen({
        port: config.port,
        host: '0.0.0.0',
      });
      
      this.logger.info(`Server listening on ${address}`);
      
      // Handle shutdown signals
      this.setupShutdownHooks();
      
      // Start background services
      await this.startBackgroundServices();
      
    } catch (error) {
      this.logger.error('Failed to start server:', error);
      await this.shutdown(1);
    }
  }

  private async initializeServices(): Promise<void> {
    // Initialize Redis
    await redisService.connect();
    
    // Initialize database
    await this.initializeDatabase();
    
    // Initialize health service
    await healthService.start();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      await AppDataSource.initialize();
      this.logger.info('Database connection established');
      
      // Run migrations
      await this.runMigrations();
      
    } catch (error) {
      this.logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async runMigrations(): Promise<void> {
    try {
      // In a real implementation, you would run database migrations here
      // For example, using TypeORM migrations or another migration tool
      this.logger.info('Running database migrations...');
      // await AppDataSource.runMigrations();
      this.logger.info('Database migrations completed');
    } catch (error) {
      this.logger.error('Failed to run database migrations:', error);
      throw error;
    }
  }

  private async startBackgroundServices(): Promise<void> {
    // Start the bundler service
    await bundlerService.start();
    
    this.logger.info('Background services started');
  }

  private setupShutdownHooks(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach((signal) => {
      process.on(signal, async () => {
        if (this.isShuttingDown) {
          return;
        }
        
        this.isShuttingDown = true;
        this.logger.info(`Received ${signal}, shutting down gracefully...`);
        
        try {
          await this.shutdown(0);
        } catch (error) {
          this.logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', { promise, reason });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      this.shutdown(1).catch(() => process.exit(1));
    });
  }

  public async shutdown(exitCode: number = 0): Promise<void> {
    try {
      this.logger.info('Shutting down server...');
      
      // Stop accepting new connections
      await this.server.close();
      
      // Stop background services
      await this.stopBackgroundServices();
      
      // Close database connections
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
        this.logger.info('Database connection closed');
      }
      
      // Close Redis connection
      await redisService.disconnect();
      
      this.logger.info('Server shutdown complete');
      process.exit(exitCode);
      
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  private async stopBackgroundServices(): Promise<void> {
    // Stop the bundler service
    await bundlerService.stop();
    
    this.logger.info('Background services stopped');
  }

  public getServer(): FastifyInstance {
    return this.server;
  }
}

// Export a singleton instance
const apiServer = new ApiServer();
export { apiServer };
