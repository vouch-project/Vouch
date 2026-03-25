import { UUID } from 'crypto';
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
            lenderAddress: Address;
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
            borrowerAddress: Address;
            lenderAddress?: Address;
          };
          Update: {
            id?: UUID;
            chainId?: UUID;
            borrowerAddress?: Address;
            lenderAddress?: Address;
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
    };
  }
>;
