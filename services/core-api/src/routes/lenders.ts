import { FastifyInstance } from 'fastify';

export default async function lenderRoutes(fastify: FastifyInstance) {
  // Get lender profile
  fastify.get('/:address', async (request, reply) => {
    const { address } = request.params as { address: string };

    return {
      address,
      totalLent: '0',
      activeLendings: 0,
      // Add more lender info
    };
  });

  // Get lender's active lendings
  fastify.get('/:address/lendings', async (request, reply) => {
    const { address } = request.params as { address: string };

    return {
      lendings: [],
      total: 0,
    };
  });

  // Create lending offer
  fastify.post('/:address/offers', async (request, reply) => {
    const { address } = request.params as { address: string };

    return {
      message: 'Offer created',
      offerId: 'placeholder',
    };
  });
}
