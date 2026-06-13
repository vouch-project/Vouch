import { supabase } from '$lib/supabase';
import type { LoanFull } from '$lib/types';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Address } from '@vouch/database-types';
import { ethers } from 'ethers';

export type DashboardFilter = 'active' | 'repaid' | 'all';

const LOAN_SELECT = `
  *,
  collateralToken:tokens!loans_collateralTokenId_fkey(*),
  principalToken:tokens!loans_principalTokenId_fkey(*),
  repaymentTransactions:transactions!transactions_loanId_fkey(id, amount, txTimestamp, txHash, type)
`;

/**
 * Reactive controller for the dashboard's loan data: Supabase fetching,
 * optional realtime subscription, and derived status counts.
 */
export class DashboardData {
  loans = $state<LoanFull[]>([]);
  fetchError = $state('');
  realtimeActive = $state(false);

  #channel: RealtimeChannel | null = null;
  #address: string | null = null;

  activeCount = $derived(this.loans.filter((l) => l.status === 'active' || l.status === 'pending').length);
  repaidCount = $derived(this.loans.filter((l) => l.status === 'repaid').length);
  liquidatedCount = $derived(this.loans.filter((l) => l.status === 'liquidated').length);

  filter(filter: DashboardFilter): LoanFull[] {
    if (filter === 'active') return this.loans.filter((l) => l.status === 'active' || l.status === 'pending');
    if (filter === 'repaid') return this.loans.filter((l) => l.status === 'repaid');
    return this.loans;
  }

  reset() {
    this.loans = [];
    this.fetchError = '';
  }

  async fetch(address: string) {
    this.#address = address;
    this.fetchError = '';

    const { data, error } = await supabase
      .from('loans')
      .select(LOAN_SELECT)
      .eq('borrowerAddress', ethers.getAddress(address) as Address)
      .order('createdAt', { ascending: false });

    if (error) {
      this.fetchError = error.message;
      return;
    }
    this.loans = (data ?? []) as unknown as LoanFull[];
  }

  toggleRealtime() {
    if (this.realtimeActive) {
      if (this.#channel) {
        void supabase.removeChannel(this.#channel);
        this.#channel = null;
      }
      this.realtimeActive = false;
      return;
    }

    const refetch = () => {
      if (this.#address) void this.fetch(this.#address);
    };
    // Scope the subscription to this borrower so we don't refetch on unrelated
    // users' loan/transaction changes. Addresses are checksummed to match how
    // they're stored (see fetch()).
    const checksummed = this.#address ? ethers.getAddress(this.#address) : '';
    this.#channel = supabase
      .channel('public:dashboard-loans')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loans', filter: `borrowerAddress=eq.${checksummed}` },
        refetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `fromAddress=eq.${checksummed}` },
        refetch,
      )
      .subscribe();
    this.realtimeActive = true;
  }

  destroy() {
    if (this.#channel) {
      void supabase.removeChannel(this.#channel);
      this.#channel = null;
    }
  }
}
