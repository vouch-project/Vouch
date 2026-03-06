import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Get loan by ID from database
 */
export async function getLoanById(loanId: string) {
  const { data, error } = await supabase.from('loans').select('*').eq('id', loanId).single();

  if (error) {
    console.error('Error fetching loan:', error);
    return null;
  }

  return data;
}

/**
 * Create a new loan request
 */
export async function createLoan(loanData: any) {
  const { data, error } = await supabase
    .from('loans')
    .insert([
      {
        ...loanData,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create loan: ${error.message}`);
  }

  return data;
}

/**
 * Update loan status
 */
export async function updateLoanStatus(loanId: string, status: string) {
  const { data, error } = await supabase
    .from('loans')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', loanId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update loan status: ${error.message}`);
  }

  return data;
}
