import { Injectable } from '@nestjs/common';
import { asAddress } from '@vouch/database-types';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { FundLoanDto } from './dto/fund-loan.dto';

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
    networkId,
    contractAddress,
    lenderAddress,
    borrowerAddress,
    principalAmount,
    txHash,
    blockNumber,
    blockHash,
    logIndex,
    fundedAt,
  }: FundLoanDto) {
    const { error } = await this.supabaseService.client.rpc(
      'fund_loan_with_transaction',
      {
        p_network_id: networkId,
        p_contract_address: asAddress(contractAddress),
        p_on_chain_loan_id: onChainLoanId.toString(),
        p_lender_address: asAddress(lenderAddress),
        p_borrower_address: asAddress(borrowerAddress),
        p_principal_amount: principalAmount.toString(),
        p_tx_hash: txHash,
        p_block_number: blockNumber.toString(),
        p_block_hash: blockHash,
        p_log_index: logIndex,
        p_funded_at: fundedAt.toISOString(),
      },
    );

    if (error) throw error;
  }
}
