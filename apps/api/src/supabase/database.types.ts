import { MergeDeep } from 'type-fest';
import { Database as DatabaseGenerated } from './database-generated.types';

export type Database = MergeDeep<
  DatabaseGenerated,
  {
    public: {
      Tables: {
        loans: {
          Row: {
            loanId: string;
            chainId: string;
            collateralAmount: string;
            collateralBlockNumber: string;
          };
          Insert: {
            loanId: string;
            chainId: string;
            collateralAmount: string;
            collateralBlockNumber: string;
          };
        };
        token_list: {
          Row: {
            chainId: string;
          };
          Insert: {
            chainId: string;
          };
        };
      };
    };
  }
>;
