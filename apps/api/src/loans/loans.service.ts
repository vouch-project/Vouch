import { Injectable } from '@nestjs/common';
import { asAddress } from '@vouch/database-types';
import { UUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoansService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create({
    collateralTokenAddress,
    networkId,
    contractAddress,
    collateralLockedAt,
    ...createLoanDto
  }: CreateLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'create_loan_with_transaction',
      {
        p_network_id: networkId,
        p_collateral_token_address: asAddress(collateralTokenAddress),
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: createLoanDto.loanId.toString(),
        p_borrower_address: asAddress(createLoanDto.borrower),
        p_collateral_amount: createLoanDto.collateralAmount.toString(),
        p_requested_principal_token_address: asAddress(
          createLoanDto.requestedPrincipalTokenAddress,
        ),
        p_requested_principal_amount:
          createLoanDto.requestedPrincipalAmount.toString(),
        p_collateral_tx_hash: createLoanDto.collateralTxHash,
        p_collateral_block_number:
          createLoanDto.collateralBlockNumber.toString(),
        p_collateral_block_hash: createLoanDto.collateralBlockHash,
        p_log_index: createLoanDto.logIndex,
        p_collateral_locked_at: collateralLockedAt.toISOString(),
      },
    );

    if (error) throw error;
  }

  async fund({
    onChainLoanId,
    chainId,
    lenderAddress,
  }: {
    onChainLoanId: bigint;
    chainId: string;
    lenderAddress: string;
  }) {
    const { error } = await this.supabaseService.client
      .from('loans')
      .update({ status: 'active', lenderAddress: asAddress(lenderAddress) })
      .eq('onChainLoanId', onChainLoanId.toString())
      .eq('chainId', chainId as UUID);

    if (error) throw error;
  }
}
