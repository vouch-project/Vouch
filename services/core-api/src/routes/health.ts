import { FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    return {
      status: 'ok',
      service: 'vouch-core-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });
}
