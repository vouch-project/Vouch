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
          wsRpcUrl: string | null;
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
          wsRpcUrl?: string | null;
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
          wsRpcUrl?: string | null;
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
      lend_offers: {
        Row: {
          acceptDeadline: string;
          acceptedLoanId: string | null;
          chainId: string;
          collateralRatioBps: number;
          createdAt: string;
          duration: string;
          id: string;
          interestRateBps: number;
          lenderAddress: string;
          maxLtvBps: number;
          onChainOfferId: number;
          principalAmount: string;
          principalTokenId: string;
          scoreThreshold: number;
          status: Database['public']['Enums']['lendOfferStatus'];
          trustedRatioBps: number;
          updatedAt: string;
        };
        Insert: {
          acceptDeadline: string;
          acceptedLoanId?: string | null;
          chainId: string;
          collateralRatioBps?: number;
          createdAt?: string;
          duration: string;
          id?: string;
          interestRateBps: number;
          lenderAddress: string;
          maxLtvBps: number;
          onChainOfferId: number;
          principalAmount: string;
          principalTokenId: string;
          scoreThreshold?: number;
          status?: Database['public']['Enums']['lendOfferStatus'];
          trustedRatioBps?: number;
          updatedAt?: string;
        };
        Update: {
          acceptDeadline?: string;
          acceptedLoanId?: string | null;
          chainId?: string;
          collateralRatioBps?: number;
          createdAt?: string;
          duration?: string;
          id?: string;
          interestRateBps?: number;
          lenderAddress?: string;
          maxLtvBps?: number;
          onChainOfferId?: number;
          principalAmount?: string;
          principalTokenId?: string;
          scoreThreshold?: number;
          status?: Database['public']['Enums']['lendOfferStatus'];
          trustedRatioBps?: number;
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lend_offers_acceptedLoanId_fkey';
            columns: ['acceptedLoanId'];
            isOneToOne: false;
            referencedRelation: 'loans';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lend_offers_chainId_fkey';
            columns: ['chainId'];
            isOneToOne: false;
            referencedRelation: 'chains';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lend_offers_principalTokenId_fkey';
            columns: ['principalTokenId'];
            isOneToOne: false;
            referencedRelation: 'tokens';
            referencedColumns: ['id'];
          },
        ];
      };
      loans: {
        Row: {
          borrowerAddress: string;
          cancelledAt: string | null;
          chainId: string;
          collateralAmount: string | null;
          collateralReleased: string | null;
          collateralTokenId: string | null;
          createdAt: string;
          description: string | null;
          dueAt: string | null;
          duration: string | null;
          expiredAt: string | null;
          fundDeadline: string | null;
          fundedAt: string | null;
          id: string;
          interestRate: number | null;
          lenderAddress: string | null;
          lendOfferId: string | null;
          liquidatedAt: string | null;
          metadata: Json;
          onChainLoanId: number | null;
          principalAmount: string | null;
          principalRepaid: string | null;
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
          collateralReleased?: string | null;
          collateralTokenId?: string | null;
          createdAt?: string;
          description?: string | null;
          dueAt?: string | null;
          duration?: string | null;
          expiredAt?: string | null;
          fundDeadline?: string | null;
          fundedAt?: string | null;
          id?: string;
          interestRate?: number | null;
          lenderAddress?: string | null;
          lendOfferId?: string | null;
          liquidatedAt?: string | null;
          metadata?: Json;
          onChainLoanId?: number | null;
          principalAmount?: string | null;
          principalRepaid?: string | null;
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
          collateralReleased?: string | null;
          collateralTokenId?: string | null;
          createdAt?: string;
          description?: string | null;
          dueAt?: string | null;
          duration?: string | null;
          expiredAt?: string | null;
          fundDeadline?: string | null;
          fundedAt?: string | null;
          id?: string;
          interestRate?: number | null;
          lenderAddress?: string | null;
          lendOfferId?: string | null;
          liquidatedAt?: string | null;
          metadata?: Json;
          onChainLoanId?: number | null;
          principalAmount?: string | null;
          principalRepaid?: string | null;
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
            foreignKeyName: 'loans_lendOfferId_fkey';
            columns: ['lendOfferId'];
            isOneToOne: false;
            referencedRelation: 'lend_offers';
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
          decimals: number;
          id: string;
          logoURI: string | null;
          name: string | null;
          price_feed_address: string;
          symbol: string;
          volatility: number | null;
        };
        Insert: {
          address: string;
          chainId: string;
          decimals: number;
          id?: string;
          logoURI?: string | null;
          name?: string | null;
          price_feed_address: string;
          symbol: string;
          volatility?: number | null;
        };
        Update: {
          address?: string;
          chainId?: string;
          decimals?: number;
          id?: string;
          logoURI?: string | null;
          name?: string | null;
          price_feed_address?: string;
          symbol?: string;
          volatility?: number | null;
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
      training_dataset: {
        Row: {
          aaveBorrowsCount: number | null;
          aaveDaysSinceLastBorrow: number | null;
          aaveRepayRatio: number | null;
          aaveTotalBorrowedUsd: number | null;
          address: string;
          chainId: number;
          createdAt: string;
          ethBalance: number | null;
          featureSetVersion: string;
          historicalLiquidationCount: number | null;
          id: string;
          labelIsRisky: boolean;
          labelSource: string;
          rawFeatures: Json;
          snapshotAt: string;
          stablecoinBalanceUsd: number | null;
          totalTransactions: number | null;
          uniqueProtocolsInteracted: number | null;
          updatedAt: string;
          walletAgeDays: number | null;
        };
        Insert: {
          aaveBorrowsCount?: number | null;
          aaveDaysSinceLastBorrow?: number | null;
          aaveRepayRatio?: number | null;
          aaveTotalBorrowedUsd?: number | null;
          address: string;
          chainId: number;
          createdAt?: string;
          ethBalance?: number | null;
          featureSetVersion?: string;
          historicalLiquidationCount?: number | null;
          id?: string;
          labelIsRisky: boolean;
          labelSource: string;
          rawFeatures?: Json;
          snapshotAt: string;
          stablecoinBalanceUsd?: number | null;
          totalTransactions?: number | null;
          uniqueProtocolsInteracted?: number | null;
          updatedAt?: string;
          walletAgeDays?: number | null;
        };
        Update: {
          aaveBorrowsCount?: number | null;
          aaveDaysSinceLastBorrow?: number | null;
          aaveRepayRatio?: number | null;
          aaveTotalBorrowedUsd?: number | null;
          address?: string;
          chainId?: number;
          createdAt?: string;
          ethBalance?: number | null;
          featureSetVersion?: string;
          historicalLiquidationCount?: number | null;
          id?: string;
          labelIsRisky?: boolean;
          labelSource?: string;
          rawFeatures?: Json;
          snapshotAt?: string;
          stablecoinBalanceUsd?: number | null;
          totalTransactions?: number | null;
          uniqueProtocolsInteracted?: number | null;
          updatedAt?: string;
          walletAgeDays?: number | null;
        };
        Relationships: [];
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
      user_credit_features: {
        Row: {
          avgHealthFactorMaintained: number | null;
          createdAt: string;
          id: string;
          lastUpdatedAt: string | null;
          onTimeRepaymentRate: number | null;
          totalLoansDefaulted: number;
          totalLoansRepaid: number;
          totalLoansTaken: number;
          walletAddress: string;
        };
        Insert: {
          avgHealthFactorMaintained?: number | null;
          createdAt?: string;
          id?: string;
          lastUpdatedAt?: string | null;
          onTimeRepaymentRate?: number | null;
          totalLoansDefaulted?: number;
          totalLoansRepaid?: number;
          totalLoansTaken?: number;
          walletAddress: string;
        };
        Update: {
          avgHealthFactorMaintained?: number | null;
          createdAt?: string;
          id?: string;
          lastUpdatedAt?: string | null;
          onTimeRepaymentRate?: number | null;
          totalLoansDefaulted?: number;
          totalLoansRepaid?: number;
          totalLoansTaken?: number;
          walletAddress?: string;
        };
        Relationships: [];
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
      accept_lend_offer_with_transaction: {
        Args: {
          p_accepted_at: string;
          p_block_hash: string;
          p_block_number: unknown;
          p_borrower_address: unknown;
          p_collateral_amount: string;
          p_collateral_log_index: unknown;
          p_collateral_token_address: unknown;
          p_contract_address: unknown;
          p_disbursement_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_on_chain_offer_id: unknown;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
      cancel_lend_offer_with_transaction: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_cancelled_at: string;
          p_contract_address: unknown;
          p_lender_address: unknown;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_offer_id: unknown;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
      cancel_loan_with_transaction: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_borrower_address: unknown;
          p_cancelled_at: string;
          p_contract_address: unknown;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
      create_lend_offer_with_transaction: {
        Args: {
          p_accept_deadline: string;
          p_collateral_ratio_bps: number;
          p_contract_address: unknown;
          p_created_at: string;
          p_duration_seconds: number;
          p_interest_rate_bps: number;
          p_lender_address: unknown;
          p_max_ltv_bps: number;
          p_network_id: string;
          p_on_chain_offer_id: unknown;
          p_principal_amount: string;
          p_principal_token_address: unknown;
          p_score_threshold: number;
          p_trusted_ratio_bps: number;
        };
        Returns: undefined;
      };
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
          p_duration_seconds?: number;
          p_fund_deadline?: string;
          p_interest_rate_bps?: number;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_requested_principal_amount: string;
          p_requested_principal_token_address: unknown;
        };
        Returns: string;
      };
      current_wallet_address: { Args: never; Returns: string };
      expire_lend_offer_with_transaction: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_contract_address: unknown;
          p_expired_at: string;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_offer_id: unknown;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
      expire_loan_with_transaction: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_borrower_address: unknown;
          p_contract_address: unknown;
          p_expired_at: string;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_tx_hash: string;
        };
        Returns: undefined;
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
      record_partial_repayment: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_borrower_address: unknown;
          p_collateral_released: string;
          p_contract_address: unknown;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_paid_at: string;
          p_payment_amount: string;
          p_principal_repaid: string;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
      record_protocol_fee: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_collected_at: string;
          p_contract_address: unknown;
          p_fee_amount: string;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_treasury_address: unknown;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
      repay_loan_with_transaction: {
        Args: {
          p_block_hash: string;
          p_block_number: unknown;
          p_borrower_address: unknown;
          p_collateral_released: string;
          p_contract_address: unknown;
          p_interest_amount: string;
          p_lender_address: unknown;
          p_log_index: unknown;
          p_network_id: string;
          p_on_chain_loan_id: unknown;
          p_principal_amount: string;
          p_principal_repaid: string;
          p_repaid_at: string;
          p_total_repaid: string;
          p_tx_hash: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      addressType: 'evm' | 'solana' | 'bitcoin';
      lendOfferStatus: 'pending' | 'accepted' | 'cancelled' | 'expired';
      loanStatus: 'pending' | 'active' | 'repaid' | 'defaulted' | 'liquidated' | 'cancelled' | 'expired';
      notificationType:
        | 'loan_funded'
        | 'loan_repaid'
        | 'loan_liquidated'
        | 'loan_due_soon'
        | 'credit_score_updated'
        | 'system';
      transactionStatus: 'pending' | 'confirmed' | 'failed';
      transactionType:
        | 'collateral_deposit'
        | 'loan_disbursement'
        | 'repayment'
        | 'liquidation'
        | 'withdrawal'
        | 'protocol_fee';
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
      lendOfferStatus: ['pending', 'accepted', 'cancelled', 'expired'],
      loanStatus: ['pending', 'active', 'repaid', 'defaulted', 'liquidated', 'cancelled', 'expired'],
      notificationType: [
        'loan_funded',
        'loan_repaid',
        'loan_liquidated',
        'loan_due_soon',
        'credit_score_updated',
        'system',
      ],
      transactionStatus: ['pending', 'confirmed', 'failed'],
      transactionType: [
        'collateral_deposit',
        'loan_disbursement',
        'repayment',
        'liquidation',
        'withdrawal',
        'protocol_fee',
      ],
    },
  },
} as const;
