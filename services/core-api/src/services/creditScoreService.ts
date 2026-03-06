import axios from 'axios';

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

/**
 * Fetch credit score from ML service
 */
export async function getCreditScore(walletAddress: string): Promise<number> {
  try {
    const response = await axios.post(`${ML_API_URL}/api/ml/credit-score`, {
      wallet_address: walletAddress,
    });

    return response.data.credit_score;
  } catch (error) {
    console.error('Error fetching credit score:', error);
    // Return default score on error
    return 500;
  }
}

/**
 * Batch fetch credit scores for multiple addresses
 */
export async function getBatchCreditScores(
  walletAddresses: string[]
): Promise<Record<string, number>> {
  try {
    const response = await axios.post(`${ML_API_URL}/api/ml/credit-score/batch`, {
      wallet_addresses: walletAddresses,
    });

    return response.data.scores;
  } catch (error) {
    console.error('Error fetching batch credit scores:', error);
    return {};
  }
}
