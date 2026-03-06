import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLoan, getLoanById, updateLoanStatus } from '../services/loanService';

const createLoanSchema = z.object({
  borrowerAddress: z.string(),
  amount: z.string(),
  collateralAmount: z.string(),
  interestRate: z.number(),
  duration: z.number(),
  collateralToken: z.string(),
  loanToken: z.string(),
});

export default async function loanRoutes(fastify: FastifyInstance) {
  // Get loan by ID
  fastify.get('/:loanId', async (request, reply) => {
    const { loanId } = request.params as { loanId: string };
    const loan = await getLoanById(loanId);

    if (!loan) {
      return reply.code(404).send({ error: 'Loan not found' });
    }

    return loan;
  });

  // Create new loan request
  fastify.post('/', async (request, reply) => {
    const validation = createLoanSchema.safeParse(request.body);

    if (!validation.success) {
      return reply.code(400).send({ error: validation.error.errors });
    }

    const loan = await createLoan(validation.data);
    return reply.code(201).send(loan);
  });

  // Update loan status
  fastify.patch('/:loanId/status', async (request, reply) => {
    const { loanId } = request.params as { loanId: string };
    const { status } = request.body as { status: string };

    const loan = await updateLoanStatus(loanId, status);
    return loan;
  });

  // Get all active loans
  fastify.get('/', async (request, reply) => {
    // TODO: Implement pagination
    return { loans: [], total: 0 };
  });
}
