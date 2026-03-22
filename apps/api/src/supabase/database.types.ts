import { UUID } from 'crypto';
import { MergeDeep } from 'type-fest';
import { Database as DatabaseGenerated } from './database-generated.types';

export type Database = MergeDeep<
  DatabaseGenerated,
  {
    public: {
      Tables: {
        chains: {
          Row: {
            id: UUID;
            networkId: string;
          };
          Insert: {
            id?: UUID;
            networkId: string;
          };
        };
        loans: {
          Row: {
            id: UUID;
            loanId: string;
            chainId: UUID;
            collateralAmount: string;
            collateralBlockNumber: string;
            collateralTokenId: UUID;
          };
          Insert: {
            id?: UUID;
            loanId: string;
            chainId: UUID;
            collateralAmount: string;
            collateralBlockNumber: string;
            collateralTokenId: UUID;
          };
        };
        token_list: {
          Row: {
            id: UUID;
            chainId: UUID;
          };
          Insert: {
            id?: UUID;
            chainId: UUID;
          };
        };
      };
    };
  }
>;
