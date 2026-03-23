import { UUID } from 'crypto';
import { MergeDeep } from 'type-fest';
import { Database as DatabaseGenerated } from './database-generated.types';

export type Database = MergeDeep<
  DatabaseGenerated,
  {
    public: {
      Tables: {
        chains: {
          Row: { id: UUID };
          Insert: { id?: UUID };
          Update: { id?: UUID };
        };
        tokens: {
          Row: { id: UUID; chainId: UUID };
          Insert: { id?: UUID; chainId: UUID };
          Update: { id?: UUID; chainId?: UUID };
        };
        loans: {
          Row: { id: UUID; chainId: UUID };
          Insert: { id?: UUID; chainId: UUID };
          Update: { id?: UUID; chainId?: UUID };
        };
        transactions: {
          Row: { id: UUID; chainId: UUID; loanId: UUID; tokenId: UUID };
          Insert: { id?: UUID; chainId: UUID; loanId: UUID; tokenId: UUID };
          Update: { id?: UUID; chainId?: UUID; loanId?: UUID; tokenId?: UUID };
        };
      };
    };
  }
>;
