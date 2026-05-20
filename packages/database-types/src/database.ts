import type { UUID } from 'crypto';
import type { MergeDeep } from 'type-fest';
import { Address } from './address';
import { Database as DatabaseGenerated } from './generated';

export type Database = MergeDeep<
  DatabaseGenerated,
  {
    public: {
      Tables: {
        chains: {
          Row: { id: UUID; contractAddress: Address };
          Insert: { id?: UUID; contractAddress: Address };
          Update: { id?: UUID; contractAddress?: Address };
        };
        tokens: {
          Row: { id: UUID; chainId: UUID; address: Address };
          Insert: { id?: UUID; chainId: UUID; address: Address };
          Update: { id?: UUID; chainId?: UUID; address?: Address };
        };
        loans: {
          Row: {
            id: UUID;
            chainId: UUID;
            borrowerAddress: Address;
            lenderAddress: Address | null;
            // uint256 columns — PostgREST serialises numeric as string
            onChainLoanId: string | null;
            interestRate: string | null;
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            borrowerAddress: Address;
            lenderAddress?: Address | null;
            onChainLoanId?: string | null;
            interestRate?: string | null;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            borrowerAddress?: Address;
            lenderAddress?: Address | null;
            onChainLoanId?: string | null;
            interestRate?: string | null;
          };
        };
        transactions: {
          Row: {
            id: UUID;
            chainId: UUID;
            loanId: UUID;
            tokenId: UUID;
            fromAddress: Address;
            toAddress: Address;
            // uint256 columns — PostgREST serialises numeric as string
            blockNumber: string | null;
            logIndex: string;
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            loanId: UUID;
            tokenId: UUID;
            txTimestamp: Date;
            fromAddress: Address;
            toAddress: Address;
            blockNumber?: string | null;
            logIndex: string;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            loanId?: UUID;
            tokenId?: UUID;
            txTimestamp?: Date;
            fromAddress?: Address;
            toAddress?: Address;
            blockNumber?: string | null;
            logIndex?: string;
          };
        };
        credit_scores: {
          Row: { id: UUID; address: Address };
          Insert: { id?: UUID; address: Address };
          Update: { id?: UUID; address?: Address };
        };
      };
      Functions: {
        create_loan_with_transaction: {
          Args: {
            p_borrower_address: Address;
            p_collateral_block_number: string;
            p_collateral_token_address: Address;
            p_contract_address: Address;
            p_log_index: number;
            p_on_chain_loan_id: string;
          };
          Returns: string;
        };
        // The SQL function uses nullif(...) and returns NULL when the JWT
        // is missing the `address` claim (unauthenticated callers).
        current_wallet_address: {
          Args: Record<string, never>;
          Returns: string | null;
        };
      };
    };
  }
>;
