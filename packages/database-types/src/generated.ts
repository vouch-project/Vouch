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
      analytics_events: {
        Row: {
          actorAddress: string | null;
          eventName: string;
          id: number;
          occurredAt: string;
          properties: Json;
          sessionId: string | null;
        };
        Insert: {
          actorAddress?: string | null;
          eventName: string;
          id?: number;
          occurredAt?: string;
          properties?: Json;
          sessionId?: string | null;
        };
        Update: {
          actorAddress?: string | null;
          eventName?: string;
          id?: number;
          occurredAt?: string;
          properties?: Json;
          sessionId?: string | null;
        };
        Relationships: [];
      };
      blockchain_event_log: {
        Row: {
          args: Json;
          blockHash: string;
          blockNumber: number;
          chainId: string;
          contractAddress: string;
          createdAt: string;
          error: string | null;
          eventName: string;
          id: string;
          logIndex: number;
          processedAt: string | null;
          status: Database['public']['Enums']['eventProcessingStatus'];
          txHash: string;
        };
        Insert: {
          args?: Json;
          blockHash: string;
          blockNumber: number;
          chainId: string;
          contractAddress: string;
          createdAt?: string;
          error?: string | null;
          eventName: string;
          id?: string;
          logIndex: number;
          processedAt?: string | null;
          status?: Database['public']['Enums']['eventProcessingStatus'];
          txHash: string;
        };
        Update: {
          args?: Json;
          blockHash?: string;
          blockNumber?: number;
          chainId?: string;
          contractAddress?: string;
          createdAt?: string;
          error?: string | null;
          eventName?: string;
          id?: string;
          logIndex?: number;
          processedAt?: string | null;
          status?: Database['public']['Enums']['eventProcessingStatus'];
          txHash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blockchain_event_log_chainId_fkey';
            columns: ['chainId'];
            isOneToOne: false;
            referencedRelation: 'chains';
            referencedColumns: ['id'];
          },
        ];
      };
      chains: {
        Row: {
          blockExplorerUrl: string | null;
          contractAddress: string;
          createdAt: string;
          id: string;
          isTestnet: boolean;
          name: string | null;
          networkId: string;
          networkType: Database['public']['Enums']['addressType'];
          rpcUrl: string;
          updatedAt: string;
        };
        Insert: {
          blockExplorerUrl?: string | null;
          contractAddress: string;
          createdAt?: string;
          id?: string;
          isTestnet?: boolean;
          name?: string | null;
          networkId: string;
          networkType: Database['public']['Enums']['addressType'];
          rpcUrl: string;
          updatedAt?: string;
        };
        Update: {
          blockExplorerUrl?: string | null;
          contractAddress?: string;
          createdAt?: string;
          id?: string;
          isTestnet?: boolean;
          name?: string | null;
          networkId?: string;
          networkType?: Database['public']['Enums']['addressType'];
          rpcUrl?: string;
          updatedAt?: string;
        };
        Relationships: [];
      };
      credit_scores: {
        Row: {
          address: string;
          computedAt: string;
          confidence: number;
          explanation: string | null;
          factors: Json;
          id: string;
          modelVersion: string;
          score: number;
        };
        Insert: {
          address: string;
          computedAt?: string;
          confidence: number;
          explanation?: string | null;
          factors?: Json;
          id?: string;
          modelVersion: string;
          score: number;
        };
        Update: {
          address?: string;
          computedAt?: string;
          confidence?: number;
          explanation?: string | null;
          factors?: Json;
          id?: string;
          modelVersion?: string;
          score?: number;
        };
        Relationships: [];
      };
      loans: {
        Row: {
          borrowerAddress: string;
          cancelledAt: string | null;
          chainId: string;
          collateralAmount: string | null;
          collateralTokenId: string | null;
          createdAt: string;
          description: string | null;
          dueAt: string | null;
          duration: string | null;
          fundedAt: string | null;
          id: string;
          interestRate: number | null;
          lenderAddress: string | null;
          liquidatedAt: string | null;
          metadata: Json;
          onChainLoanId: number | null;
          principalAmount: string | null;
          principalTokenId: string | null;
          purpose: string | null;
          repaidAt: string | null;
          startAt: string | null;
          status: Database['public']['Enums']['loanStatus'];
          updatedAt: string;
        };
        Insert: {
          borrowerAddress: string;
          cancelledAt?: string | null;
          chainId: string;
          collateralAmount?: string | null;
          collateralTokenId?: string | null;
          createdAt?: string;
          description?: string | null;
          dueAt?: string | null;
          duration?: string | null;
          fundedAt?: string | null;
          id?: string;
          interestRate?: number | null;
          lenderAddress?: string | null;
          liquidatedAt?: string | null;
          metadata?: Json;
          onChainLoanId?: number | null;
          principalAmount?: string | null;
          principalTokenId?: string | null;
          purpose?: string | null;
          repaidAt?: string | null;
          startAt?: string | null;
          status?: Database['public']['Enums']['loanStatus'];
          updatedAt?: string;
        };
        Update: {
          borrowerAddress?: string;
          cancelledAt?: string | null;
          chainId?: string;
          collateralAmount?: string | null;
          collateralTokenId?: string | null;
          createdAt?: string;
          description?: string | null;
          dueAt?: string | null;
          duration?: string | null;
          fundedAt?: string | null;
          id?: string;
          interestRate?: number | null;
          lenderAddress?: string | null;
          liquidatedAt?: string | null;
          metadata?: Json;
          onChainLoanId?: number | null;
          principalAmount?: string | null;
          principalTokenId?: string | null;
          purpose?: string | null;
          repaidAt?: string | null;
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
      ml_feature_snapshots: {
        Row: {
          address: string;
          createdAt: string;
          features: Json;
          featureSet: string;
          id: string;
          sourceHash: string | null;
        };
        Insert: {
          address: string;
          createdAt?: string;
          features: Json;
          featureSet: string;
          id?: string;
          sourceHash?: string | null;
        };
        Update: {
          address?: string;
          createdAt?: string;
          features?: Json;
          featureSet?: string;
          id?: string;
          sourceHash?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          createdAt: string;
          id: string;
          loanId: string | null;
          payload: Json;
          readAt: string | null;
          recipientAddress: string;
          title: string;
          type: Database['public']['Enums']['notificationType'];
        };
        Insert: {
          body?: string | null;
          createdAt?: string;
          id?: string;
          loanId?: string | null;
          payload?: Json;
          readAt?: string | null;
          recipientAddress: string;
          title: string;
          type: Database['public']['Enums']['notificationType'];
        };
        Update: {
          body?: string | null;
          createdAt?: string;
          id?: string;
          loanId?: string | null;
          payload?: Json;
          readAt?: string | null;
          recipientAddress?: string;
          title?: string;
          type?: Database['public']['Enums']['notificationType'];
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_loanId_fkey';
            columns: ['loanId'];
            isOneToOne: false;
            referencedRelation: 'loans';
            referencedColumns: ['id'];
          },
        ];
      };
      tokens: {
        Row: {
          address: string;
          chainId: string;
          createdAt: string;
          decimals: number;
          id: string;
          isNative: boolean;
          logoURI: string | null;
          name: string | null;
          symbol: string;
        };
        Insert: {
          address: string;
          chainId: string;
          createdAt?: string;
          decimals: number;
          id?: string;
          isNative?: boolean;
          logoURI?: string | null;
          name?: string | null;
          symbol: string;
        };
        Update: {
          address?: string;
          chainId?: string;
          createdAt?: string;
          decimals?: number;
          id?: string;
          isNative?: boolean;
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
      users: {
        Row: {
          address: string;
          avatarUrl: string | null;
          bio: string | null;
          createdAt: string;
          displayName: string | null;
          email: string | null;
          emailVerified: boolean;
          handle: string | null;
          id: string;
          kycProvider: string | null;
          kycReference: string | null;
          kycStatus: Database['public']['Enums']['kycStatus'];
          lastLoginAt: string | null;
          metadata: Json;
          preferences: Json;
          reputationScore: number;
          totalLoansBorrowed: number;
          totalLoansFunded: number;
          totalVouchesGiven: number;
          totalVouchesReceived: number;
          updatedAt: string;
        };
        Insert: {
          address: string;
          avatarUrl?: string | null;
          bio?: string | null;
          createdAt?: string;
          displayName?: string | null;
          email?: string | null;
          emailVerified?: boolean;
          handle?: string | null;
          id?: string;
          kycProvider?: string | null;
          kycReference?: string | null;
          kycStatus?: Database['public']['Enums']['kycStatus'];
          lastLoginAt?: string | null;
          metadata?: Json;
          preferences?: Json;
          reputationScore?: number;
          totalLoansBorrowed?: number;
          totalLoansFunded?: number;
          totalVouchesGiven?: number;
          totalVouchesReceived?: number;
          updatedAt?: string;
        };
        Update: {
          address?: string;
          avatarUrl?: string | null;
          bio?: string | null;
          createdAt?: string;
          displayName?: string | null;
          email?: string | null;
          emailVerified?: boolean;
          handle?: string | null;
          id?: string;
          kycProvider?: string | null;
          kycReference?: string | null;
          kycStatus?: Database['public']['Enums']['kycStatus'];
          lastLoginAt?: string | null;
          metadata?: Json;
          preferences?: Json;
          reputationScore?: number;
          totalLoansBorrowed?: number;
          totalLoansFunded?: number;
          totalVouchesGiven?: number;
          totalVouchesReceived?: number;
          updatedAt?: string;
        };
        Relationships: [];
      };
      vouches: {
        Row: {
          chainId: string | null;
          createdAt: string;
          expiresAt: string | null;
          id: string;
          note: string | null;
          onChainTxHash: string | null;
          onChainVouchId: number | null;
          revokedAt: string | null;
          stakeAmount: string | null;
          stakeTokenId: string | null;
          status: Database['public']['Enums']['vouchStatus'];
          trustWeight: number;
          updatedAt: string;
          voucheeAddress: string;
          voucherAddress: string;
        };
        Insert: {
          chainId?: string | null;
          createdAt?: string;
          expiresAt?: string | null;
          id?: string;
          note?: string | null;
          onChainTxHash?: string | null;
          onChainVouchId?: number | null;
          revokedAt?: string | null;
          stakeAmount?: string | null;
          stakeTokenId?: string | null;
          status?: Database['public']['Enums']['vouchStatus'];
          trustWeight?: number;
          updatedAt?: string;
          voucheeAddress: string;
          voucherAddress: string;
        };
        Update: {
          chainId?: string | null;
          createdAt?: string;
          expiresAt?: string | null;
          id?: string;
          note?: string | null;
          onChainTxHash?: string | null;
          onChainVouchId?: number | null;
          revokedAt?: string | null;
          stakeAmount?: string | null;
          stakeTokenId?: string | null;
          status?: Database['public']['Enums']['vouchStatus'];
          trustWeight?: number;
          updatedAt?: string;
          voucheeAddress?: string;
          voucherAddress?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'vouches_chainId_fkey';
            columns: ['chainId'];
            isOneToOne: false;
            referencedRelation: 'chains';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vouches_stakeTokenId_fkey';
            columns: ['stakeTokenId'];
            isOneToOne: false;
            referencedRelation: 'tokens';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      credit_scores_latest: {
        Row: {
          address: string | null;
          computedAt: string | null;
          confidence: number | null;
          explanation: string | null;
          factors: Json | null;
          modelVersion: string | null;
          score: number | null;
        };
        Relationships: [];
      };
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
      current_wallet_address: { Args: never; Returns: string };
      ensure_user: { Args: { p_address: unknown }; Returns: string };
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
      record_blockchain_event: {
        Args: {
          p_args: Json;
          p_block_hash: string;
          p_block_number: unknown;
          p_contract_address: unknown;
          p_event_name: string;
          p_log_index: unknown;
          p_network_id: string;
          p_tx_hash: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      addressType: 'evm' | 'solana' | 'bitcoin';
      eventProcessingStatus: 'pending' | 'processed' | 'failed' | 'skipped';
      kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
      loanStatus: 'pending' | 'active' | 'repaid' | 'defaulted' | 'liquidated' | 'cancelled';
      notificationType:
        | 'loan_funded'
        | 'loan_repaid'
        | 'loan_liquidated'
        | 'loan_due_soon'
        | 'vouch_received'
        | 'vouch_revoked'
        | 'credit_score_updated'
        | 'system';
      transactionStatus: 'pending' | 'confirmed' | 'failed';
      transactionType: 'collateral_deposit' | 'loan_disbursement' | 'repayment' | 'liquidation' | 'withdrawal';
      vouchStatus: 'active' | 'revoked' | 'slashed' | 'expired';
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
      eventProcessingStatus: ['pending', 'processed', 'failed', 'skipped'],
      kycStatus: ['none', 'pending', 'verified', 'rejected'],
      loanStatus: ['pending', 'active', 'repaid', 'defaulted', 'liquidated', 'cancelled'],
      notificationType: [
        'loan_funded',
        'loan_repaid',
        'loan_liquidated',
        'loan_due_soon',
        'vouch_received',
        'vouch_revoked',
        'credit_score_updated',
        'system',
      ],
      transactionStatus: ['pending', 'confirmed', 'failed'],
      transactionType: ['collateral_deposit', 'loan_disbursement', 'repayment', 'liquidation', 'withdrawal'],
      vouchStatus: ['active', 'revoked', 'slashed', 'expired'],
    },
  },
} as const;
