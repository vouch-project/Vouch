import { supabase } from '$lib/supabase';
import type { LoanFull } from '$lib/types';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Address } from '@vouch/database-types';
import { ethers } from 'ethers';

export type DashboardFilter = 'active' | 'repaid' | 'all';
export type DashboardRole = 'borrower' | 'lender';

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

  readonly role: DashboardRole;
  // The loans column this view filters on, and the transactions column that
  // identifies this user's side of a transfer (borrowers send, lenders receive).
  readonly #loanColumn: 'borrowerAddress' | 'lenderAddress';
  readonly #txColumn: 'fromAddress' | 'toAddress';

  #channel: RealtimeChannel | null = null;
  #address: string | null = null;

  constructor(role: DashboardRole = 'borrower') {
    this.role = role;
    this.#loanColumn = role === 'lender' ? 'lenderAddress' : 'borrowerAddress';
    this.#txColumn = role === 'lender' ? 'toAddress' : 'fromAddress';
  }

  activeCount = $derived(this.loans.filter((l) => l.status === 'active' || l.status === 'pending').length);
  repaidCount = $derived(this.loans.filter((l) => l.status === 'repaid').length);
  liquidatedCount = $derived(this.loans.filter((l) => l.status === 'liquidated').length);

  filter(filter: DashboardFilter): LoanFull[] {
    if (filter === 'active') return this.loans.filter((l) => l.status === 'active' || l.status === 'pending');
    if (filter === 'repaid') return this.loans.filter((l) => l.status === 'repaid');
    return this.loans;
  }

  reset() {
    // Tear down realtime too: on disconnect/account switch a live channel would
    // otherwise keep filtering on the old borrower and refetch stale data.
    this.#unsubscribe();
    this.realtimeActive = false;
    this.#address = null;
    this.loans = [];
    this.fetchError = '';
  }

  async fetch(address: string) {
    const checksummed = ethers.getAddress(address);
    const addressChanged = this.#address !== null && this.#address !== checksummed;
    this.#address = checksummed;
    this.fetchError = '';

    const { data, error } = await supabase
      .from('loans')
      .select(LOAN_SELECT)
      .eq(this.#loanColumn, checksummed as Address)
      .order('createdAt', { ascending: false });

    if (error) {
      this.fetchError = error.message;
      return;
    }
    this.loans = (data ?? []) as unknown as LoanFull[];

    // The realtime channel filters on the borrower address, so a wallet switch
    // would otherwise keep streaming the previous user's changes. Rebuild it.
    if (addressChanged && this.realtimeActive) this.#subscribe();
  }

  toggleRealtime() {
    if (this.realtimeActive) {
      this.#unsubscribe();
      this.realtimeActive = false;
      return;
    }
    this.#subscribe();
    this.realtimeActive = true;
  }

  #unsubscribe() {
    if (this.#channel) {
      void supabase.removeChannel(this.#channel);
      this.#channel = null;
    }
  }

  // (Re)builds the borrower-scoped channel for the current #address. Tears down
  // any existing channel first so callers can use this to resubscribe in place.
  #subscribe() {
    this.#unsubscribe();

    const refetch = () => {
      if (this.#address) void this.fetch(this.#address);
    };
    // Scope the subscription to this borrower so we don't refetch on unrelated
    // users' loan/transaction changes. #address is already checksummed to match
    // how addresses are stored (see fetch()).
    const checksummed = this.#address ?? '';
    this.#channel = supabase
      .channel(`public:dashboard-loans-${this.role}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loans', filter: `${this.#loanColumn}=eq.${checksummed}` },
        refetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `${this.#txColumn}=eq.${checksummed}` },
        refetch,
      )
      .subscribe();
  }

  destroy() {
    this.#unsubscribe();
  }
}
