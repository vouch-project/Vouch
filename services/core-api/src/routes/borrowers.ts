import { FastifyInstance } from 'fastify';
import { getCreditScore } from '../services/creditScoreService';

export default async function borrowerRoutes(fastify: FastifyInstance) {
  // Get borrower profile and credit score
  fastify.get('/:address', async (request, reply) => {
    const { address } = request.params as { address: string };

    // Fetch credit score from ML service
    const creditScore = await getCreditScore(address);

    return {
      address,
      creditScore,
      // Add more borrower info from Supabase
    };
  });

  // Get borrower's active loans
  fastify.get('/:address/loans', async (request, reply) => {
    const { address } = request.params as { address: string };

    return {
      loans: [],
      total: 0,
    };
  });
}
