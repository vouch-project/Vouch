import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import Fastify from 'fastify';

import borrowerRoutes from './routes/borrowers';
import healthRoutes from './routes/health';
import lenderRoutes from './routes/lenders';
import loanRoutes from './routes/loans';
import matchingRoutes from './routes/matching';

dotenv.config();

const PORT = parseInt(process.env.CORE_API_PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const server = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function start() {
  try {
    // Register plugins
    await server.register(cors, {
      origin: process.env.NODE_ENV === 'production' ? false : true,
    });

    await server.register(helmet);

    await server.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    });

    await server.register(jwt, {
      secret: process.env.JWT_SECRET || 'your-secret-key-changeme',
    });

    // Register routes
    await server.register(healthRoutes, { prefix: '/api/v1/health' });
    await server.register(loanRoutes, { prefix: '/api/v1/loans' });
    await server.register(borrowerRoutes, { prefix: '/api/v1/borrowers' });
    await server.register(lenderRoutes, { prefix: '/api/v1/lenders' });
    await server.register(matchingRoutes, { prefix: '/api/v1/matching' });

    // Start server
    await server.listen({ port: PORT, host: HOST });
    console.log(`🚀 Core API server running at http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
