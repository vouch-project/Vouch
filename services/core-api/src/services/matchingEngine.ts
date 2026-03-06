import { getCreditScore } from './creditScoreService';
import { supabase } from './loanService';

interface LoanRequest {
  id: string;
  borrowerAddress: string;
  amount: string;
  interestRate: number;
  duration: number;
  collateralAmount: string;
}

interface LenderOffer {
  id: string;
  lenderAddress: string;
  maxAmount: string;
  minInterestRate: number;
  minCreditScore: number;
}

/**
 * Match loan requests with potential lenders
 */
export async function matchLoanRequests(loanId: string) {
  // Fetch the loan request
  const { data: loan, error: loanError } = await supabase
    .from('loans')
    .select('*')
    .eq('id', loanId)
    .single();

  if (loanError || !loan) {
    throw new Error('Loan not found');
  }

  // Get borrower's credit score
  const creditScore = await getCreditScore(loan.borrower_address);

  // Fetch available lender offers
  const { data: lenderOffers, error: offersError } = await supabase
    .from('lender_offers')
    .select('*')
    .eq('status', 'active')
    .gte('max_amount', loan.amount)
    .lte('min_credit_score', creditScore);

  if (offersError) {
    throw new Error('Failed to fetch lender offers');
  }

  // Score and rank matches
  const matches = (lenderOffers || [])
    .map((offer: any) => ({
      ...offer,
      matchScore: calculateMatchScore(loan, offer, creditScore),
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10); // Top 10 matches

  return matches;
}

/**
 * Calculate match score between loan and lender offer
 */
function calculateMatchScore(loan: any, offer: any, creditScore: number): number {
  let score = 0;

  // Interest rate matching
  const rateMatch = Math.max(0, 100 - Math.abs(loan.interest_rate - offer.min_interest_rate) * 10);
  score += rateMatch * 0.4;

  // Amount matching
  const amountRatio = parseFloat(loan.amount) / parseFloat(offer.max_amount);
  score += Math.min(amountRatio, 1) * 30;

  // Credit score bonus
  score += Math.min((creditScore - offer.min_credit_score) / 10, 30);

  return score;
}
