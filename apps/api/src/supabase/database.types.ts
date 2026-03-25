import type { UUID } from 'crypto';
import { MergeDeep } from 'type-fest';
import { Address } from './address';
import { Database as DatabaseGenerated } from './database-generated.types';

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
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            borrowerAddress: Address;
            lenderAddress?: Address | null;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            borrowerAddress?: Address;
            lenderAddress?: Address | null;
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
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            loanId: UUID;
            tokenId: UUID;
            txTimestamp: Date;
            fromAddress: Address;
            toAddress: Address;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            loanId?: UUID;
            tokenId?: UUID;
            txTimestamp?: Date;
            fromAddress?: Address;
            toAddress?: Address;
          };
        };
      };
      Functions: {
        create_loan_with_transaction: {
          Args: {
            p_borrower_address: Address;
            p_collateral_amount: string;
            p_collateral_block_number: string;
            p_collateral_token_address: Address;
            p_contract_address: Address;
            p_log_index: number;
            p_on_chain_loan_id: string;
          };
          Returns: string;
        };
      };
    };
  }
>;
