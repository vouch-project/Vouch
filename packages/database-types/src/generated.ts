export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      chains: {
        Row: {
          contractAddress: string;
          createdAt: string;
          id: string;
          name: string | null;
          networkId: string;
          networkType: Database['public']['Enums']['addressType'];
          rpcUrl: string;
          updatedAt: string;
        };
        Insert: {
          contractAddress: string;
          createdAt?: string;
          id?: string;
          name?: string | null;
          networkId: string;
          networkType: Database['public']['Enums']['addressType'];
          rpcUrl: string;
          updatedAt?: string;
        };
        Update: {
          contractAddress?: string;
          createdAt?: string;
          id?: string;
          name?: string | null;
          networkId?: string;
          networkType?: Database['public']['Enums']['addressType'];
          rpcUrl?: string;
          updatedAt?: string;
        };
        Relationships: [];
      };
      loans: {
        Row: {
          borrowerAddress: string;
          chainId: string;
          collateralAmount: string | null;
          collateralTokenId: string | null;
          createdAt: string;
          duration: string | null;
          id: string;
          interestRate: number | null;
          lenderAddress: string | null;
          onChainLoanId: number | null;
          principalAmount: string | null;
          principalTokenId: string | null;
          startAt: string | null;
          status: Database['public']['Enums']['loanStatus'];
          updatedAt: string;
        };
        Insert: {
          borrowerAddress: string;
          chainId: string;
          collateralAmount?: string | null;
          collateralTokenId?: string | null;
          createdAt?: string;
          duration?: string | null;
          id?: string;
          interestRate?: number | null;
          lenderAddress?: string | null;
          onChainLoanId?: number | null;
          principalAmount?: string | null;
          principalTokenId?: string | null;
          startAt?: string | null;
          status?: Database['public']['Enums']['loanStatus'];
          updatedAt?: string;
        };
        Update: {
          borrowerAddress?: string;
          chainId?: string;
          collateralAmount?: string | null;
          collateralTokenId?: string | null;
          createdAt?: string;
          duration?: string | null;
          id?: string;
          interestRate?: number | null;
          lenderAddress?: string | null;
          onChainLoanId?: number | null;
          principalAmount?: string | null;
          principalTokenId?: string | null;
          startAt?: string | null;
          status?: Database['public']['Enums']['loanStatus'];
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'loans_chainId_fkey';
            columns: ['chainId'];
            isOneToOne: false;
            referencedRelation: 'chains';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'loans_collateralTokenId_fkey';
            columns: ['collateralTokenId'];
            isOneToOne: false;
            referencedRelation: 'tokens';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'loans_principalTokenId_fkey';
            columns: ['principalTokenId'];
            isOneToOne: false;
            referencedRelation: 'tokens';
            referencedColumns: ['id'];
          },
        ];
      };
      tokens: {
        Row: {
          address: string;
          chainId: string;
          decimals: number;
          id: string;
          logoURI: string | null;
          name: string | null;
          symbol: string;
        };
        Insert: {
          address: string;
          chainId: string;
          decimals: number;
          id?: string;
          logoURI?: string | null;
          name?: string | null;
          symbol: string;
        };
        Update: {
          address?: string;
          chainId?: string;
          decimals?: number;
          id?: string;
          logoURI?: string | null;
          name?: string | null;
          symbol?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tokens_chainId_fkey';
            columns: ['chainId'];
            isOneToOne: false;
            referencedRelation: 'chains';
            referencedColumns: ['id'];
          },
        ];
      };
      transactions: {
        Row: {
          amount: string | null;
          blockHash: string | null;
          blockNumber: number | null;
          chainId: string;
          createdAt: string;
          fromAddress: string;
          id: string;
          loanId: string;
          logIndex: number;
          status: Database['public']['Enums']['transactionStatus'];
          toAddress: string;
          tokenId: string;
          txHash: string;
          txTimestamp: string;
          type: Database['public']['Enums']['transactionType'];
          updatedAt: string;
        };
        Insert: {
          amount?: string | null;
          blockHash?: string | null;
          blockNumber?: number | null;
          chainId: string;
          createdAt?: string;
          fromAddress: string;
          id?: string;
          loanId: string;
          logIndex: number;
          status?: Database['public']['Enums']['transactionStatus'];
          toAddress: string;
          tokenId: string;
          txHash: string;
          txTimestamp: string;
          type: Database['public']['Enums']['transactionType'];
          updatedAt?: string;
        };
        Update: {
          amount?: string | null;
          blockHash?: string | null;
          blockNumber?: number | null;
          chainId?: string;
          createdAt?: string;
          fromAddress?: string;
          id?: string;
          loanId?: string;
          logIndex?: number;
          status?: Database['public']['Enums']['transactionStatus'];
          toAddress?: string;
          tokenId?: string;
          txHash?: string;
          txTimestamp?: string;
          type?: Database['public']['Enums']['transactionType'];
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_chainId_fkey';
            columns: ['chainId'];
            isOneToOne: false;
            referencedRelation: 'chains';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_loanId_fkey';
            columns: ['loanId'];
            isOneToOne: false;
            referencedRelation: 'loans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_tokenId_fkey';
            columns: ['tokenId'];
            isOneToOne: false;
            referencedRelation: 'tokens';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_loan_with_transaction: {
        Args: {
          p_borrower_address: unknown;
          p_collateral_amount: string;
          p_collateral_block_hash: string;
          p_collateral_block_number: unknown;
          p_collateral_locked_at: string;
          p_collateral_token_address: unknown;
          p_collateral_tx_hash: string;
          p_contract_address: unknown;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_requested_principal_amount: string;
          p_requested_principal_token_address: unknown;
        };
        Returns: string;
      };
      fund_loan_with_transaction: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_borrower_address: unknown;
          p_contract_address: unknown;
          p_funded_at: string;
          p_lender_address: unknown;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_principal_amount: string;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      addressType: 'evm' | 'solana' | 'bitcoin';
      loanStatus: 'pending' | 'active' | 'repaid' | 'defaulted' | 'cancelled';
      transactionStatus: 'pending' | 'confirmed' | 'failed';
      transactionType: 'collateral_deposit' | 'loan_disbursement' | 'repayment' | 'liquidation' | 'withdrawal';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      addressType: ['evm', 'solana', 'bitcoin'],
      loanStatus: ['pending', 'active', 'repaid', 'defaulted', 'cancelled'],
      transactionStatus: ['pending', 'confirmed', 'failed'],
      transactionType: ['collateral_deposit', 'loan_disbursement', 'repayment', 'liquidation', 'withdrawal'],
    },
  },
} as const;
