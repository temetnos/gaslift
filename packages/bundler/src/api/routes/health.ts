import { FastifyPluginAsync } from 'fastify';
import { healthService } from '../../services/HealthService';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Health check endpoint
  fastify.get('/health', async () => {
    return healthService.getStatus();
  });

  // Readiness check endpoint
  fastify.get('/ready', async () => {
    const status = await healthService.getStatus();
    return {
      status: status.status,
      timestamp: status.timestamp,
      checks: status.checks,
    };
  });

  // Liveness check endpoint
  fastify.get('/live', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Metrics endpoint (for Prometheus)
  fastify.get('/metrics', async (request, reply) => {
    // In a real implementation, you would expose Prometheus metrics here
    reply.header('Content-Type', 'text/plain');
    return '# No metrics configured';
  });
};
