import { FastifyInstance } from 'fastify';
import { matchLoanRequests } from '../services/matchingEngine';

export default async function matchingRoutes(fastify: FastifyInstance) {
  // Get matching lenders for a loan request
  fastify.post('/find-lenders', async (request, reply) => {
    const { loanId } = request.body as { loanId: string };

    const matches = await matchLoanRequests(loanId);

    return {
      loanId,
      matches,
    };
  });

  // Get matching loan requests for a lender
  fastify.post('/find-loans', async (request, reply) => {
    const { lenderAddress, preferences } = request.body as {
      lenderAddress: string;
      preferences: any;
    };

    return {
      lenderAddress,
      matches: [],
    };
  });
}
